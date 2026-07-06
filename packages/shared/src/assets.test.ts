import { describe, it, expect } from 'vitest';
import { heroIconUrl, heroImageUrl, itemImageUrl, abilityImageUrl } from './assets';

describe('asset urls', () => {
  it('strips the npc_dota_hero_ prefix for hero art', () => {
    expect(heroIconUrl('npc_dota_hero_antimage')).toBe(
      'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/antimage.png',
    );
    expect(heroImageUrl('npc_dota_hero_zuus')).toBe(
      'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/zuus.png',
    );
  });

  it('builds item and ability urls from their keys', () => {
    expect(itemImageUrl('black_king_bar')).toContain('/items/black_king_bar.png');
    expect(abilityImageUrl('zeus_arc_lightning')).toContain('/abilities/zeus_arc_lightning.png');
  });
});
