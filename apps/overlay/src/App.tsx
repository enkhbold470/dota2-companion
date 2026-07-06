import { useMemo, useState } from 'react';
import {
  dayNight, runeTimers, roshanTimer, gradeEconomy, type Role,
  HERO_DATA, ABILITY_DATA, ITEM_DATA, heroById,
  buildThreatReport, recommendItems, buildSkillReadout, suggestNextSkill, coachTips,
} from '@dc/shared';
import { useGsiSocket } from './useGsiSocket';
import { ConnectionBadge } from './components/ConnectionBadge';
import { TimerPanel } from './components/TimerPanel';
import { EconomyPanel } from './components/EconomyPanel';
import { EnemyPicker, type HeroOption } from './components/EnemyPicker';
import { HeroAnalyzer } from './components/HeroAnalyzer';
import { CoachPanel } from './components/CoachPanel';
import { AiItemPanel } from './components/AiItemPanel';
import { SkillPanel } from './components/SkillPanel';
import { AskCoachPanel } from './components/AskCoachPanel';

const HERO_OPTIONS: HeroOption[] = Object.entries(HERO_DATA)
  .map(([id, h]) => ({ id: Number(id), localized_name: h.localizedName, name: h.name }))
  .sort((a, b) => a.localized_name.localeCompare(b.localized_name));

export default function App() {
  const { state, connected } = useGsiSocket();
  const [role, setRole] = useState<Role>('core');
  const [enemies, setEnemies] = useState<number[]>([]);
  const [roshKilledAt, setRoshKilledAt] = useState<number | null>(null);

  const clock = state?.clock ?? null;
  const dn = clock === null ? null : dayNight(clock);
  const runes = clock === null ? [] : runeTimers(clock);
  // clock ?? 0: when clock is null we haven't connected yet; roshKilledAt is also null so status is 'unknown'
  const rosh = roshanTimer({ killedAtClock: roshKilledAt }, clock ?? 0);
  const grade = useMemo(() => gradeEconomy(state?.economy.gpm ?? null, role), [state?.economy.gpm, role]);

  const threat = useMemo(() => buildThreatReport(enemies, HERO_DATA, ABILITY_DATA), [enemies]);
  const gold = state?.economy.gold ?? null;
  const ownedItems = state?.items;
  const heroId = state?.hero.id ?? null;
  const recs = useMemo(
    () => recommendItems({
      threat, role, gold, clock,
      ownedItems: ownedItems ?? [],
      attackType: heroById(heroId)?.attackType,
    }, ITEM_DATA),
    [threat, role, gold, clock, ownedItems, heroId],
  );
  const skills = useMemo(() => buildSkillReadout(state?.abilities ?? [], ABILITY_DATA), [state?.abilities]);
  const heroLevel = state?.hero.level ?? null;
  const nextSkill = useMemo(() => suggestNextSkill(skills, heroLevel), [skills, heroLevel]);
  const tips = useMemo(() => (state ? coachTips({ state, role, threat }) : []), [state, role, threat]);

  const toggleEnemy = (id: number) =>
    setEnemies((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev);

  // Auto-refresh the AI build only when the draft/hero/role changes, not per gold tick.
  const itemSignature = `${heroId ?? 'none'}|${role}|${[...enemies].sort((a, b) => a - b).join(',')}`;
  const getItemContext = () => ({
    hero: {
      name: heroById(heroId)?.localizedName ?? null,
      attackType: heroById(heroId)?.attackType ?? null,
      level: state?.hero.level ?? null,
    },
    hasScepter: state?.hero.hasScepter ?? false,
    hasShard: state?.hero.hasShard ?? false,
    role,
    gold,
    netWorth: state?.economy.netWorth ?? null,
    clock,
    items: state?.items ?? [],
    enemies: threat.enemies.map((e) => e.heroName),
  });

  const getCoachContext = () => ({
    role,
    clock,
    hero: state ? { ...state.hero, name: heroById(heroId)?.localizedName ?? null } : null,
    economy: state?.economy ?? null,
    items: state?.items ?? [],
    enemies: threat.enemies.map((e) => e.heroName),
    itemAdvice: recs.slice(0, 3).map((r) => ({ item: r.itemName, cost: r.cost, reasons: r.reasons })),
    tips: tips.map((t) => t.message),
  });

  return (
    <div style={{ fontFamily: 'system-ui', color: '#e5e7eb', background: 'rgba(17,24,39,0.85)', padding: 12, maxWidth: 360 }}>
      <ConnectionBadge connected={connected} />
      <div style={{ margin: '8px 0' }}>
        <label style={{ fontSize: 12 }}>
          Role:{' '}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="core">core</option>
            <option value="support">support</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
      </div>
      <TimerPanel
        clock={clock}
        dayNightLabel={dn ? (dn.isDay ? 'DAY' : 'NIGHT') : '—'}
        secondsToTransition={dn ? dn.secondsToNextTransition : null}
        runes={runes}
        roshan={rosh}
        onRoshanDown={() => setRoshKilledAt(clock)}
      />
      <hr style={{ borderColor: '#374151' }} />
      <EconomyPanel grade={grade} />
      <CoachPanel tips={tips} />
      <hr style={{ borderColor: '#374151' }} />
      <AiItemPanel
        getContext={getItemContext}
        signature={itemSignature}
        ready={heroId !== null}
        itemData={ITEM_DATA}
        gold={gold}
        fallbackRecs={recs}
        hasEnemies={enemies.length > 0}
      />
      <hr style={{ borderColor: '#374151' }} />
      <SkillPanel skills={skills} nextSkill={nextSkill} />
      <hr style={{ borderColor: '#374151' }} />
      <HeroAnalyzer
        heroData={HERO_DATA}
        ownHeroId={heroId}
        ownHeroName={heroById(heroId)?.localizedName ?? null}
        onHeroesDetected={(ids) => setEnemies(ids.slice(0, 5))}
      />
      <div style={{ height: 6 }} />
      <EnemyPicker heroes={HERO_OPTIONS} selected={enemies} onToggle={toggleEnemy} />
      <hr style={{ borderColor: '#374151' }} />
      <AskCoachPanel getContext={getCoachContext} />
    </div>
  );
}
