import { useEffect, useMemo, useState } from 'react';
import {
  dayNight, runeTimers, roshanTimer, gradeEconomy, type Role,
  HERO_DATA, ABILITY_DATA, ITEM_DATA, heroById,
  buildThreatReport, recommendItems, buildSkillReadout, suggestNextSkill, coachTips,
} from '@dc/shared';
import { useGsiSocket } from './useGsiSocket';
import { useFocusSession } from './eeg/useFocusSession';
import { t, Panel, SectionLabel } from './theme';
import { Logo } from './components/Logo';
import { ConnectionBadge } from './components/ConnectionBadge';
import { TimerPanel } from './components/TimerPanel';
import { EconomyPanel } from './components/EconomyPanel';
import { EnemyPicker, type HeroOption } from './components/EnemyPicker';
import { HeroAnalyzer } from './components/HeroAnalyzer';
import { CoachPanel } from './components/CoachPanel';
import { AiItemPanel } from './components/AiItemPanel';
import { SkillPanel } from './components/SkillPanel';
import { AskCoachPanel } from './components/AskCoachPanel';
import { FocusPanel } from './components/FocusPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { LiveFocusStrip } from './components/LiveFocusStrip';
import { SettingsPanel, SETUP_DONE_KEY } from './components/SettingsPanel';

const HERO_OPTIONS: HeroOption[] = Object.entries(HERO_DATA)
  .map(([id, h]) => ({ id: Number(id), localized_name: h.localizedName, name: h.name }))
  .sort((a, b) => a.localized_name.localeCompare(b.localized_name));

export default function App() {
  const { state, connected } = useGsiSocket();
  const [role, setRole] = useState<Role>('core');
  const [enemies, setEnemies] = useState<number[]>([]);
  const [roshKilledAt, setRoshKilledAt] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const focus = useFocusSession(state);

  // First-run: open setup once so a new user can drop in their OpenAI key.
  useEffect(() => {
    try { if (!localStorage.getItem(SETUP_DONE_KEY)) setSettingsOpen(true); } catch { /* ignore */ }
  }, []);

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
    <div style={{
      display: 'flex', flexDirection: 'column', gap: t.space.md,
      padding: t.space.lg, color: t.color.text, maxWidth: 460, margin: '0 auto',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: t.space.md }}>
        <Logo size={30} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
          <span style={{ fontSize: t.font.md, fontWeight: t.weight.semibold, letterSpacing: 0.2 }}>Dota Coach</span>
          <ConnectionBadge connected={connected} />
        </div>
        <label style={{ fontSize: t.font.base, color: t.color.textMuted, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: t.space.sm }}>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="core">core</option>
            <option value="support">support</option>
            <option value="unknown">unknown</option>
          </select>
        </label>
        <button
          type="button" title="Setup & settings" aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          style={{ background: 'transparent', border: 0, cursor: 'pointer', color: t.color.textMuted, fontSize: 18, lineHeight: 1, padding: 2 }}
        >⚙</button>
      </header>

      <LiveFocusStrip session={focus} />

      <Panel>
        <TimerPanel
          clock={clock}
          dayNightLabel={dn ? (dn.isDay ? 'DAY' : 'NIGHT') : '—'}
          secondsToTransition={dn ? dn.secondsToNextTransition : null}
          runes={runes}
          roshan={rosh}
          onRoshanDown={() => setRoshKilledAt(clock)}
        />
      </Panel>

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: t.space.sm }}>
        <EconomyPanel grade={grade} />
        <CoachPanel tips={tips} />
      </Panel>

      <Panel>
        <AiItemPanel
          getContext={getItemContext}
          signature={itemSignature}
          ready={heroId !== null}
          itemData={ITEM_DATA}
          gold={gold}
          fallbackRecs={recs}
          hasEnemies={enemies.length > 0}
        />
      </Panel>

      {skills.length > 0 && (
        <Panel>
          <SectionLabel style={{ marginBottom: t.space.sm }}>Skills</SectionLabel>
          <SkillPanel skills={skills} nextSkill={nextSkill} />
        </Panel>
      )}

      <Panel style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
        <HeroAnalyzer
          heroData={HERO_DATA}
          ownHeroId={heroId}
          ownHeroName={heroById(heroId)?.localizedName ?? null}
          onHeroesDetected={(ids) => setEnemies(ids.slice(0, 5))}
        />
        <EnemyPicker heroes={HERO_OPTIONS} selected={enemies} onToggle={toggleEnemy} />
      </Panel>

      <Panel>
        <FocusPanel session={focus} />
      </Panel>

      <Panel>
        <ReviewPanel refreshKey={focus.lastSave} />
      </Panel>

      <Panel>
        <SectionLabel style={{ marginBottom: t.space.sm }}>Ask coach</SectionLabel>
        <AskCoachPanel getContext={getCoachContext} />
      </Panel>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} session={focus} />
    </div>
  );
}
