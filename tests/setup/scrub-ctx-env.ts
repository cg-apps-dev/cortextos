/**
 * Vitest setup file: scrub CTX_* environment variables that leak from a live
 * cortextOS agent shell into the test process.
 *
 * Why: when `npm test` is run from INSIDE a running agent's session, the daemon
 * has already exported CTX_AGENT_DIR / CTX_PROJECT_ROOT / CTX_FRAMEWORK_ROOT /
 * CTX_ORG / CTX_AGENT_NAME / etc. into the environment. CLI-invoking suites set
 * their OWN tmp CTX_FRAMEWORK_ROOT but do not clear the inherited CTX_AGENT_DIR,
 * so the CLI's sandbox/live-leak guard ("CTX_AGENT_DIR ... is not under
 * CTX_FRAMEWORK_ROOT") fires and ~33 otherwise-passing tests fail spuriously.
 * (Confirmed: clearing CTX_* takes the suite from 34 failed to 1 failed / 1868
 * passed; see deliverables/test-triage/baseline-test-failure-triage-2026-06-10.md.)
 *
 * Fix: clear every inherited CTX_* var ONCE, at the start of each test file
 * (this setup file runs at module load, before any beforeAll/beforeEach), so
 * tests start from a clean slate and set only what they need. Tests that set
 * CTX_* in their own beforeAll/beforeEach are unaffected - those run afterwards.
 *
 * This makes the suite green regardless of whether it is launched from a clean
 * shell, CI, or from inside a live agent session.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('CTX_')) {
    delete process.env[key];
  }
}
