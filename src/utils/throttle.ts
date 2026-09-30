/**
 * Canonical Claude Code server-throttle abort matcher.
 *
 * The real abort line is:
 * "API Error: Server is temporarily limiting requests (not your usage limit) - Rate limited"
 *
 * It does not reliably include "429", so attribution must key on the emitted
 * text instead.
 */
export const THROTTLE_ABORT_RE = /temporarily limiting requests|Rate limited/i;
