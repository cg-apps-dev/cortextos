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
 *   reference uses fingerprint() => "sk-ant-oat01-m...wQAA" form.
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

// --- Types ---

export interface UsageCredential {
  access_token: string;
  refresh_token: string;
  expires_at: number;          // Unix ms
  scopes?: string[];
  source: 'keychain-capture' | 'pkce-authorize';
  captured_at: string;         // ISO 8601
}

export interface ExtraUsage {
  is_enabled: boolean;
  used_credits?: number;
}

export interface AccountUsage {
  account: string;
  ok: boolean;
  error?: string;              // status/short reason only - never a token
  five_hour_pct?: number;      // 0-100
  seven_day_pct?: number;      // 0-100
  five_hour_resets?: string;
  seven_day_resets?: string;
  extra_usage?: ExtraUsage;
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

const USAGE_API = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_API = 'https://console.anthropic.com/v1/oauth/token';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
// Claude Code's PUBLIC OAuth client id (the same one the interactive
// `claude` login uses - public by design for PKCE; not a secret).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
// Minimum scope set that includes user:profile (the usage API requirement).
// If claude.ai rejects the narrow request, retry with --scopes "org:create_api_key user:profile user:inference".
const DEFAULT_SCOPES = 'user:profile';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

// --- Helpers ---

/** "sk-ant-oat01-m...wQAA" - the ONLY form a token may appear in anywhere. */
export function fingerprint(token: string): string {
  if (!token) return '(empty)';
  if (token.length <= 18) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 14)}...${token.slice(-4)}`;
}

function pendingAuthPath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'oauth', 'pending-usage-auth.json');
}

function extraUsageStatePath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'usage', 'extra-usage.json');
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
  // Verifier: 43-128 chars; 32 random bytes b64url = 43 chars.
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

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

  const url = `${AUTHORIZE_URL}?code=true&client_id=${CLIENT_ID}&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
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

  const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
  const store = requireStore(ctxRoot);
  const account = ensureAccount(store, accountName);
  account.usage_credential = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scopes: tokens.scope ? tokens.scope.split(' ') : undefined,
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
    five_hour?: { utilization?: number; resets_at?: string };
    seven_day?: { utilization?: number; resets_at?: string };
    extra_usage?: { is_enabled?: boolean; used_credits?: number };
  };
  const pct = (v: number | undefined): number | undefined => {
    if (v === undefined) return undefined;
    return Math.round(v <= 1 ? v * 100 : v);
  };
  const usage: AccountUsage = {
    account,
    ok: true,
    five_hour_pct: pct(d.five_hour?.utilization),
    seven_day_pct: pct(d.seven_day?.utilization),
    five_hour_resets: d.five_hour?.resets_at,
    seven_day_resets: d.seven_day?.resets_at,
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

/**
 * Fetch usage for one account via its usage_credential, auto-refreshing an
 * expired/rejected token once. Errors are captured per account (never thrown
 * to the caller) so one bad account cannot blind the others - the same
 * isolation lesson as resolve_cards/reminders.
 */
export async function fetchAccountUsage(ctxRoot: string, accountName: string): Promise<AccountUsage> {
  const now = new Date().toISOString();
  const store = requireStore(ctxRoot);
  const cred = store.accounts[accountName]?.usage_credential;
  if (!cred?.access_token) {
    return { account: accountName, ok: false, error: 'no usage_credential', fetched_at: now };
  }
  try {
    let token = cred.access_token;
    // Proactive refresh when expiring within 5 minutes.
    if (cred.expires_at && cred.expires_at - Date.now() < 5 * 60 * 1000) {
      token = await refreshUsageCredential(ctxRoot, accountName);
    }
    let response = await fetch(USAGE_API, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    });
    if (response.status === 401) {
      // One reactive refresh+retry.
      token = await refreshUsageCredential(ctxRoot, accountName);
      response = await fetch(USAGE_API, {
        headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      });
    }
    if (!response.ok) {
      return { account: accountName, ok: false, error: `HTTP ${response.status}`, fetched_at: now };
    }
    return parseUsageResponse(accountName, await response.json(), now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { account: accountName, ok: false, error: msg.slice(0, 200), fetched_at: now };
  }
}

// --- All-accounts check + alerts ---

interface ExtraUsageState {
  [account: string]: { used_credits: number; at: string };
}

/**
 * Evaluate alerts for a set of account usages. Pure given the previous
 * extra-usage state - unit-testable. Returns alert strings + the next state.
 */
export function evaluateAlerts(
  usages: AccountUsage[],
  prevExtra: ExtraUsageState,
  now: string,
): { alerts: string[]; nextExtra: ExtraUsageState } {
  const alerts: string[] = [];
  const nextExtra: ExtraUsageState = { ...prevExtra };
  for (const u of usages) {
    if (!u.ok) {
      alerts.push(`USAGE-FETCH-FAIL ${u.account}: ${u.error} (monitoring blind for this account)`);
      continue;
    }
    if (u.five_hour_pct !== undefined && u.five_hour_pct > USAGE_ALERT_5H_PCT) {
      alerts.push(`5H ${u.account}: ${u.five_hour_pct}% (>${USAGE_ALERT_5H_PCT}%)${u.five_hour_resets ? ` resets ${u.five_hour_resets}` : ''}`);
    }
    if (u.seven_day_pct !== undefined && u.seven_day_pct > USAGE_ALERT_7D_PCT) {
      alerts.push(`7D ${u.account}: ${u.seven_day_pct}% (>${USAGE_ALERT_7D_PCT}%)${u.seven_day_resets ? ` resets ${u.seven_day_resets}` : ''}`);
    }
    if (u.extra_usage?.is_enabled) {
      const used = u.extra_usage.used_credits ?? 0;
      const prev = prevExtra[u.account]?.used_credits;
      if (prev === undefined && used > 0) {
        alerts.push(`EXTRA-USAGE ${u.account}: enabled with ${used} credits already used (silent billing - first sighting)`);
      } else if (prev !== undefined && used > prev) {
        alerts.push(`EXTRA-USAGE ${u.account}: credits RISING ${prev} -> ${used} (silent billing active)`);
      } else if (prev === undefined) {
        alerts.push(`EXTRA-USAGE ${u.account}: is_enabled=true (no credits used yet - watch)`);
      }
      nextExtra[u.account] = { used_credits: used, at: now };
    }
  }
  return { alerts, nextExtra };
}

/**
 * Fetch usage for EVERY account that has a usage_credential, evaluate alerts,
 * persist extra-usage state. Accounts without a credential are reported
 * (visible gap) rather than silently skipped.
 */
export async function checkAllUsage(ctxRoot: string): Promise<AllUsageResult> {
  const store = requireStore(ctxRoot);
  const now = new Date().toISOString();
  const names = Object.keys(store.accounts);
  const usages: AccountUsage[] = [];
  for (const name of names) {
    if (store.accounts[name].usage_credential) {
      usages.push(await fetchAccountUsage(ctxRoot, name));
    } else {
      usages.push({ account: name, ok: false, error: 'no usage_credential', fetched_at: now });
    }
  }

  let prevExtra: ExtraUsageState = {};
  const statePath = extraUsageStatePath(ctxRoot);
  if (existsSync(statePath)) {
    try { prevExtra = JSON.parse(readFileSync(statePath, 'utf-8')) as ExtraUsageState; } catch { /* fresh */ }
  }
  const { alerts, nextExtra } = evaluateAlerts(usages, prevExtra, now);
  ensureDir(join(ctxRoot, 'state', 'usage'));
  atomicWriteSync(statePath, JSON.stringify(nextExtra, null, 2));
  return { accounts: usages, alerts };
}
