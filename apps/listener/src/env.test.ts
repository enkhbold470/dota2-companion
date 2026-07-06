import { describe, it, expect } from 'vitest';
import { parseDotEnv } from './env';

describe('parseDotEnv', () => {
  it('parses KEY=VALUE lines', () => {
    expect(parseDotEnv('GSI_TOKEN=abc123\nOPENAI_API_KEY=sk-test')).toEqual({
      GSI_TOKEN: 'abc123',
      OPENAI_API_KEY: 'sk-test',
    });
  });

  it('skips comments and blank lines', () => {
    expect(parseDotEnv('# comment\n\nA=1\n  # indented comment\nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('strips matching quotes and tolerates spaces around =', () => {
    expect(parseDotEnv('A = "with spaces"\nB=\'single\'\nC="unbalanced')).toEqual({
      A: 'with spaces',
      B: 'single',
      C: '"unbalanced',
    });
  });

  it('ignores malformed lines', () => {
    expect(parseDotEnv('not a var\n=nokey\n1BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' });
  });
});
