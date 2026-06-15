/**
 * Multi-account usage visibility (task_1781149656020).
 *
 * Adam directive: the orchestrator must always see 5h/7d/extra-usage for ALL
 * accounts (cg-team-seat, icloud-max-20x, me-com-max), not just the active
 * inference account.
 *
 * Mechanism (proven live 2026-06-11): GET https://api.anthropic.com/api/oauth/usage
 * with a Bearer LOGIN-class token (scopes include user:profile) + header
 * anthropic-beta: oauth-2025-04-20 returns five_hour / seven_day / extra_usage
 * (extra_usage.is_enabled + used_credits = the silent-billing detector).
 * Setup-tokens 403 (no user:profile scope).
 *
 * Usage credentials are stored PER ACCOUNT in accounts.json under a separate
 * `usage_credential` field - deliberately distinct from the inference
 * access_token/refresh_token pair that rotation writes into agent .envs. A
 * usage credential never leaves accounts.json and is never written to .envs.
 *
 * SECURITY INVARIANTS (review lane: security-agent):
 * - No token is ever logged, echoed, or included in errors. Any surfaced
 *   reference uses fingerprint() => first 8 hex chars of sha256(token).
 * - accounts.json writes are atomic + chmod 0600 (saveAccounts in oauth.ts).
 * - Refresh tokens are one-time use: the store is written BEFORE the new
 *   token is used (same invariant as refreshOAuthToken).
 * - PKCE verifier/state live in state/oauth/pending-usage-auth.json (0600),
 *   deleted on completion; the verifier is never printed.
 */

import { existsSync, readFileSync, chmodSync, unlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { loadAccounts, saveAccounts, type AccountsStore, type OAuthAccount } from './oauth.js';
import { readCodexUsage } from './codex-usage.js';

// --- Types ---

export interface UsageCredential {
  access_token: string;
  refresh_token: string;
  expires_at: number;          // Unix ms
  scopes?: string[];
  source: 'keychain-capture' | 'pkce-authorize';
  captured_at: string;         // ISO 8601
}

export type UsageCredentialSource = UsageCredential['source'];

export interface UsageTokenResolution {
  token: string;
  credential_source: UsageCredentialSource;
  credential_fingerprint: string;
}

export interface ExtraUsage {
  is_enabled: boolean;
  used_credits?: number;
}

export interface LastGoodUsage {
  five_hour_pct?: number;
  seven_day_pct?: number;
  five_hour_resets?: string;
  seven_day_resets?: string;
  extra_usage?: ExtraUsage;
  fetched_at: string;
  credential_source?: UsageCredentialSource;
  credential_fingerprint?: string;
}

export interface AccountUsage {
  account: string;
  ok: boolean;
  status?: 'impossible-read' | 'suspect';
  suspect?: boolean;
  error?: string;              // status/short reason only - never a token
  five_hour_pct?: number;      // 0-100
  seven_day_pct?: number;      // 0-100
  five_hour_resets?: string;
  seven_day_resets?: string;
  extra_usage?: ExtraUsage;
  credential_source?: UsageCredentialSource;
  credential_fingerprint?: string;
  last_good?: LastGoodUsage;
  /** Benched/inactive (from the accounts.json `benched` flag): 5h/7d
   *  threshold edges are suppressed for these in the human alert stream. */
  benched?: boolean;
  fetched_at: string;
}

export interface AllUsageResult {
  accounts: AccountUsage[];
  alerts: string[];
}

// Alert thresholds per the directive: 5h > 80%, 7d > 60%, and ANY
// extra_usage.is_enabled with rising used_credits.
export const USAGE_ALERT_5H_PCT = 80;
export const USAGE_ALERT_7D_PCT = 60;
// Fetch failures alert only after 3 consecutive reads: 15 min at the 5-min poll.
export const FETCH_FAIL_ALERT_CYCLES = 3;


// All OAuth constants are taken VERBATIM from the live Claude Code 2.1.173
// binary (string-extracted from its G86 authorize-URL builder), NOT
// reconstructed from memory - memory-based URLs failed Adam's approve step
// three times. The builder keys the authorize HOST on account type:
// loginMethod "claudeai" (personal Max / consumer) -> CLAUDE_AI_AUTHORIZE_URL
// (claude.com/cai, which 307s to claude.ai); "console" -> platform.claude.com.
// Adam's accounts are personal Max = "claudeai", so we MUST use the cai host;
// using the console host got the org-select page then failed at the Max step.
const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_API = 'https://platform.claude.com/v1/oauth/token';
// CLAUDE_AI_AUTHORIZE_URL from the binary - the consumer/Max authorize host.
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize';
// Claude Code's PUBLIC OAuth client id (verbatim in the binary; public by
// design for PKCE, not a secret).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
// MANUAL_REDIRECT_URL from the binary - the hosted paste-back callback
// (isManual=true), so Adam can copy the code. Registered for this client.
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
// The FULL canonical Zq8 scope set the binary requests (dedup union of
// [org:create_api_key, user:profile] and the user:* login family). We request
// it byte-for-byte to match the real client (the discipline that ends the
// frankenstein-deviation failures); the at-rest trust class is then ENFORCED,
// not assumed, by assertGrantedScopeSafe() below - personal Max accounts drop
// org:create_api_key at grant (seat precedent), and any token that comes back
// still carrying key-mint is refused storage and escalated.
const DEFAULT_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

// The key-mint scope - must never reach at-rest storage on a usage credential.
const KEY_MINT_SCOPE = 'org:create_api_key';

/**
 * Post-grant scope assertion (security-mandated, fail-closed). The usage
 * credential must NOT be key-mint-capable at rest. We request the full
 * canonical set, but only store a token whose GRANTED scope is confirmed to
 * EXCLUDE org:create_api_key.
 *
 * Per RFC6749 5.1 the token response echoes `scope` ONLY when the grant
 * differs from the request. So:
 *  - scope present + no key-mint  -> confirmed drop, safe to store.
 *  - scope present + key-mint     -> granted key-mint, REFUSE.
 *  - scope absent/empty           -> grant == request == key-mint present;
 *                                    UNCONFIRMABLE, REFUSE (absence of
 *                                    confirmation is not confirmation of
 *                                    absence).
 * Returns the granted scope array on success; throws on any refusal so the
 * caller never stores. The caller escalates + flags the issued token for
 * possible revocation (it was minted server-side even if we discard it).
 */
export function assertGrantedScopeSafe(grantedScopeField: string | undefined): string[] {
  const granted = (grantedScopeField ?? '').trim();
  if (!granted) {
    throw new Error(
      'GRANT-ASSERTION TRIP: token response omitted `scope` - per RFC6749 5.1 that means ' +
      'granted == requested, i.e. org:create_api_key (key-mint) was GRANTED. Refusing to ' +
      'store an unconfirmable/key-mint-capable usage credential. Escalate + consider revoking ' +
      'the issued token.',
    );
  }
  const scopes = granted.split(/\s+/).filter(Boolean);
  if (scopes.includes(KEY_MINT_SCOPE)) {
    throw new Error(
      `GRANT-ASSERTION TRIP: granted scope INCLUDES ${KEY_MINT_SCOPE} (key-mint) - this account's ` +
      'grant behavior differs from the personal-Max precedent. Refusing to store a key-mint-capable ' +
      'usage credential. Escalate + consider revoking the issued token.',
    );
  }
  return scopes;
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// --- Helpers ---

/** Stable non-reversible credential id - never includes token bytes. */
export function fingerprint(token: string): string {
  if (!token) return '(empty)';
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function safeStoredFingerprint(value: string): string {
  return value.includes('sk-ant') ? fingerprint(value) : value;
}

function pendingAuthPath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'oauth', 'pending-usage-auth.json');
}

function alertStatePath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'usage', 'alert-state.json');
}

function multiAccountUsagePath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'usage', 'multi-account-usage.json');
}

function diagnosticsPath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'usage', 'diagnostics.jsonl');
}

function rawUsagePath(ctxRoot: string, account: string): string {
  return join(ctxRoot, 'state', 'usage', 'raw', `${account}.json`);
}

function requireStore(ctxRoot: string): AccountsStore {
  const store = loadAccounts(ctxRoot);
  if (!store) throw new Error('No accounts.json found at state/oauth/accounts.json');
  return store;
}

/** Get-or-create an account entry. New entries are usage-only stubs (no inference tokens). */
function ensureAccount(store: AccountsStore, name: string): OAuthAccount {
  if (!store.accounts[name]) {
    store.accounts[name] = {
      label: name,
      access_token: '',
      refresh_token: '',
      expires_at: 0,
      last_refreshed: '',
      five_hour_utilization: 0,
      seven_day_utilization: 0,
    };
  }
  return store.accounts[name];
}

// --- Keychain capture ---

interface KeychainBlob {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
}

/**
 * Read the full Claude Code login blob from the macOS Keychain.
 * Read-only query of the existing item - no writes, no new entries.
 * Injectable for tests (never hit the real keychain in CI).
 */
export function readKeychainBlob(): KeychainBlob | null {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 },
    ).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { claudeAiOauth?: KeychainBlob };
    return parsed?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

/**
 * Capture the machine's current login-class keychain credential as the named
 * account's usage_credential. Returns a SAFE summary (fingerprint only).
 */
export function captureKeychainUsageCredential(
  ctxRoot: string,
  accountName: string,
  blobReader: () => KeychainBlob | null = readKeychainBlob,
): { account: string; fingerprint: string; scopes: string[]; expires_at: string } {
  const blob = blobReader();
  if (!blob?.accessToken || !blob?.refreshToken) {
    throw new Error(
      `Keychain item "${KEYCHAIN_SERVICE}" missing or incomplete (need accessToken+refreshToken). ` +
      'Is this machine logged into Claude Code with a login-class session?',
    );
  }
  const scopes = blob.scopes ?? [];
  if (!scopes.includes('user:profile')) {
    throw new Error(
      `Keychain credential lacks user:profile scope (has: ${scopes.join(', ') || 'none'}) - ` +
      'the usage API would 403. This looks like a setup-token, not a login session.',
    );
  }
  const store = requireStore(ctxRoot);
  const account = ensureAccount(store, accountName);
  account.usage_credential = {
    access_token: blob.accessToken,
    refresh_token: blob.refreshToken,
    expires_at: blob.expiresAt ?? 0,
    scopes,
    source: 'keychain-capture',
    captured_at: new Date().toISOString(),
  };
  saveAccounts(ctxRoot, store);
  return {
    account: accountName,
    fingerprint: fingerprint(blob.accessToken),
    scopes,
    expires_at: blob.expiresAt ? new Date(blob.expiresAt).toISOString() : 'unknown',
  };
}

// --- PKCE authorize flow (usage-scope tokens for non-machine accounts) ---

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Begin the PKCE flow for an account. Prints nothing itself - returns the
 * authorize URL for the caller to surface. Adam opens it in a browser that is
 * logged into the TARGET account, approves, and pastes back the code
 * ("<code>#<state>" from the callback page). The machine's own login is
 * never touched.
 */
export function beginUsageAuth(
  ctxRoot: string,
  accountName: string,
  scopes: string = DEFAULT_SCOPES,
): { account: string; url: string; expires_note: string } {
  // Verifier + state both = 32 random bytes b64url (43 chars), byte-matching
  // the real Claude Code client (binary: verifier=EAK()=b64url(randomBytes(32)),
  // state=CAK()=b64url(randomBytes(32)) - separate randoms, both 32 bytes). A
  // 16-byte (22-char) state was the last deviation from the client and the
  // suspected cause of the approve-POST "invalid request format".
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(32));

  ensureDir(join(ctxRoot, 'state', 'oauth'));
  const path = pendingAuthPath(ctxRoot);
  atomicWriteSync(path, JSON.stringify({
    account: accountName,
    verifier,
    state,
    scopes,
    created_at: new Date().toISOString(),
  }, null, 2));
  try { chmodSync(path, 0o600); } catch { /* ignore */ }

  // Build via URL + searchParams to byte-match the real client's G86 builder
  // (new URL(...).searchParams.append(...)). URLSearchParams serializes a
  // SPACE as "+" (not "%20"), so the multi-scope value matches the client
  // exactly; append order matches G86: code, client_id, response_type,
  // redirect_uri, scope, code_challenge, code_challenge_method, state.
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.append('code', 'true');
  u.searchParams.append('client_id', CLIENT_ID);
  u.searchParams.append('response_type', 'code');
  u.searchParams.append('redirect_uri', REDIRECT_URI);
  u.searchParams.append('scope', scopes);
  u.searchParams.append('code_challenge', challenge);
  u.searchParams.append('code_challenge_method', 'S256');
  u.searchParams.append('state', state);
  const url = u.toString();
  return {
    account: accountName,
    url,
    expires_note: 'Complete within ~10 minutes; one pending auth at a time.',
  };
}

/**
 * Complete the PKCE flow: exchange the pasted code for tokens and store them
 * as the account's usage_credential. Accepts "<code>" or "<code>#<state>".
 */
export async function completeUsageAuth(
  ctxRoot: string,
  accountName: string,
  codeInput: string,
): Promise<{ account: string; fingerprint: string; expires_at: string }> {
  const path = pendingAuthPath(ctxRoot);
  if (!existsSync(path)) {
    throw new Error('No pending usage auth. Run add-usage-account first.');
  }
  const pending = JSON.parse(readFileSync(path, 'utf-8')) as {
    account: string; verifier: string; state: string;
  };
  if (pending.account !== accountName) {
    throw new Error(`Pending auth is for account "${pending.account}", not "${accountName}".`);
  }
  const [code, pastedState] = codeInput.trim().split('#');
  if (pastedState && pastedState !== pending.state) {
    throw new Error('State mismatch - the pasted code is not from this authorize URL. Restart the flow.');
  }

  const response = await fetch(TOKEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      state: pending.state,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
    }),
  });
  if (!response.ok) {
    // Status only - response bodies on token endpoints can echo inputs.
    throw new Error(`Token exchange failed (HTTP ${response.status}). Restart the flow.`);
  }
  const tokens = await response.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number; scope?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Token exchange response missing access_token/refresh_token.');
  }

  // POST-GRANT SCOPE ASSERTION (fail-closed) - BEFORE any store. Throws if the
  // granted scope is key-mint-capable or unconfirmable, so nothing reaches
  // accounts.json. The pending file is intentionally LEFT in place on a trip
  // (we do not consume the flow) and the issued token is flagged for possible
  // revocation in the thrown message.
  const grantedScopes = assertGrantedScopeSafe(tokens.scope);

  const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  const store = requireStore(ctxRoot);
  const account = ensureAccount(store, accountName);
  account.usage_credential = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scopes: grantedScopes,
    source: 'pkce-authorize',
    captured_at: new Date().toISOString(),
  };
  saveAccounts(ctxRoot, store);
  try { unlinkSync(path); } catch { /* ignore */ }

  return {
    account: accountName,
    fingerprint: fingerprint(tokens.access_token),
    expires_at: new Date(expiresAt).toISOString(),
  };
}

// --- Usage credential refresh ---

/**
 * Refresh an expiring usage credential. Write-before-use invariant: the new
 * pair is persisted before the function returns the new access token.
 */
export async function refreshUsageCredential(
  ctxRoot: string,
  accountName: string,
): Promise<string> {
  const store = requireStore(ctxRoot);
  const cred = store.accounts[accountName]?.usage_credential;
  if (!cred?.refresh_token) {
    throw new Error(`Account "${accountName}" has no usage_credential refresh token`);
  }
  const response = await fetch(TOKEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: cred.refresh_token,
      client_id: CLIENT_ID,
    }),
  });
  if (!response.ok) {
    throw new Error(`Usage credential refresh failed for "${accountName}" (HTTP ${response.status})`);
  }
  const tokens = await response.json() as {
    access_token?: string; refresh_token?: string; expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Refresh response missing access_token/refresh_token');
  }
  // ATOMIC WRITE before use - refresh tokens are one-time.
  const reloaded = requireStore(ctxRoot);
  const acct = reloaded.accounts[accountName];
  if (!acct?.usage_credential) throw new Error(`Account "${accountName}" vanished during refresh`);
  acct.usage_credential = {
    ...acct.usage_credential,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  saveAccounts(ctxRoot, reloaded);
  return tokens.access_token;
}

// --- Usage fetch ---

/** Parse the raw usage API response into an AccountUsage. Pure - unit-testable. */
export function parseUsageResponse(account: string, data: unknown, now: string): AccountUsage {
  const d = data as {
    five_hour?: { utilization?: number; resets_at?: string | null };
    seven_day?: { utilization?: number; resets_at?: string | null };
    extra_usage?: { is_enabled?: boolean; used_credits?: number };
  };
  const pct = (v: number | undefined): number | undefined => {
    if (v === undefined) return undefined;
    return Math.round(Math.min(100, Math.max(0, v)));
  };
  // Impossible-read: a window reporting USAGE (>0) with no resets_at - you
  // cannot be at >0% with no active rolling window. utilization:0 + null
  // resets_at is a VALID IDLE window (no recent usage -> no rolling window ->
  // no reset time), verified against raw Anthropic payloads - so a legit idle
  // 0 must NOT trip the detector.
  const invalidWindows: string[] = [];
  if (typeof d.five_hour?.utilization === 'number' && d.five_hour.utilization > 0 && d.five_hour.resets_at == null) {
    invalidWindows.push('five_hour');
  }
  if (typeof d.seven_day?.utilization === 'number' && d.seven_day.utilization > 0 && d.seven_day.resets_at == null) {
    invalidWindows.push('seven_day');
  }
  const subsetInvariantViolated =
    typeof d.five_hour?.utilization === 'number' &&
    typeof d.seven_day?.utilization === 'number' &&
    d.five_hour.utilization >= 100 &&
    d.seven_day.utilization === 0;
  const impossible = invalidWindows.length > 0 || subsetInvariantViolated;
  const impossibleReasons = [
    ...(invalidWindows.length > 0 ? [`${invalidWindows.join('+')} utilization without resets_at`] : []),
    ...(subsetInvariantViolated ? ['five_hour>=100 with seven_day==0 (subset-invariant violation)'] : []),
  ];
  const usage: AccountUsage = {
    account,
    ok: !impossible,
    ...(impossible
      ? {
          status: 'impossible-read' as const,
          error: `impossible-read: ${impossibleReasons.join('; ')}`,
        }
      : {}),
    five_hour_pct: pct(d.five_hour?.utilization),
    seven_day_pct: pct(d.seven_day?.utilization),
    ...(d.five_hour?.resets_at ? { five_hour_resets: d.five_hour.resets_at } : {}),
    ...(d.seven_day?.resets_at ? { seven_day_resets: d.seven_day.resets_at } : {}),
    fetched_at: now,
  };
  if (d.extra_usage && typeof d.extra_usage.is_enabled === 'boolean') {
    usage.extra_usage = {
      is_enabled: d.extra_usage.is_enabled,
      used_credits: d.extra_usage.used_credits,
    };
  }
  return usage;
}

function containsTokenMaterial(value: unknown): boolean {
  return JSON.stringify(value).includes('sk-ant');
}

function recordRawUsageResponse(
  ctxRoot: string,
  account: string,
  responseBody: unknown,
  fetchedAt: string,
  attribution: Omit<UsageTokenResolution, 'token'>,
): void {
  const path = rawUsagePath(ctxRoot, account);
  let entries: unknown[] = [];
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { entries?: unknown[] };
      if (Array.isArray(parsed.entries)) entries = parsed.entries;
    } catch { /* reset corrupt forensic buffer */ }
  }
  const safeBody = containsTokenMaterial(responseBody)
    ? { redacted: true, reason: 'token-like material omitted' }
    : responseBody;
  entries.push({
    fetched_at: fetchedAt,
    credential_source: attribution.credential_source,
    credential_fingerprint: attribution.credential_fingerprint,
    response: safeBody,
  });
  atomicWriteSync(path, JSON.stringify({ account, entries: entries.slice(-20) }, null, 2));
}

type UsageDiagnosticFailure = 'impossible-read' | 'suspect' | 'fetch-fail' | 'no-credential';

interface UsageResponseWindowShape {
  present: boolean;
  keys: string[];
  has_utilization: boolean;
  utilization_type: string | null;
  has_resets_at: boolean;
  resets_at_state: 'present' | 'null' | 'missing';
}

interface UsageResponseShape {
  row: {
    keys: string[];
    has_five_hour_pct: boolean;
    has_seven_day_pct: boolean;
    has_five_hour_resets: boolean;
    has_seven_day_resets: boolean;
    has_extra_usage: boolean;
  };
  raw: {
    found: boolean;
    top_level_keys: string[];
    five_hour: UsageResponseWindowShape;
    seven_day: UsageResponseWindowShape;
    extra_usage_keys: string[];
  };
}

interface UsageDiagnosticEntry {
  ts: string;
  account: string;
  credential_source: UsageCredentialSource | null;
  credential_fingerprint: string | null;
  failure: UsageDiagnosticFailure;
  status: AccountUsage['status'] | null;
  error: string | null;
  which_check: string;
  response_shape: UsageResponseShape;
  prior: { five_hour_pct?: number; seven_day_pct?: number; fetched_at: string } | null;
  suggested_cause: string;
}

const USAGE_DIAGNOSTIC_RETENTION = 500;

function sortedKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

function windowShape(value: unknown): UsageResponseWindowShape {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  return {
    present: record !== null,
    keys: sortedKeys(value),
    has_utilization: record ? Object.prototype.hasOwnProperty.call(record, 'utilization') : false,
    utilization_type: record && Object.prototype.hasOwnProperty.call(record, 'utilization')
      ? typeof record.utilization
      : null,
    has_resets_at: record ? Object.prototype.hasOwnProperty.call(record, 'resets_at') : false,
    resets_at_state: record && Object.prototype.hasOwnProperty.call(record, 'resets_at')
      ? (record.resets_at === null ? 'null' : 'present')
      : 'missing',
  };
}

function latestRawResponse(ctxRoot: string, account: string): unknown {
  const path = rawUsagePath(ctxRoot, account);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { entries?: Array<{ response?: unknown }> };
    return Array.isArray(parsed.entries) ? parsed.entries.at(-1)?.response : undefined;
  } catch {
    return undefined;
  }
}

function usageResponseShape(ctxRoot: string, row: AccountUsage): UsageResponseShape {
  const raw = latestRawResponse(ctxRoot, row.account);
  const rawRecord = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  return {
    row: {
      keys: sortedKeys(row),
      has_five_hour_pct: row.five_hour_pct !== undefined,
      has_seven_day_pct: row.seven_day_pct !== undefined,
      has_five_hour_resets: row.five_hour_resets !== undefined,
      has_seven_day_resets: row.seven_day_resets !== undefined,
      has_extra_usage: row.extra_usage !== undefined,
    },
    raw: {
      found: rawRecord !== null,
      top_level_keys: sortedKeys(raw),
      five_hour: windowShape(rawRecord?.five_hour),
      seven_day: windowShape(rawRecord?.seven_day),
      extra_usage_keys: sortedKeys(rawRecord?.extra_usage),
    },
  };
}

function classifyFailure(row: AccountUsage): UsageDiagnosticFailure {
  if (row.status === 'impossible-read') return 'impossible-read';
  if (row.status === 'suspect') return 'suspect';
  if (row.error === 'no usage_credential') return 'no-credential';
  return 'fetch-fail';
}

function whichCheck(row: AccountUsage, failure: UsageDiagnosticFailure): string {
  if (failure === 'impossible-read') return row.error ?? 'utilization present without resets_at';
  if (failure === 'no-credential') return 'account has no usage_credential configured';
  if (failure === 'suspect') return row.error ?? 'delta sanity marked read as suspect';
  if (row.error?.startsWith('HTTP ')) return `usage API returned ${row.error}`;
  return 'usage credential resolution or fetch threw an exception';
}

function suggestedCause(row: AccountUsage, failure: UsageDiagnosticFailure): string {
  const source = row.credential_source ?? 'unknown';
  const error = row.error ?? 'fetch failed';
  if (failure === 'impossible-read') {
    return `Anthropic usage API returned utilization with null resets_at (degraded/transient zero-payload). Credential ${source} served this read. If transient, self-heals next cycle; if persistent, check the account's pkce/keychain credential.`;
  }
  if (failure === 'suspect' && row.error?.includes('7d rose')) {
    return 'Implausible 7d rise within one cycle - possible cross-account credential mislabel (wrong credential serving this account) OR a genuine fast climb. Compare credential_fingerprint against prior cycles; raw buffer state/usage/raw/<account>.json has the response.';
  }
  if (failure === 'suspect' && row.error?.includes('dropped to zero')) {
    return 'Window dropped to 0 before its prior reset_at passed - suspect read, not a real reset. Check raw buffer.';
  }
  if (failure === 'fetch-fail' && row.error === 'HTTP 401') {
    return 'Auth rejected - credential expired/invalid; pkce should reactive-refresh, keychain re-reads live. If persistent, re-capture the credential.';
  }
  if (failure === 'fetch-fail' && row.error?.startsWith('HTTP ')) {
    return `Usage API ${row.error} - transient API error or rate-limit; retries next cycle.`;
  }
  if (failure === 'fetch-fail') {
    return `${error} - credential resolution or network failure before/at fetch.`;
  }
  return 'Account has no usage_credential configured - add via capture-usage-credential (keychain) or add-usage-account (pkce).';
}

function diagnosticPrior(row: AccountUsage): UsageDiagnosticEntry['prior'] {
  if (!row.last_good) return null;
  return {
    ...(row.last_good.five_hour_pct !== undefined ? { five_hour_pct: row.last_good.five_hour_pct } : {}),
    ...(row.last_good.seven_day_pct !== undefined ? { seven_day_pct: row.last_good.seven_day_pct } : {}),
    fetched_at: row.last_good.fetched_at,
  };
}

function buildUsageDiagnostic(ctxRoot: string, row: AccountUsage, ts: string): UsageDiagnosticEntry {
  const failure = classifyFailure(row);
  return {
    ts,
    account: row.account,
    credential_source: row.credential_source ?? null,
    credential_fingerprint: row.credential_fingerprint ?? null,
    failure,
    status: row.status ?? null,
    error: row.error ?? null,
    which_check: whichCheck(row, failure),
    response_shape: usageResponseShape(ctxRoot, row),
    prior: diagnosticPrior(row),
    suggested_cause: suggestedCause(row, failure),
  };
}

function appendUsageDiagnostics(ctxRoot: string, rows: AccountUsage[], ts: string): void {
  const failures = rows.filter((row) => row.ok === false);
  if (failures.length === 0) return;
  const path = diagnosticsPath(ctxRoot);
  const entries = failures.map((row) => buildUsageDiagnostic(ctxRoot, row, ts));
  if (containsTokenMaterial(entries)) {
    throw new Error('usage diagnostic contained token-like material');
  }
  let existing: string[] = [];
  if (existsSync(path)) {
    existing = readFileSync(path, 'utf-8')
      .split(/\n/)
      .filter((line) => line.trim().length > 0 && !line.includes('sk-ant'));
  }
  const next = existing.concat(entries.map((entry) => JSON.stringify(entry))).slice(-USAGE_DIAGNOSTIC_RETENTION);
  atomicWriteSync(path, `${next.join('\n')}\n`);
}

/**
 * Resolve a usable access token for an account, branching on credential
 * SOURCE:
 *
 * - keychain-capture: the SEAT account whose credential lives in the macOS
 *   Keychain, OWNED by the live Claude Code app. That app rotates its
 *   one-time refresh token on its own ~8h cycle, which invalidates any copy
 *   we captured (HTTP 400 on our refresh, proven live 2026-06-11 at the 09:00Z
 *   rotation). So for this source we RE-READ the keychain live on every use
 *   (it is always fresh there) and never store/refresh the token ourselves.
 *   The stored usage_credential is kept only as a metadata pointer (source +
 *   scopes + a refreshed expiry/captured_at for visibility), never the
 *   authority. Self-healing: no manual re-capture needed across rotations.
 *
 * - pkce-authorize: the Max accounts whose tokens NOTHING else owns - we are
 *   the sole holder, so store + proactive/reactive refresh is correct and
 *   stays as-is.
 *
 * Returns the token in-memory only (never logged/persisted in cleartext).
 */
export async function resolveUsageToken(
  ctxRoot: string,
  accountName: string,
  blobReader: () => KeychainBlob | null = readKeychainBlob,
): Promise<string> {
  return (await resolveUsageTokenWithAttribution(ctxRoot, accountName, blobReader)).token;
}

export async function resolveUsageTokenWithAttribution(
  ctxRoot: string,
  accountName: string,
  blobReader: () => KeychainBlob | null = readKeychainBlob,
): Promise<UsageTokenResolution> {
  const store = requireStore(ctxRoot);
  const cred = store.accounts[accountName]?.usage_credential;
  if (!cred) throw new Error('no usage_credential');

  if (cred.source === 'keychain-capture') {
    const blob = blobReader();
    if (!blob?.accessToken) {
      throw new Error('keychain credential unavailable (machine logged out?)');
    }
    if (blob.scopes && !blob.scopes.includes('user:profile')) {
      throw new Error('keychain credential lost user:profile scope');
    }
    // Refresh the stored metadata pointer for dashboard/list visibility,
    // but the token authority is always the live keychain read.
    if (blob.accessToken !== cred.access_token || (blob.expiresAt ?? 0) !== cred.expires_at) {
      const reloaded = requireStore(ctxRoot);
      const c = reloaded.accounts[accountName]?.usage_credential;
      if (c) {
        c.access_token = blob.accessToken;
        c.refresh_token = blob.refreshToken ?? c.refresh_token;
        c.expires_at = blob.expiresAt ?? c.expires_at;
        c.scopes = blob.scopes ?? c.scopes;
        saveAccounts(ctxRoot, reloaded);
      }
    }
    return {
      token: blob.accessToken,
      credential_source: 'keychain-capture',
      credential_fingerprint: fingerprint(blob.accessToken),
    };
  }

  // pkce-authorize: stored token, proactive refresh when expiring soon.
  if (!cred.access_token) throw new Error('no usage_credential access token');
  if (cred.expires_at && cred.expires_at - Date.now() < 5 * 60 * 1000) {
    const token = await refreshUsageCredential(ctxRoot, accountName);
    return {
      token,
      credential_source: 'pkce-authorize',
      credential_fingerprint: fingerprint(token),
    };
  }
  return {
    token: cred.access_token,
    credential_source: 'pkce-authorize',
    credential_fingerprint: fingerprint(cred.access_token),
  };
}

/**
 * Fetch usage for one account, resolving its token by SOURCE (live keychain
 * read for the seat, stored+refresh for PKCE - see resolveUsageToken).
 * Errors are captured per account (never thrown to the caller) so one bad
 * account cannot blind the others - the same isolation lesson as
 * resolve_cards/reminders.
 */
export async function fetchAccountUsage(
  ctxRoot: string,
  accountName: string,
  blobReader: () => KeychainBlob | null = readKeychainBlob,
): Promise<AccountUsage> {
  const now = new Date().toISOString();
  const store = requireStore(ctxRoot);
  const cred = store.accounts[accountName]?.usage_credential;
  if (!cred) {
    return { account: accountName, ok: false, error: 'no usage_credential', fetched_at: now };
  }
  const isKeychain = cred.source === 'keychain-capture';
  let attribution: Omit<UsageTokenResolution, 'token'> | undefined;
  try {
    let resolved = await resolveUsageTokenWithAttribution(ctxRoot, accountName, blobReader);
    attribution = {
      credential_source: resolved.credential_source,
      credential_fingerprint: resolved.credential_fingerprint,
    };
    let response = await fetch(USAGE_API, {
      headers: { Authorization: `Bearer ${resolved.token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    });
    if (response.status === 401 && !isKeychain) {
      // Reactive refresh+retry only for PKCE (a fresh keychain read already
      // gave the newest token; a 401 there is not fixable by re-reading).
      const token = await refreshUsageCredential(ctxRoot, accountName);
      resolved = {
        token,
        credential_source: 'pkce-authorize',
        credential_fingerprint: fingerprint(token),
      };
      attribution = {
        credential_source: resolved.credential_source,
        credential_fingerprint: resolved.credential_fingerprint,
      };
      response = await fetch(USAGE_API, {
        headers: { Authorization: `Bearer ${resolved.token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      });
    }
    if (!response.ok) {
      return {
        account: accountName,
        ok: false,
        error: `HTTP ${response.status}`,
        fetched_at: now,
        ...(attribution ?? {}),
      };
    }
    const raw = await response.json();
    recordRawUsageResponse(ctxRoot, accountName, raw, now, resolved);
    return {
      ...parseUsageResponse(accountName, raw, now),
      credential_source: resolved.credential_source,
      credential_fingerprint: resolved.credential_fingerprint,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { account: accountName, ok: false, error: msg.slice(0, 200), fetched_at: now, ...(attribution ?? {}) };
  }
}

// --- All-accounts check + alerts ---

/**
 * Per-account last-ALERTED signature for edge-triggered dedup. The monitor
 * runs every 15 min; alerting on LEVEL (re-firing every cycle a signal is
 * over threshold or a meter is enabled) = ~96 pings/day of noise. We alert on
 * the EDGE instead - when a signal turns on, escalates, or transitions - and
 * stay quiet while it persists unchanged, re-alerting only if it clears then
 * recurs.
 */
interface AccountAlertState {
  five_h_over: boolean;     // CONFIRMED alerting: 5h over for >=2 consecutive reads
  seven_d_over: boolean;    // CONFIRMED alerting: 7d over for >=2 consecutive reads
  five_h_pending: boolean;  // saw ONE over-read; awaiting a 2nd consecutive to confirm
  seven_d_pending: boolean; // saw ONE over-read; awaiting a 2nd consecutive to confirm
  extra_enabled: boolean;   // last-seen: extra-usage meter enabled
  extra_credits: number;    // last-seen: credits (for rise detection)
  fetch_failing: boolean;   // last-seen: fetch failing (monitoring blind)
  fail_consecutive?: number; // consecutive ok:false reads in the current episode
  fetch_fail_alerted?: boolean; // FAIL alert sent for the current episode
  at: string;
}

interface AlertState {
  [account: string]: AccountAlertState;
}

const DELTA_SANITY_MAX_CYCLE_MS = 10 * 60_000;
const SEVEN_DAY_RISE_SUSPECT_POINTS = 30;

function loadPriorUsage(ctxRoot: string): Map<string, AccountUsage> {
  const prior = new Map<string, AccountUsage>();
  const path = multiAccountUsagePath(ctxRoot);
  if (!existsSync(path)) return prior;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { accounts?: unknown[] };
    if (!Array.isArray(parsed.accounts)) return prior;
    for (const row of parsed.accounts) {
      if (typeof row === 'object' && row !== null && typeof (row as AccountUsage).account === 'string') {
        prior.set((row as AccountUsage).account, row as AccountUsage);
      }
    }
  } catch { /* no prior */ }
  return prior;
}

function lastGoodFrom(prior: AccountUsage | undefined): LastGoodUsage | undefined {
  if (!prior?.ok || prior.status) return undefined;
  return {
    ...(prior.five_hour_pct !== undefined ? { five_hour_pct: prior.five_hour_pct } : {}),
    ...(prior.seven_day_pct !== undefined ? { seven_day_pct: prior.seven_day_pct } : {}),
    ...(prior.five_hour_resets ? { five_hour_resets: prior.five_hour_resets } : {}),
    ...(prior.seven_day_resets ? { seven_day_resets: prior.seven_day_resets } : {}),
    ...(prior.extra_usage ? { extra_usage: prior.extra_usage } : {}),
    fetched_at: prior.fetched_at,
    ...(prior.credential_source ? { credential_source: prior.credential_source } : {}),
    ...(prior.credential_fingerprint ? { credential_fingerprint: safeStoredFingerprint(prior.credential_fingerprint) } : {}),
  };
}

function hasPassedReset(reset: string | undefined, fetchedAt: string): boolean {
  if (!reset) return false;
  const resetAt = Date.parse(reset);
  const fetched = Date.parse(fetchedAt);
  return !Number.isNaN(resetAt) && !Number.isNaN(fetched) && resetAt <= fetched;
}

function withinDeltaCycle(prior: AccountUsage, current: AccountUsage): boolean {
  const prev = Date.parse(prior.fetched_at);
  const now = Date.parse(current.fetched_at);
  if (Number.isNaN(prev) || Number.isNaN(now)) return false;
  const elapsed = now - prev;
  return elapsed >= 0 && elapsed <= DELTA_SANITY_MAX_CYCLE_MS;
}

function markSuspect(usage: AccountUsage, prior: AccountUsage, reason: string): AccountUsage {
  return {
    ...usage,
    ok: false,
    status: 'suspect',
    suspect: true,
    error: `suspect-read: ${reason}`,
    last_good: lastGoodFrom(prior),
  };
}

function applyUsageGuards(usages: AccountUsage[], prior: Map<string, AccountUsage>): AccountUsage[] {
  return usages.map((usage) => {
    const previous = prior.get(usage.account);
    const lastGood = lastGoodFrom(previous);
    if (!usage.ok) {
      return lastGood ? { ...usage, last_good: lastGood } : usage;
    }
    if (!previous?.ok || !withinDeltaCycle(previous, usage)) {
      return usage;
    }

    const sevenRise = usage.seven_day_pct !== undefined && previous.seven_day_pct !== undefined
      ? usage.seven_day_pct - previous.seven_day_pct
      : 0;
    if (sevenRise > SEVEN_DAY_RISE_SUSPECT_POINTS) {
      return markSuspect(usage, previous, `7d rose ${sevenRise} points within ${DELTA_SANITY_MAX_CYCLE_MS / 60_000}m`);
    }

    if (
      previous.five_hour_pct !== undefined &&
      previous.five_hour_pct > 0 &&
      usage.five_hour_pct === 0 &&
      !hasPassedReset(previous.five_hour_resets, usage.fetched_at)
    ) {
      return markSuspect(usage, previous, '5h dropped to zero before prior reset timestamp passed');
    }

    if (
      previous.seven_day_pct !== undefined &&
      previous.seven_day_pct > 0 &&
      usage.seven_day_pct === 0 &&
      !hasPassedReset(previous.seven_day_resets, usage.fetched_at)
    ) {
      return markSuspect(usage, previous, '7d dropped to zero before prior reset timestamp passed');
    }

    return usage;
  });
}

/**
 * One step of the 2-consecutive-read threshold confirmation, per account per
 * bucket. A single over-read is a CANDIDATE (pending), not an alert; the alert
 * fires only on a 2nd consecutive over-read; a single over-read followed by an
 * under-read is absorbed (transient/anomalous spike). Recovery fires when a
 * CONFIRMED-over state clears. Benched accounts compute the same state but
 * suppress the alert string (state stays correct for un-bench). Pure.
 */
function stepThreshold(
  over: boolean,
  prevOver: boolean,
  prevPending: boolean,
  benched: boolean,
  fireMsg: string,
  recoverMsg: string,
): { alert: string | null; over: boolean; pending: boolean } {
  if (over) {
    if (prevOver) return { alert: null, over: true, pending: false };        // already alerting -> quiet
    if (prevPending) return { alert: benched ? null : fireMsg, over: true, pending: false }; // 2nd consecutive -> CONFIRM
    return { alert: null, over: false, pending: true };                      // 1st over-read -> candidate, suppress
  }
  if (prevOver) return { alert: benched ? null : recoverMsg, over: false, pending: false };  // confirmed-over cleared -> recovery
  return { alert: null, over: false, pending: false };                       // under (and a lone prior candidate, if any, absorbed)
}

/** Render an ISO timestamp in Pacific time for human-facing alert text
 *  (fleet rule 2026-06-11: humans see PT, internals stay UTC). */
export function ptTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' PT';
}

/**
 * Evaluate alerts for a set of account usages with EDGE-TRIGGERED dedup. Pure
 * given the previous alert state - unit-testable. Alerts fire on a state
 * CHANGE (turn-on, escalation, recovery/clear, transition) and stay quiet
 * while a state persists unchanged, so a 15-min cadence does not spam (~96
 * pings/day) on a persistent condition (e.g. me-com at 7d 95% until its
 * Sunday reset). Returns alert strings + the next state to persist.
 */
export function evaluateAlerts(
  usages: AccountUsage[],
  prevState: AlertState,
  now: string,
  display?: Record<string, string>,
): { alerts: string[]; nextState: AlertState } {
  const alerts: string[] = [];
  const nextState: AlertState = { ...prevState };
  for (const u of usages) {
    // Human-facing name: "email (pool-label)" when the account has an email
    // (Adam request - matches Anthropic billing pages), else the pool label.
    // DISPLAY ONLY: state keys stay pool-label so alert dedup/edge state is
    // unaffected by email backfills.
    const who = display?.[u.account] ?? u.account;
    const prev: AccountAlertState = prevState[u.account] ?? {
      five_h_over: false, seven_d_over: false,
      five_h_pending: false, seven_d_pending: false,
      extra_enabled: false, extra_credits: 0, fetch_failing: false,
      fail_consecutive: 0, fetch_fail_alerted: false, at: now,
    };
    // Start from prev and carry forward; a failing fetch must NOT reset the
    // 5h/7d/extra edges (we just cannot read them this cycle).
    const next: AccountAlertState = { ...prev, at: now };

    if (!u.ok) {
      const failConsecutive = (prev.fail_consecutive ?? 0) + 1;
      const alreadyAlerted = prev.fetch_fail_alerted === true;
      if (failConsecutive >= FETCH_FAIL_ALERT_CYCLES && !alreadyAlerted) {
        alerts.push(`USAGE-FETCH-FAIL ${who}: ${u.error} (monitoring blind for this account)`);
        next.fetch_fail_alerted = true;
      } else {
        next.fetch_fail_alerted = alreadyAlerted;
      }
      next.fetch_failing = true;
      next.fail_consecutive = failConsecutive;
      nextState[u.account] = next;
      continue;
    }
    // Recovery alerts only after a FAIL was sent for this episode; sub-threshold
    // blips reset silently.
    if (prev.fetch_fail_alerted === true) {
      alerts.push(`RECOVERED ${who}: usage fetch restored (monitoring back online)`);
    }
    next.fetch_failing = false;
    next.fetch_fail_alerted = false;
    next.fail_consecutive = 0;

    // Threshold edges are suppressed for benched accounts (not decision-
    // relevant - nothing to act on). State is still tracked so an un-benched
    // account resumes clean edge behavior. Extra-usage + fetch-fail below are
    // NOT suppressed (those stay decision-relevant regardless of bench).
    // Benched is DATA (accounts.json benched flag, surfaced onto AccountUsage),
    // not a code const - so the Sunday un-bench is a config flip, never a
    // silent blind spot from a stale hardcode under fresh load.
    const benched = u.benched === true;

    // 5h threshold - 2-consecutive-read confirm + recovery. A single over-read
    // (a transient/anomalous API spike like the 21->100->2 on 2026-06-11) is
    // absorbed: it becomes a pending candidate and only CONFIRMS into an alert
    // on a 2nd consecutive over-read.
    const fiveOver = u.five_hour_pct !== undefined && u.five_hour_pct > USAGE_ALERT_5H_PCT;
    const five = stepThreshold(fiveOver, prev.five_h_over, prev.five_h_pending, benched,
      `5H ${who}: ${u.five_hour_pct}% (>${USAGE_ALERT_5H_PCT}%)${u.five_hour_resets ? ` resets ${ptTime(u.five_hour_resets)}` : ''}`,
      `RECOVERED ${who}: 5h back under ${USAGE_ALERT_5H_PCT}% (now ${u.five_hour_pct ?? '?'}%)`);
    if (five.alert) alerts.push(five.alert);
    next.five_h_over = five.over;
    next.five_h_pending = five.pending;

    // 7d threshold - same 2-consecutive-read confirm + recovery (the Sunday
    // reset clears 95% -> recovery line once confirmed-over clears).
    const sevenOver = u.seven_day_pct !== undefined && u.seven_day_pct > USAGE_ALERT_7D_PCT;
    const seven = stepThreshold(sevenOver, prev.seven_d_over, prev.seven_d_pending, benched,
      `7D ${who}: ${u.seven_day_pct}% (>${USAGE_ALERT_7D_PCT}%)${u.seven_day_resets ? ` resets ${ptTime(u.seven_day_resets)}` : ''}`,
      `RECOVERED ${who}: 7d back under ${USAGE_ALERT_7D_PCT}% (now ${u.seven_day_pct ?? '?'}%)`);
    if (seven.alert) alerts.push(seven.alert);
    next.seven_d_over = seven.over;
    next.seven_d_pending = seven.pending;

    // Extra-usage - enable / disable / rise edges; quiet on flat-enabled.
    const enabled = u.extra_usage?.is_enabled === true;
    const credits = u.extra_usage?.used_credits ?? 0;
    if (enabled && !prev.extra_enabled) {
      alerts.push(
        credits > 0
          ? `EXTRA-USAGE ${who}: ENABLED with ${credits} credits already used (silent billing - first sighting)`
          : `EXTRA-USAGE ${who}: ENABLED (no credits used yet - watch)`,
      );
    } else if (!enabled && prev.extra_enabled) {
      alerts.push(`EXTRA-USAGE ${who}: DISABLED (was at ${prev.extra_credits} credits) - meter walled off`);
    } else if (enabled && prev.extra_enabled && credits > prev.extra_credits) {
      alerts.push(`EXTRA-USAGE ${who}: credits RISING ${prev.extra_credits} -> ${credits} (delta +${credits - prev.extra_credits} since ${ptTime(prev.at)}) (silent billing ACTIVE)`);
    }
    // enabled + flat, or persistently disabled -> quiet.
    next.extra_enabled = enabled;
    next.extra_credits = enabled ? credits : prev.extra_credits;

    nextState[u.account] = next;
  }
  return { alerts, nextState };
}

/**
 * Set/clear an account's benched flag (config, not code). Benched accounts
 * have their 5h/7d threshold alerts suppressed; un-benching (the Sunday
 * re-enlist runbook) restores them with one command and no code edit. Throws
 * if the account is absent so a typo cannot silently no-op.
 */
export function setAccountBenched(ctxRoot: string, accountName: string, benched: boolean): void {
  const store = requireStore(ctxRoot);
  if (!store.accounts[accountName]) {
    throw new Error(`Account "${accountName}" not found in accounts.json`);
  }
  store.accounts[accountName].benched = benched;
  saveAccounts(ctxRoot, store);
}

/**
 * Fetch usage for EVERY account that has a usage_credential, evaluate alerts,
 * persist extra-usage state. Accounts without a credential are reported
 * (visible gap) rather than silently skipped.
 */
export async function checkAllUsage(
  ctxRoot: string,
  blobReader: () => KeychainBlob | null = readKeychainBlob,
): Promise<AllUsageResult> {
  const store = requireStore(ctxRoot);
  const now = new Date().toISOString();
  const names = Object.keys(store.accounts);
  const priorUsage = loadPriorUsage(ctxRoot);
  const usages: AccountUsage[] = [];
  for (const name of names) {
    const usage = store.accounts[name].usage_credential
      ? await fetchAccountUsage(ctxRoot, name, blobReader)
      : { account: name, ok: false, error: 'no usage_credential', fetched_at: now };
    // Surface the account's benched flag onto the usage so the (pure) alert
    // evaluator can suppress threshold edges by DATA, not a code const.
    usage.benched = store.accounts[name].benched === true;
    usages.push(usage);
  }
  const guardedUsages = applyUsageGuards(usages, priorUsage);
  try {
    appendUsageDiagnostics(ctxRoot, guardedUsages, now);
  } catch { /* diagnostics are best-effort; never break usage monitoring */ }

  // Edge-triggered alert dedup: load the per-account last-alerted state so a
  // persistent condition does not re-fire every (now 15-min) cycle.
  let prevState: AlertState = {};
  const statePath = alertStatePath(ctxRoot);
  if (existsSync(statePath)) {
    try { prevState = JSON.parse(readFileSync(statePath, 'utf-8')) as AlertState; } catch { /* fresh */ }
  }
  // "email (pool-label)" display map for alert strings (display-only).
  const display: Record<string, string> = {};
  for (const name of names) {
    const email = store.accounts[name].email;
    if (email) display[name] = `${email} (${name})`;
  }
  const { alerts, nextState } = evaluateAlerts(guardedUsages, prevState, now, display);
  ensureDir(join(ctxRoot, 'state', 'usage'));
  atomicWriteSync(statePath, JSON.stringify(nextState, null, 2));

  // Persist a consolidated all-accounts snapshot for the dashboard's
  // 3-account panel. One file (not the per-account latest-*.json the
  // single-account refreshUsage path owns) so the dashboard does one read and
  // there is no shape conflict. The 15-min launchd check-all-usage run
  // refreshes it. Usage numbers + reset times + extra-usage state only - never a token.
  atomicWriteSync(
    multiAccountUsagePath(ctxRoot),
    JSON.stringify({ generated_at: now, accounts: guardedUsages }, null, 2),
  );

  // Fold the Codex (ChatGPT plan) usage into the same 15-min write so it rides
  // the existing sync (no new launchd job, no dashboard render-time scan of
  // ~/.codex/sessions). ZERO-TOKEN local-file read - failure is non-fatal
  // (Codex is an adjacent display, never blocks the Claude usage write).
  try {
    const codex = readCodexUsage();
    if (codex) {
      atomicWriteSync(
        join(ctxRoot, 'state', 'usage', 'codex-usage.json'),
        JSON.stringify({ generated_at: now, codex }, null, 2),
      );
    }
  } catch { /* Codex usage is best-effort; never break the Claude write */ }

  return { accounts: guardedUsages, alerts };
}
