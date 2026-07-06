import type { CoachInput, CoachTip } from './coaching-types';
import { dayNight } from './timers';

const SEVERITY_RANK: Record<CoachTip['severity'], number> = { urgent: 0, warn: 1, info: 2 };

function formatGold(gold: number): string {
  return gold.toLocaleString('en-US');
}

export function coachTips(input: CoachInput): CoachTip[] {
  const { state, role, threat } = input;
  if (!state.inProgress) return [];

  const { clock, hero, economy, items } = state;
  const tips: CoachTip[] = [];

  // no-tp
  if (clock !== null && clock >= 0 && !state.hasTp && hero.alive !== false) {
    tips.push({
      id: 'no-tp',
      severity: 'urgent',
      message: 'No TP scroll — buy one now. TPs save towers and lives.',
    });
  }

  // unspent-gold-high / unspent-gold
  if (economy.gold !== null && clock !== null && clock >= 300 && hero.alive !== false) {
    if (economy.gold >= 2500) {
      tips.push({
        id: 'unspent-gold-high',
        severity: 'urgent',
        message: `${formatGold(economy.gold)} gold unspent — you lose a chunk of it when you die. Shop now.`,
      });
    } else if (economy.gold >= 1200) {
      tips.push({
        id: 'unspent-gold',
        severity: 'warn',
        message: `${formatGold(economy.gold)} gold unspent — shop before a death takes a bite out of it.`,
      });
    }
  }

  // cs-5min / cs-10min
  if (role === 'core' && clock !== null && economy.lastHits !== null) {
    if (clock >= 270 && clock <= 330 && economy.lastHits < 30) {
      tips.push({
        id: 'cs-5min',
        severity: 'warn',
        message: `${economy.lastHits} last hits at 5:00 — target is ~38. Focus lane farm before roaming.`,
      });
    }
    if (clock >= 570 && clock <= 630 && economy.lastHits < 65) {
      tips.push({
        id: 'cs-10min',
        severity: 'warn',
        message: `${economy.lastHits} last hits at 10:00 — target is ~80. Prioritize farm between fights.`,
      });
    }
  }

  // night-soon
  if (clock !== null) {
    const dn = dayNight(clock);
    if (dn.isDay && dn.secondsToNextTransition <= 30) {
      tips.push({
        id: 'night-soon',
        severity: 'warn',
        message: `Night in ${dn.secondsToNextTransition}s — vision drops, hug your team or ward up.`,
      });
    }
  }

  // ult-online
  if (hero.level !== null && hero.level >= 6 && hero.level <= 7 && clock !== null && clock <= 660
    && hero.alive !== false) {
    tips.push({
      id: 'ult-online',
      severity: 'info',
      message: 'Ultimate online — look for a kill window before the next wave.',
    });
  }

  // dead-plan
  if (hero.alive === false && hero.respawnSeconds !== null && hero.respawnSeconds >= 8) {
    tips.push({
      id: 'dead-plan',
      severity: 'info',
      message: `Dead for ${hero.respawnSeconds}s — scan enemy items and plan your buyback/next play.`,
    });
  }

  // shard-spike
  if (role === 'support' && clock !== null && clock >= 900 && !hero.hasShard) {
    tips.push({
      id: 'shard-spike',
      severity: 'info',
      message: "Aghanim's Shard (1,400g) is a cheap power spike for supports.",
    });
  }

  // need-detection
  if (
    role === 'support' &&
    threat !== null &&
    (threat.counts.invisibility ?? 0) >= 1 &&
    !items.includes('item_dust') &&
    !items.includes('item_ward_sentry')
  ) {
    tips.push({
      id: 'need-detection',
      severity: 'warn',
      message: 'Enemy invisibility — stock Dust/Sentries before the next fight.',
    });
  }

  // Stable sort: within a severity, tips keep the rule-evaluation order above.
  return tips.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
