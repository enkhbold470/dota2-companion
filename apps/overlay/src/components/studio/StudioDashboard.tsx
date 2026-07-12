import { t, Panel } from '../../theme';
import type { FocusSession } from '../../eeg/useFocusSession';
import { ReviewPanel } from '../ReviewPanel';
import { FocusPanel } from '../FocusPanel';

/**
 * NeuroFocus Studio — the between-games dashboard: the FlowState session plus
 * the TraceLog review of recorded sessions. The live coaching column takes
 * over as soon as GSI reports a game.
 */
export function StudioDashboard({ focus }: { focus: FocusSession }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.space.md }}>
      <Panel>
        <FocusPanel session={focus} />
      </Panel>

      <Panel>
        <ReviewPanel refreshKey={focus.lastSave} />
      </Panel>
    </div>
  );
}
