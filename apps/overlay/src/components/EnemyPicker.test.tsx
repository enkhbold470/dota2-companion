import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { EnemyPicker } from './EnemyPicker';

const heroes = [
  { id: 1, localized_name: 'Anti-Mage' },
  { id: 2, localized_name: 'Axe' },
];

it('lists heroes and toggles selection on click (max 5)', async () => {
  const onToggle = vi.fn();
  render(<EnemyPicker heroes={heroes} selected={[2]} onToggle={onToggle} />);
  expect(screen.getByText('Anti-Mage')).toBeInTheDocument();
  await userEvent.click(screen.getByText('Anti-Mage'));
  expect(onToggle).toHaveBeenCalledWith(1);
  // Axe is already selected → shown as selected
  expect(screen.getByText('Axe').closest('button')).toHaveAttribute('aria-pressed', 'true');
});

it('does not call onToggle for a new hero when already at max selection', async () => {
  const onToggle = vi.fn();
  render(
    <EnemyPicker
      heroes={heroes}
      selected={[1]}
      onToggle={onToggle}
      max={1}
    />,
  );
  // Axe is not selected; but we're at limit (max=1, Anti-Mage selected)
  const axeBtn = screen.getByText('Axe').closest('button')!;
  expect(axeBtn).toBeDisabled();
  await userEvent.click(axeBtn);
  expect(onToggle).not.toHaveBeenCalled();
});
