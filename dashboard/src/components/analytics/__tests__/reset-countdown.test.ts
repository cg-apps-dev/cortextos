import { describe, expect, it } from 'vitest';

import { formatResetCountdown } from '../reset-countdown';

describe('formatResetCountdown', () => {
  it('formats minutes using ceiling', () => {
    expect(formatResetCountdown(26 * 60_000)).toBe('Resets in 26 min');
  });

  it('formats hours and minutes', () => {
    expect(formatResetCountdown(72 * 60_000)).toBe('Resets in 1h 12m');
  });

  it('formats exactly 60 minutes as hours and minutes', () => {
    expect(formatResetCountdown(60 * 60_000)).toBe('Resets in 1h 0m');
  });

  it('keeps the minute part for exact hours', () => {
    expect(formatResetCountdown(2 * 60 * 60_000)).toBe('Resets in 2h 0m');
  });

  it('formats less than one minute', () => {
    expect(formatResetCountdown(30_000)).toBe('Resets in <1 min');
  });

  it('formats zero and negative values as soon', () => {
    expect(formatResetCountdown(0)).toBe('Resets soon');
    expect(formatResetCountdown(-1)).toBe('Resets soon');
  });

  it('rounds 61 seconds up to two minutes', () => {
    expect(formatResetCountdown(61_000)).toBe('Resets in 2 min');
  });
});
