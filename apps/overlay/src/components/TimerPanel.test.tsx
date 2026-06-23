import { render, screen } from '@testing-library/react';
import { TimerPanel } from './TimerPanel';
import { runeTimers, roshanTimer } from '@dc/shared';

it('renders day/night, runes, and roshan status', () => {
  render(
    <TimerPanel
      clock={305}
      dayNightLabel="NIGHT"
      secondsToTransition={295}
      runes={runeTimers(305)}
      roshan={roshanTimer({ killedAtClock: null }, 305)}
      onRoshanDown={() => {}}
    />,
  );
  expect(screen.getByText(/night/i)).toBeInTheDocument();
  expect(screen.getByText(/bounty/i)).toBeInTheDocument();
  expect(screen.getByText(/rosh down/i)).toBeInTheDocument();
});
