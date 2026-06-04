/**
 * High-precision detector for tasks that genuinely require a human to act —
 * provide a credential, log in / grant access, give approval, or an explicit
 * "remind me" / personal to-do.
 *
 * Used by createTask to auto-route such tasks to the `human-tasks` project so
 * they surface on the dashboard action-items list. This is the create-side
 * complement to the display-side fix in my-tasks/page.tsx: stop the bug at the
 * source by tagging human-blocked work the moment it is created.
 *
 * Precision over recall BY DESIGN. The aggressive/fuzzy candidate detection
 * (the "detective" review lane) lives in the dashboard. This classifier only
 * fires on unambiguous, human-directed asks — when in doubt it returns no
 * match, so a missed tag is far more likely than a wrong one.
 */
export interface HumanAskMatch {
  matched: boolean;
  /** Short label of the signal that matched, for the audit/event log. */
  signal?: string;
}

/**
 * Ordered, high-precision signal patterns. Matched against `title\ndescription`.
 * Each requires either an explicit human-directed phrasing or a request verb
 * adjacent to a credential noun — never a bare keyword.
 */
const PATTERNS: ReadonlyArray<{ signal: string; re: RegExp }> = [
  // Explicit [HUMAN] prefix — already a deliberate human-task marker.
  { signal: 'human-prefix', re: /^\s*\[HUMAN\]/i },

  // Personal reminders / to-dos.
  { signal: 'remind-me', re: /\bremind me\b/i },
  { signal: 'to-do-list', re: /\b(?:my|your) to-?do(?: list)?\b/i },

  // Credential / secret asks. Generic verbs (add/create/generate) and bare
  // credential nouns appear constantly in ordinary feature work ("add a
  // password field", "API key rotation docs"), so a bare verb+noun match is
  // too loose. Require human framing: a possessive ("your API key"), a
  // give-to-me verb directly governing the noun ("share the password"), or an
  // explicit "from you/adam/the user".
  {
    signal: 'credential',
    re: /(?:\byour\b[^.\n]{0,30}?\b(?:api[ -]?keys?|access tokens?|oauth tokens?|auth tokens?|bearer tokens?|refresh tokens?|passwords?|credentials?|secret keys?|client secrets?)\b)|(?:\b(?:provide|share|send|paste|hand|supply|give)\b(?:\s+\w+){0,4}?\s+\b(?:api[ -]?keys?|access tokens?|oauth tokens?|auth tokens?|bearer tokens?|refresh tokens?|passwords?|credentials?|secret keys?|client secrets?)\b)|(?:\b(?:api[ -]?keys?|access tokens?|oauth tokens?|passwords?|credentials?|secret keys?)\b[^.\n]{0,20}?\bfrom (?:you|adam|the user|me)\b)/i,
  },

  // Human must log in / authenticate / grant access. Requires an explicit human
  // subject + obligation verb so agent-facing instructions ("verify the login
  // page", "profile the sign-in endpoint") don't match.
  {
    signal: 'login-access',
    re: /\b(?:you|adam|the user|user|a human|human)\s+(?:needs? to|must|has to|have to|will need to|should|gotta)\s+(?:log ?in|sign ?in|authenticate|authorize|grant access|give access|approve|provide|enter|verify|pay)\b/i,
  },

  // Explicit request for human approval / sign-off / decision.
  {
    signal: 'approval',
    re: /\bneeds?\b[^.\n]{0,20}?\b(?:your|human|manual|adam'?s|the user'?s)\b[^.\n]{0,20}?\b(?:approval|sign[- ]?off|input|action|review|intervention|decision)\b/i,
  },
];

/**
 * Classify whether a task title+description is an unambiguous human-blocked ask.
 * Returns the first matching signal, or { matched: false } when nothing matches.
 */
export function classifyHumanAsk(title: string, description = ''): HumanAskMatch {
  const text = `${title}\n${description}`;
  for (const { signal, re } of PATTERNS) {
    if (re.test(text)) return { matched: true, signal };
  }
  return { matched: false };
}
