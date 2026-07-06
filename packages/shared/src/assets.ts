// Official Dota 2 art, served from Valve's public Steam CDN — the same images
// the in-client "dota_react" UI uses. Keyed by the identifiers we already carry:
// hero npc names, dotaconstants item keys, and ability keys. No bundling, no
// data regen; just build the URL. Callers should degrade gracefully (onError)
// since a slug can lag a fresh patch.
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react';

const heroSlug = (npcName: string): string => npcName.replace(/^npc_dota_hero_/, '');

/** Square minimap-style hero icon — compact, good for pickers. */
export const heroIconUrl = (npcName: string): string => `${CDN}/heroes/icons/${heroSlug(npcName)}.png`;

/** Landscape hero portrait — good for a selected/detected display. */
export const heroImageUrl = (npcName: string): string => `${CDN}/heroes/${heroSlug(npcName)}.png`;

/** Item icon by dotaconstants key (no `item_` prefix), e.g. `black_king_bar`. */
export const itemImageUrl = (itemKey: string): string => `${CDN}/items/${itemKey}.png`;

/** Ability icon by ability key, e.g. `zeus_arc_lightning`. */
export const abilityImageUrl = (abilityKey: string): string => `${CDN}/abilities/${abilityKey}.png`;
