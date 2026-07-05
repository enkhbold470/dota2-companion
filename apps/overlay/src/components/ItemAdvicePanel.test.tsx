import { render, screen } from '@testing-library/react';
import type { ItemRecommendation } from '@dc/shared';
import { ItemAdvicePanel } from './ItemAdvicePanel';

const rec = (over: Partial<ItemRecommendation> = {}): ItemRecommendation => ({
  itemKey: 'black_king_bar',
  itemName: 'Black King Bar',
  cost: 4050,
  affordable: false,
  score: 10,
  reasons: ['Blocks Lion Hex', 'Blocks Laguna Blade'],
  ...over,
});

it('shows the picker hint when no enemies are selected', () => {
  render(<ItemAdvicePanel recs={[rec()]} gold={0} hasEnemies={false} />);
  expect(screen.getByText('Pick enemy heroes below to unlock counter-item advice.')).toBeInTheDocument();
  expect(screen.queryByText('Black King Bar')).not.toBeInTheDocument();
});

it('shows the fallback when enemies are picked but there are no recs', () => {
  render(<ItemAdvicePanel recs={[]} gold={1000} hasEnemies={true} />);
  expect(screen.getByText('No urgent counter-items — follow your standard build.')).toBeInTheDocument();
});

it('renders name, cost, BUY NOW badge and reasons for an affordable rec', () => {
  render(<ItemAdvicePanel recs={[rec({ affordable: true })]} gold={5000} hasEnemies={true} />);
  expect(screen.getByText('Black King Bar')).toBeInTheDocument();
  expect(screen.getByText('4050g')).toBeInTheDocument();
  expect(screen.getByText('BUY NOW')).toHaveStyle({ color: '#4ade80' });
  expect(screen.getByText('Blocks Lion Hex')).toBeInTheDocument();
  expect(screen.getByText('Blocks Laguna Blade')).toBeInTheDocument();
});

it('shows the gold shortfall when unaffordable, and "save up" when gold is unknown', () => {
  const { rerender } = render(<ItemAdvicePanel recs={[rec()]} gold={3000} hasEnemies={true} />);
  expect(screen.getByText('save 1050g more')).toBeInTheDocument();
  rerender(<ItemAdvicePanel recs={[rec()]} gold={null} hasEnemies={true} />);
  expect(screen.getByText('save up')).toBeInTheDocument();
});

it('caps the list at the top 3 recs', () => {
  const recs = ['a', 'b', 'c', 'd'].map((k, i) =>
    rec({ itemKey: k, itemName: `Item ${k.toUpperCase()}`, score: 10 - i, reasons: [] }));
  render(<ItemAdvicePanel recs={recs} gold={0} hasEnemies={true} />);
  expect(screen.getByText('Item A')).toBeInTheDocument();
  expect(screen.getByText('Item C')).toBeInTheDocument();
  expect(screen.queryByText('Item D')).not.toBeInTheDocument();
});
