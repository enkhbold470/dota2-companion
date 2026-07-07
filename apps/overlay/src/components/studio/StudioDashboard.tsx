import { useEffect, useState } from 'react';
import type { NormalizedState } from '@dc/shared';
import { t, Panel } from '../../theme';
import type { FocusSession } from '../../eeg/useFocusSession';
import { readLastMatch } from '../../studioMode';
import { LastMatchPanel } from './LastMatchPanel';
import { RecentMatchesPanel } from './RecentMatchesPanel';
import { ReviewPanel } from '../ReviewPanel';
import { FocusPanel } from '../FocusPanel';

/**
 * NeuroFocus Studio — the between-games dashboard. Full post-game numbers via
 * the OpenDota proxy plus the TraceLog session review; the live coaching column
 * takes over as soon as GSI reports a game.
 */
export function StudioDashboard({ state, focus }: {
  state: NormalizedState | null;
  focus: FocusSession;
}) {
  // Live GSI wins; the localStorage memory covers "Dota is closed now".
  const remembered = readLastMatch(localStorage);
  const liveMatchId = state?.matchId ?? null;
  const liveAccountId = state?.accountId ?? null;
  const accountId = liveAccountId ?? remembered?.accountId ?? null;
  const defaultMatchId = liveMatchId ?? remembered?.matchId ?? null;

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(defaultMatchId);
  // Follow the default when a fresher match shows up (e.g. game just ended).
  useEffect(() => { setSelectedMatchId(defaultMatchId); }, [defaultMatchId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
      <div style={{
        display: 'grid', gap: t.space.md,
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      }}>
        <Panel>
          <LastMatchPanel matchId={selectedMatchId} accountId={accountId} />
        </Panel>
        <Panel>
          <RecentMatchesPanel
            accountId={accountId}
            selectedMatchId={selectedMatchId}
            onSelect={setSelectedMatchId}
          />
        </Panel>
      </div>

      <Panel>
        <FocusPanel session={focus} />
      </Panel>

      <Panel>
        <ReviewPanel refreshKey={focus.lastSave} />
      </Panel>
    </div>
  );
}
