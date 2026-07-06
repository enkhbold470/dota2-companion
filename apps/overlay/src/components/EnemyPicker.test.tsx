import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { EnemyPicker } from './EnemyPicker';

const heroes = [
  { id: 1, localized_name: 'Anti-Mage' },
  { id: 2, localized_name: 'Axe' },
  { id: 3, localized_name: 'Zeus' },
];

it('hides the full list until you search or expand', () => {
  render(<EnemyPicker heroes={heroes} selected={[]} onToggle={vi.fn()} />);
  // Nothing from the roster is shown up front (just the search box + controls).
  expect(screen.queryByText('Anti-Mage')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Search hero to add…')).toBeInTheDocument();
});

it('filters heroes by search and toggles the match', async () => {
  const onToggle = vi.fn();
  render(<EnemyPicker heroes={heroes} selected={[]} onToggle={onToggle} />);
  await userEvent.type(screen.getByPlaceholderText('Search hero to add…'), 'anti');
  const match = screen.getByText('Anti-Mage');
  expect(screen.queryByText('Zeus')).not.toBeInTheDocument();
  await userEvent.click(match);
  expect(onToggle).toHaveBeenCalledWith(1);
});

it('expands to browse the whole roster', async () => {
  render(<EnemyPicker heroes={heroes} selected={[]} onToggle={vi.fn()} />);
  expect(screen.queryByText('Axe')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Browse all' }));
  expect(screen.getByText('Axe')).toBeInTheDocument();
  expect(screen.getByText('Zeus')).toBeInTheDocument();
});

it('shows selected heroes as removable chips', async () => {
  const onToggle = vi.fn();
  render(<EnemyPicker heroes={heroes} selected={[2]} onToggle={onToggle} />);
  const chip = screen.getByTitle('Remove Axe');
  await userEvent.click(chip);
  expect(onToggle).toHaveBeenCalledWith(2);
});

it('disables adding a new hero once at max', async () => {
  const onToggle = vi.fn();
  render(<EnemyPicker heroes={heroes} selected={[1]} onToggle={onToggle} max={1} />);
  await userEvent.type(screen.getByPlaceholderText('Search hero to add…'), 'axe');
  const axeBtn = screen.getByRole('button', { name: /Axe/ });
  expect(axeBtn).toBeDisabled();
  await userEvent.click(axeBtn);
  expect(onToggle).not.toHaveBeenCalled();
});
