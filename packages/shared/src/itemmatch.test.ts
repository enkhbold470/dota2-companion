import { describe, it, expect } from 'vitest';
import { matchItemKeys } from './itemmatch';
import { ITEM_DATA } from './data';

describe('matchItemKeys', () => {
  it('resolves display names (however spelled) to item keys', () => {
    expect(matchItemKeys(['Black King Bar', 'aether lens'], ITEM_DATA)).toEqual([
      'black_king_bar',
      'aether_lens',
    ]);
  });

  it('accepts a raw key and returns null for unknown items', () => {
    expect(matchItemKeys(['black_king_bar', 'Nonexistent Item'], ITEM_DATA)).toEqual([
      'black_king_bar',
      null,
    ]);
  });

  it('resolves Aghanim\'s Scepter to the buyable item, not Blessing', () => {
    const [scepter, blessing] = matchItemKeys(["Aghanim's Scepter", "Aghanim's Blessing"], ITEM_DATA);
    expect(scepter).toBe('ultimate_scepter');
    expect(blessing).toBe('ultimate_scepter_2');
    expect(scepter).not.toBe(blessing);
  });
});
