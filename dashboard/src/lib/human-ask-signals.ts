// Aggressive (recall-first) detector for tasks that MIGHT secretly need a human.
//
// This is the dashboard "detective lane" counterpart to the framework's
// high-precision create-side classifier (src/utils/classify-human-ask.ts). That
// one auto-routes only unambiguous asks to the human-tasks project — a false
// positive there clutters Adam's action list. This one is deliberately broad:
// it surfaces *candidates* into a separate review lane where a human confirms
// (Promote) or dismisses each. Recall over precision — a human is the filter.

export interface SignalMatch {
  matched: boolean;
  /** Human-readable labels for why this task was flagged. */
  signals: string[];
}

const SIGNAL_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'credential', re: /\b(api[ -]?keys?|access tokens?|oauth|auth tokens?|bearer tokens?|refresh tokens?|passwords?|credentials?|secret keys?|client secrets?|2fa|mfa)\b/i },
  { label: 'login/access', re: /\b(log ?in|sign ?in|authenticat|authoriz|grant access|give .* access|account access)\b/i },
  { label: 'approval/decision', re: /\b(approv|sign[- ]?off|your (call|input|sign|go-?ahead|decision)|needs? (a )?decision|please (confirm|decide|review))\b/i },
  { label: 'payment/financial', re: /\b(payment|invoice|billing|purchase|subscription|credit card|wire transfer|refund|charge the|pay (the|for|via)|checkout)\b/i },
  { label: 'reminder/to-do', re: /\b(remind me|(my|your) to-?do|add to (my|the|your) list|don'?t forget to)\b/i },
  { label: 'manual/physical', re: /\b(manually|by hand|in person|physically|mail (it|the|out)|ship (it|the)|pick up|drop off)\b/i },
  { label: 'human-directed', re: /\b(you|adam|the user|jonas)\s+(need|needs|must|should|have to|has to|gotta|will need)\b/i },
  { label: 'waiting-on-human', re: /\b(waiting on (you|adam|the user|a human)|needs? (a )?human|human (input|action|review|decision|intervention)|awaiting (your|human|approval)|blocked on (you|adam|a human))\b/i },
];

/**
 * Scan a task's title+description for any human-need signal. Returns all
 * matched signal labels (deduped). Broad by design — meant for the review lane,
 * not auto-action.
 */
export function detectHumanSignals(title: string, description = ''): SignalMatch {
  const text = `${title}\n${description}`;
  const signals: string[] = [];
  for (const { label, re } of SIGNAL_PATTERNS) {
    if (re.test(text) && !signals.includes(label)) signals.push(label);
  }
  return { matched: signals.length > 0, signals };
}
