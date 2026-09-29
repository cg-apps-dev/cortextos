/**
 * PTY output redaction.
 *
 * Secret-bearing output can reach the PTY capture stream whenever an agent
 * runs a shell command that prints credentials — curl -v against an
 * authenticated endpoint, wget --debug, openssl s_client, dumping a cookie
 * jar, etc. The PTY's OutputBuffer ring captures everything the child
 * process emits and also streams it verbatim to a persisted stdout.log.
 * Without redaction, any JWT, bearer token, or session cookie that happens
 * to appear in the agent's terminal ends up persisted to disk indefinitely.
 *
 * Origin: discovered via a baseline gitleaks audit of agent stdout logs
 * which found 16 JWTs (`authjs.session-token=eyJ...`) emitted to stdout
 * by `curl -v` against an authenticated NextAuth endpoint. Initial
 * hypothesis was that a logging code path was at fault; the actual cause
 * turned out to be agent-level shell commands the PTY captured faithfully.
 * The fix therefore lives at the PTY layer (defense-in-depth for any
 * future exposure via any tool) rather than in an individual code path.
 *
 * Known limitation: PTY data arrives in OS-buffered chunks (typically 4KB
 * on Linux). If a chunk boundary happens to fall inside a JWT, neither
 * chunk matches the regex and the token slips through unredacted across
 * two push() calls. JWTs are typically 300-500 bytes and sk-ant tokens
 * ~50-108 bytes, so both fit in one chunk in the overwhelming majority of
 * real cases — every observed leak in the origin audit fit in a single
 * chunk. sk-ant coverage shares this exact limitation. Buffer-aware redaction
 * (carry a trailing partial-match buffer across chunks) is the follow-up
 * if this edge case ever surfaces in production. Test `chunk-boundary
 * regression guard` in output-buffer.test.ts locks this documented
 * behavior in place so any future change has to be explicit.
 */

/**
 * JWT shape: three base64url segments separated by dots, each at least
 * 10 characters long. The length qualifier prevents false positives on
 * random short alphanumeric sequences that happen to contain two dots
 * (e.g. "a.b.c" or "v1.2.3" would not match). `eyJ` prefix anchors on
 * the standard JWT header (base64 encoding of `{"alg":...` or
 * `{"typ":...`).
 */
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

/**
 * Anthropic sk-ant token — ANY subtype (oat01/ort01/api03/sid01/sk01/future).
 * Covers the fleet's runtime BEARER credential (oat01, spend-capable, ~1-year)
 * AND the OAuth REFRESH token (ort01, spend-adjacent). Highest-value leak
 * shape: an agent echoing its env, a `ps eww`, a `curl -v` against the
 * Anthropic API, or an error dumping CLAUDE_CODE_OAUTH_TOKEN all put it on the
 * terminal, and without this it persists to stdout.log in cleartext —
 * violating the standing rule that tokens live ONLY in .env (0600) +
 * out-of-tree backups, never in a transcript that can ride into git or the
 * agent-state backup.
 *
 * Shape is byte-identical to tools/gitleaks-fleet.toml's `anthropic-sk-ant-token`
 * rule (detect-at-rest ⇔ redact-in-flight parity): the `[a-z0-9]{2,}` subtype
 * segment matches ANY current or future subtype, NOT a closed enumeration — so
 * a token gitleaks would flag at-rest (including ort01) is also scrubbed
 * in-flight. If one is tightened or loosened, update BOTH. The FP guard is the
 * 40+ contiguous-suffix qualifier (NOT the subtype): truncated placeholders
 * ("sk-ant-oat01-u…hQAA"), suffixless "sk-ant-oat01", and bare "sk-ant" prose
 * do NOT match. Like JWT_PATTERN it is linear — bounded char-class runs, no
 * nested quantifiers — so it cannot catastrophically backtrack on adversarial
 * PTY input.
 */
const SK_ANT_PATTERN = /sk-ant-[a-z0-9]{2,}-[A-Za-z0-9_-]{40,}/g;

/**
 * Redact JWT-shaped tokens and Anthropic sk-ant bearer/API/session tokens
 * from a PTY output chunk.
 *
 * Replaces each JWT with `[REDACTED_JWT]` and each sk-ant token with
 * `[REDACTED_SK_ANT]` in-place. Non-token content (TUI ANSI escapes, regular
 * stdout, shell prompts, etc.) passes through unchanged. Safe to call on
 * every PTY chunk — both regexes are stateless and scale linearly with input
 * length. Both share the documented cross-chunk limitation above.
 */
export function redactSecrets(data: string): string {
  return data
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(SK_ANT_PATTERN, '[REDACTED_SK_ANT]');
}
