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
