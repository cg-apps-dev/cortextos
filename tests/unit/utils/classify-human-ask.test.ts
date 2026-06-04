import { describe, it, expect } from 'vitest';
import { classifyHumanAsk } from '../../../src/utils/classify-human-ask';

describe('classifyHumanAsk', () => {
  describe('matches unambiguous human-directed asks', () => {
    const positives: Array<[string, string, string]> = [
      // [title, description, expected signal]
      ['[HUMAN] Create Shopify bundle products', '', 'human-prefix'],
      ['Remind me to review the Q3 budget', '', 'remind-me'],
      ['Add this to my to-do list', '', 'to-do-list'],
      ['Buy milk', 'put it on your to-do', 'to-do-list'],
      ['Set up billing', 'please provide your API key for the integration', 'credential'],
      ['Onboard Stripe', 'I need your secret key to finish the wiring', 'credential'],
      ['Share the database password with the team', '', 'credential'],
      ['Get the access token from Adam', '', 'credential'],
      ['Onboard Foreplay', 'you need to log in to the dashboard first', 'login-access'],
      ['Connect Google', 'adam must authenticate the new account', 'login-access'],
      ['Ship the deep-sleep page', 'this needs your approval before publish', 'approval'],
      ['Pricing update', 'needs human sign-off on the new tiers', 'approval'],
    ];

    for (const [title, desc, signal] of positives) {
      it(`tags "${title}${desc ? ' / ' + desc : ''}" → ${signal}`, () => {
        const r = classifyHumanAsk(title, desc);
        expect(r.matched).toBe(true);
        expect(r.signal).toBe(signal);
      });
    }
  });

  describe('does NOT tag ordinary agent work (precision over recall)', () => {
    const negatives: Array<[string, string]> = [
      ['Build the to-do list feature for the dashboard', ''],
      ['Refactor the auth token parser', 'clean up token handling in src/auth'],
      ['Add a password strength meter component', ''],
      ['Write API key rotation docs', 'document how rotation works'],
      ['Investigate login latency', 'profile the sign-in endpoint'],
      ['Approve nothing here', 'this is a normal review task'],
      ['Log in flow E2E test', 'verify the login page renders'],
      ['Fix the dashboard Comms bug', 'agent-to-agent channels show empty'],
      ['Generate weekly report', ''],
    ];

    for (const [title, desc] of negatives) {
      it(`leaves "${title}" untagged`, () => {
        const r = classifyHumanAsk(title, desc);
        expect(r.matched).toBe(false);
        expect(r.signal).toBeUndefined();
      });
    }
  });

  it('defaults description to empty string', () => {
    expect(classifyHumanAsk('Remind me to call Jonas').matched).toBe(true);
    expect(classifyHumanAsk('Build a feature').matched).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(classifyHumanAsk('REMIND ME to ship').signal).toBe('remind-me');
    expect(classifyHumanAsk('[human] do a thing').signal).toBe('human-prefix');
  });
});
