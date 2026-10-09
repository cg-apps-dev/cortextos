import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { redactSecrets as redactFastCheckerSecrets } from '../../src/daemon/fast-checker.js';
import { redactSecrets as redactPtySecrets } from '../../src/pty/redact.js';

const FIXTURE_SHA256 = '7b83329d95a375de202f56c6c1d11116dd4b4024443606d142ecc13cccda2af9';
const fixturePath = fileURLToPath(new URL('./redactor-parity-corpus.json', import.meta.url));
const fixtureRaw = readFileSync(fixturePath);

interface PositiveFixture {
  family: string;
  value: string;
}

interface NegativeFixture {
  value: string;
}

interface RedactorParityCorpus {
  positives: PositiveFixture[];
  negatives_shared: NegativeFixture[];
  negatives_symmetric_prose: NegativeFixture[];
  negatives_asymmetric: NegativeFixture[];
}

const corpus = JSON.parse(fixtureRaw.toString('utf8')) as RedactorParityCorpus;

function secretBody({ family, value }: PositiveFixture): string {
  if (family === 'jwt') {
    return value.split('.')[2] ?? '';
  }

  const body = value.match(/^(?:sk-ant-(?:oat01|ort01|admin01)|sk-(?:svcacct|proj|admin))-(.+)$/)?.[1];
  if (!body) throw new Error(`Positive fixture has no extractable secret body: ${family}`);
  return body;
}

describe('redactor parity corpus', () => {
  beforeAll(() => {
    expect(createHash('sha256').update(fixtureRaw).digest('hex')).toBe(FIXTURE_SHA256);
  });

  it.each(corpus.positives)('scrubs $family positives in both redactors', (fixture) => {
    const body = secretBody(fixture);

    expect(redactPtySecrets(fixture.value)).not.toContain(body);
    expect(redactFastCheckerSecrets(fixture.value)).not.toContain(body);
  });

  it.each(corpus.negatives_shared)('preserves shared JWT non-match: $value', ({ value }) => {
    expect(redactPtySecrets(value)).toBe(value);
    expect(redactFastCheckerSecrets(value)).toBe(value);
  });

  it.each(corpus.negatives_symmetric_prose)('preserves shared prose: $value', ({ value }) => {
    expect(redactPtySecrets(value)).toBe(value);
    expect(redactFastCheckerSecrets(value)).toBe(value);
  });

  it.each(corpus.negatives_asymmetric)(
    'allows safe fast-checker over-redaction for $value',
    ({ value }) => {
      expect(redactPtySecrets(value)).toBe(value);
      expect(redactFastCheckerSecrets(value)).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    },
  );
});
