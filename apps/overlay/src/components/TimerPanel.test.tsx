import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
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

it('calls onRoshanDown when the button is clicked', async () => {
  const onRoshanDown = vi.fn();
  const { roshanTimer, runeTimers } = await import('@dc/shared');
  render(
    <TimerPanel
      clock={400}
      dayNightLabel="DAY"
      secondsToTransition={200}
      runes={runeTimers(400)}
      roshan={roshanTimer({ killedAtClock: null }, 400)}
      onRoshanDown={onRoshanDown}
    />,
  );
  await userEvent.click(screen.getByText(/rosh down/i));
  expect(onRoshanDown).toHaveBeenCalledTimes(1);
});
