import { useMemo, useState } from 'react';
import heroesData from 'dotaconstants/build/heroes.json';
import {
  dayNight, runeTimers, roshanTimer, gradeEconomy, type Role,
} from '@dc/shared';
import { useGsiSocket } from './useGsiSocket';
import { ConnectionBadge } from './components/ConnectionBadge';
import { TimerPanel } from './components/TimerPanel';
import { EconomyPanel } from './components/EconomyPanel';
import { EnemyPicker, type HeroOption } from './components/EnemyPicker';

const HERO_OPTIONS: HeroOption[] = Object.values(
  heroesData as Record<string, { id: number; localized_name: string }>,
).map((h) => ({ id: h.id, localized_name: h.localized_name }))
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

  const toggleEnemy = (id: number) =>
    setEnemies((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev);

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
      <hr style={{ borderColor: '#374151' }} />
      <EnemyPicker heroes={HERO_OPTIONS} selected={enemies} onToggle={toggleEnemy} />
    </div>
  );
}
