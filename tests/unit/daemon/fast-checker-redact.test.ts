import { describe, expect, it } from 'vitest';

import { redactSecrets } from '../../../src/daemon/fast-checker.js';

describe('fast-checker redactSecrets OpenAI tokens', () => {
  it('redacts svcacct, project, and admin tokens using the existing loose style', () => {
    const text = 'sk-svcacct-one sk-proj-two sk-admin-three';

    expect(redactSecrets(text)).toBe('[REDACTED_TOKEN] [REDACTED_TOKEN] [REDACTED_TOKEN]');
  });
});
