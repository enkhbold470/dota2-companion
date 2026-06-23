import { render, screen } from '@testing-library/react';
import { EconomyPanel } from './EconomyPanel';
import { gradeEconomy } from '@dc/shared';

it('renders gpm and rating', () => {
  render(<EconomyPanel grade={gradeEconomy(600, 'core')} />);
  expect(screen.getByText(/600/)).toBeInTheDocument();
  expect(screen.getByText(/ahead/i)).toBeInTheDocument();
});

it('handles unknown gracefully', () => {
  render(<EconomyPanel grade={gradeEconomy(null, 'core')} />);
  expect(screen.getByText(/—/)).toBeInTheDocument();
  expect(screen.getByText(/unknown/i)).toBeInTheDocument();
});
