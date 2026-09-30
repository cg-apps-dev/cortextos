import { describe, expect, it } from 'vitest';

import { redactSecrets } from '../../../src/pty/redact.js';

describe('PTY redactSecrets OpenAI tokens', () => {
  it.each(['svcacct', 'proj', 'admin'])('redacts sk-%s tokens with 40+ character bodies', (kind) => {
    const token = `sk-${kind}-${'A'.repeat(40)}`;

    expect(redactSecrets(`token=${token}`)).toBe('token=[REDACTED_OPENAI]');
  });

  it('does not redact bare OpenAI token-family prose', () => {
    const prose = 'docs mention sk-proj and sk-svcacct prefixes';

    expect(redactSecrets(prose)).toBe(prose);
  });
});
