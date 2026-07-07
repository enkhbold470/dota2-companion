import { describe, it, expect } from 'vitest';
import { coachTips } from './coach';
import type { CoachInput, ThreatReport } from './coaching-types';
import type { NormalizedState, Role } from './types';

type StatePatch = Partial<Omit<NormalizedState, 'hero' | 'economy'>> & {
  hero?: Partial<NormalizedState['hero']>;
  economy?: Partial<NormalizedState['economy']>;
};

// Baseline fires no rules: TP in slot, low gold, shard owned, level 10, day with 300s left.
function makeState(patch: StatePatch = {}): NormalizedState {
  return {
    matchId: 'm1',
    inProgress: true,
    gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    phase: 'in_progress',
    team: 'radiant',
    paused: false,
    clock: 600,
    isDay: true,
    items: [],
    hasTp: true,
    abilities: [],
    ...patch,
    hero: {
      id: 1,
      level: 10,
      alive: true,
      respawnSeconds: null,
      hpPercent: 100,
      mpPercent: 100,
      hasScepter: false,
      hasShard: true,
      ...patch.hero,
    },
    economy: {
      gold: 0,
      netWorth: null,
      gpm: null,
      xpm: null,
      lastHits: null,
      ...patch.economy,
    },
    combat: { kills: null, deaths: null, assists: null },
  };
}

function makeInput(patch: StatePatch = {}, role: Role = 'core', threat: ThreatReport | null = null): CoachInput {
  return { state: makeState(patch), role, threat };
}

function ids(input: CoachInput): string[] {
  return coachTips(input).map((t) => t.id);
}

const invisThreat: ThreatReport = {
  enemies: [{ heroId: 106, heroName: 'Riki' }],
  flags: [{ kind: 'invisibility', heroId: 106, heroName: 'Riki', abilityName: 'Cloak and Dagger' }],
  counts: { invisibility: 1 },
};

describe('coachTips', () => {
  it('returns [] when the game is not in progress', () => {
    expect(coachTips(makeInput({ inProgress: false, hasTp: false, economy: { gold: 5000 } }))).toEqual([]);
  });

  it('baseline fixture fires nothing', () => {
    expect(coachTips(makeInput())).toEqual([]);
  });

  describe('no-tp', () => {
    it('fires urgent from clock 0 when the TP slot is empty', () => {
      const tips = coachTips(makeInput({ clock: 0, hasTp: false }));
      expect(tips).toEqual([
        { id: 'no-tp', severity: 'urgent', message: 'No TP scroll — buy one now. TPs save towers and lives.' },
      ]);
    });
    it('does not fire pre-horn, with a TP, while dead, or with no clock', () => {
      expect(ids(makeInput({ clock: -1, hasTp: false }))).not.toContain('no-tp');
      expect(ids(makeInput({ clock: 0, hasTp: true }))).not.toContain('no-tp');
      expect(ids(makeInput({ clock: 0, hasTp: false, hero: { alive: false } }))).not.toContain('no-tp');
      expect(ids(makeInput({ clock: null, hasTp: false }))).not.toContain('no-tp');
    });
  });

  describe('unspent-gold-high', () => {
    it('fires urgent at 2500 gold from 5:00 and interpolates the amount', () => {
      const tips = coachTips(makeInput({ clock: 300, economy: { gold: 2500 } }));
      expect(tips).toEqual([
        {
          id: 'unspent-gold-high',
          severity: 'urgent',
          message: '2,500 gold unspent — you lose a chunk of it when you die. Shop now.',
        },
      ]);
    });
    it('does not fire before 5:00, while dead, or under 2500 gold', () => {
      expect(ids(makeInput({ clock: 299, economy: { gold: 3000 } }))).not.toContain('unspent-gold-high');
      expect(ids(makeInput({ clock: 300, economy: { gold: 3000 }, hero: { alive: false } }))).not.toContain('unspent-gold-high');
      expect(ids(makeInput({ clock: 300, economy: { gold: 2499 } }))).not.toContain('unspent-gold-high');
    });
  });

  describe('unspent-gold', () => {
    it('fires warn at 1200-2499 gold, only when the urgent tier did not', () => {
      const tips = coachTips(makeInput({ clock: 300, economy: { gold: 1200 } }));
      expect(tips).toHaveLength(1);
      expect(tips[0]).toMatchObject({ id: 'unspent-gold', severity: 'warn' });
      expect(tips[0]?.message).toContain('1,200');
      expect(ids(makeInput({ clock: 300, economy: { gold: 2500 } }))).toEqual(['unspent-gold-high']);
    });
    it('does not fire under 1200 gold, before 5:00, or while dead', () => {
      expect(ids(makeInput({ clock: 300, economy: { gold: 1199 } }))).toEqual([]);
      expect(ids(makeInput({ clock: 299, economy: { gold: 1500 } }))).not.toContain('unspent-gold');
      expect(ids(makeInput({ clock: 300, economy: { gold: 1500 }, hero: { alive: false } }))).not.toContain('unspent-gold');
    });
  });

  describe('cs-5min', () => {
    it('fires warn for a core inside 4:30-5:30 with under 30 last hits', () => {
      const tips = coachTips(makeInput({ clock: 300, economy: { lastHits: 29 } }, 'core'));
      expect(tips).toEqual([
        {
          id: 'cs-5min',
          severity: 'warn',
          message: '29 last hits at 5:00 — target is ~38. Focus lane farm before roaming.',
        },
      ]);
      expect(ids(makeInput({ clock: 270, economy: { lastHits: 0 } }, 'core'))).toContain('cs-5min');
      expect(ids(makeInput({ clock: 330, economy: { lastHits: 0 } }, 'core'))).toContain('cs-5min');
    });
    it('does not fire outside the window, at 30 LH, for supports, or with unknown LH', () => {
      expect(ids(makeInput({ clock: 269, economy: { lastHits: 10 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 331, economy: { lastHits: 10 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 300, economy: { lastHits: 30 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 300, economy: { lastHits: 10 } }, 'support'))).toEqual([]);
      expect(ids(makeInput({ clock: 300, economy: { lastHits: null } }, 'core'))).toEqual([]);
    });
  });

  describe('cs-10min', () => {
    it('fires warn for a core inside 9:30-10:30 with under 65 last hits', () => {
      const tips = coachTips(makeInput({ clock: 600, economy: { lastHits: 64 } }, 'core'));
      expect(tips).toEqual([
        {
          id: 'cs-10min',
          severity: 'warn',
          message: '64 last hits at 10:00 — target is ~80. Prioritize farm between fights.',
        },
      ]);
      expect(ids(makeInput({ clock: 570, economy: { lastHits: 40 } }, 'core'))).toContain('cs-10min');
      expect(ids(makeInput({ clock: 630, economy: { lastHits: 40 } }, 'core'))).toContain('cs-10min');
    });
    it('does not fire outside the window, at 65 LH, or for supports', () => {
      expect(ids(makeInput({ clock: 569, economy: { lastHits: 40 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 631, economy: { lastHits: 40 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 600, economy: { lastHits: 65 } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: 600, economy: { lastHits: 40 } }, 'support'))).toEqual([]);
    });
  });

  describe('night-soon', () => {
    it('fires warn during the day with 30s or less to the transition', () => {
      const tips = coachTips(makeInput({ clock: 270 }));
      expect(tips).toEqual([
        { id: 'night-soon', severity: 'warn', message: 'Night in 30s — vision drops, hug your team or ward up.' },
      ]);
      const late = coachTips(makeInput({ clock: 295 }));
      expect(late[0]?.message).toContain('Night in 5s');
    });
    it('does not fire with 31s left, at night, or with no clock', () => {
      expect(ids(makeInput({ clock: 269 }))).toEqual([]);
      expect(ids(makeInput({ clock: 580 }))).toEqual([]); // night: 570-600 is cycle 1
      expect(ids(makeInput({ clock: null }))).toEqual([]);
    });
  });

  describe('ult-online', () => {
    it('fires info at levels 6-7 up to 11:00', () => {
      const tips = coachTips(makeInput({ clock: 660, hero: { level: 6 } }));
      expect(tips).toEqual([
        { id: 'ult-online', severity: 'info', message: 'Ultimate online — look for a kill window before the next wave.' },
      ]);
      expect(ids(makeInput({ clock: 400, hero: { level: 7 } }))).toContain('ult-online');
    });
    it('does not fire at level 5 or 8, after 11:00, or with no level/clock', () => {
      expect(ids(makeInput({ clock: 400, hero: { level: 5 } }))).toEqual([]);
      expect(ids(makeInput({ clock: 400, hero: { level: 8 } }))).toEqual([]);
      expect(ids(makeInput({ clock: 661, hero: { level: 6 } }))).toEqual([]);
      expect(ids(makeInput({ clock: 400, hero: { level: null } }))).toEqual([]);
      expect(ids(makeInput({ clock: null, hero: { level: 6 } }))).toEqual([]);
    });
  });

  describe('dead-plan', () => {
    it('fires info when dead with 8s+ respawn, even without a clock', () => {
      const tips = coachTips(makeInput({ clock: null, hero: { alive: false, respawnSeconds: 20 } }));
      expect(tips).toEqual([
        { id: 'dead-plan', severity: 'info', message: 'Dead for 20s — scan enemy items and plan your buyback/next play.' },
      ]);
      expect(ids(makeInput({ hero: { alive: false, respawnSeconds: 8 } }))).toContain('dead-plan');
    });
    it('does not fire when alive, under 8s, or with unknown respawn', () => {
      expect(ids(makeInput({ hero: { alive: true, respawnSeconds: 20 } }))).toEqual([]);
      expect(ids(makeInput({ hero: { alive: false, respawnSeconds: 7 } }))).toEqual([]);
      expect(ids(makeInput({ hero: { alive: false, respawnSeconds: null } }))).toEqual([]);
    });
  });

  describe('shard-spike', () => {
    it('fires info for a shardless support from 15:00', () => {
      const tips = coachTips(makeInput({ clock: 900, hero: { hasShard: false } }, 'support'));
      expect(tips).toEqual([
        { id: 'shard-spike', severity: 'info', message: "Aghanim's Shard (1,400g) is a cheap power spike for supports." },
      ]);
    });
    it('does not fire before 15:00, with a shard, for cores, or with no clock', () => {
      expect(ids(makeInput({ clock: 850, hero: { hasShard: false } }, 'support'))).toEqual([]);
      expect(ids(makeInput({ clock: 900, hero: { hasShard: true } }, 'support'))).toEqual([]);
      expect(ids(makeInput({ clock: 900, hero: { hasShard: false } }, 'core'))).toEqual([]);
      expect(ids(makeInput({ clock: null, hero: { hasShard: false } }, 'support'))).toEqual([]);
    });
  });

  describe('need-detection', () => {
    it('fires warn for a support facing invisibility with no detection, even without a clock', () => {
      const tips = coachTips(makeInput({ clock: null }, 'support', invisThreat));
      expect(tips).toEqual([
        { id: 'need-detection', severity: 'warn', message: 'Enemy invisibility — stock Dust/Sentries before the next fight.' },
      ]);
    });
    it('does not fire with dust or sentries in inventory, no threat, no invis, or for cores', () => {
      expect(ids(makeInput({ items: ['item_dust'] }, 'support', invisThreat))).toEqual([]);
      expect(ids(makeInput({ items: ['item_ward_sentry'] }, 'support', invisThreat))).toEqual([]);
      expect(ids(makeInput({}, 'support', null))).toEqual([]);
      expect(ids(makeInput({}, 'support', { ...invisThreat, counts: {} }))).toEqual([]);
      expect(ids(makeInput({}, 'core', invisThreat))).toEqual([]);
    });
  });

  describe('severity ordering', () => {
    it('sorts urgent > warn > info, stable by rule order within a severity', () => {
      const core = makeInput(
        { clock: 330, hasTp: false, hero: { level: 6 }, economy: { gold: 3000, lastHits: 10 } },
        'core',
      );
      expect(ids(core)).toEqual(['no-tp', 'unspent-gold-high', 'cs-5min', 'ult-online']);

      const support = makeInput(
        { clock: 900, hasTp: false, hero: { hasShard: false }, economy: { gold: 2000 } },
        'support',
        invisThreat,
      );
      expect(ids(support)).toEqual(['no-tp', 'unspent-gold', 'need-detection', 'shard-spike']);
    });

    it('keeps every message specific and at most 110 characters', () => {
      const tips = coachTips(
        makeInput(
          { clock: 330, hasTp: false, hero: { level: 6 }, economy: { gold: 99999, lastHits: 10 } },
          'core',
        ),
      );
      expect(tips.length).toBeGreaterThan(0);
      for (const tip of tips) expect(tip.message.length).toBeLessThanOrEqual(110);
    });
  });

  describe('clock null', () => {
    it('only clock-independent rules can fire', () => {
      const input = makeInput(
        { clock: null, hasTp: false, hero: { alive: false, respawnSeconds: 30, hasShard: false, level: 6 }, economy: { gold: 5000, lastHits: 5 } },
        'support',
        invisThreat,
      );
      expect(ids(input)).toEqual(['need-detection', 'dead-plan']);
    });
  });
});
