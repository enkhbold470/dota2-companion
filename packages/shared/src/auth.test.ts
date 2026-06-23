import { describe, it, expect } from 'vitest';
import { isAuthorized } from './auth';

describe('isAuthorized', () => {
  it('accepts a matching token', () => {
    expect(isAuthorized({ auth: { token: 'secret' } }, 'secret')).toBe(true);
  });
  it('rejects a mismatched token', () => {
    expect(isAuthorized({ auth: { token: 'nope' } }, 'secret')).toBe(false);
  });
  it('rejects a missing auth block', () => {
    expect(isAuthorized({}, 'secret')).toBe(false);
  });
  it('rejects when expected token is empty (misconfig guard)', () => {
    expect(isAuthorized({ auth: { token: '' } }, '')).toBe(false);
  });
});
