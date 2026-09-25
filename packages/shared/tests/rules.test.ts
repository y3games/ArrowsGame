import { describe, expect, it } from 'vitest';
import { currentWindowStart } from '../src/game/rules.js';

describe('currentWindowStart', () => {
  it('stays on the same window while now is inside it', () => {
    expect(currentWindowStart(1000, 1000, 10_000)).toBe(1000);
    expect(currentWindowStart(1000, 10_999, 10_000)).toBe(1000);
  });

  it('moves to the next window exactly on the boundary', () => {
    expect(currentWindowStart(1000, 11_000, 10_000)).toBe(11_000);
  });

  it('skips several elapsed windows at once', () => {
    expect(currentWindowStart(0, 35_000, 10_000)).toBe(30_000);
    expect(currentWindowStart(500, 30_499, 10_000)).toBe(20_500);
  });

  it('keeps the first window when now is before it opened', () => {
    expect(currentWindowStart(1000, 500, 10_000)).toBe(1000);
  });
});
