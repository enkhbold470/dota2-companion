import { render, screen } from '@testing-library/react';
import type { CoachTip } from '@dc/shared';
import { CoachPanel } from './CoachPanel';
import { t } from '../theme';

const tips: CoachTip[] = [
  { id: 'buyback', severity: 'urgent', message: 'You cannot afford buyback.' },
  { id: 'unspent-gold', severity: 'warn', message: 'Spend your gold.' },
  { id: 'rune-soon', severity: 'info', message: 'Power rune in 20s.' },
];

it('renders nothing when there are no tips', () => {
  const { container } = render(<CoachPanel tips={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it('renders tips in the given order with severity-colored left borders', () => {
  render(<CoachPanel tips={tips} />);
  const urgent = screen.getByText('You cannot afford buyback.');
  const warn = screen.getByText('Spend your gold.');
  const info = screen.getByText('Power rune in 20s.');
  expect(urgent).toHaveStyle({ borderLeft: `3px solid ${t.color.danger}` });
  expect(warn).toHaveStyle({ borderLeft: `3px solid ${t.color.warn}` });
  expect(info).toHaveStyle({ borderLeft: `3px solid ${t.color.info}` });
  // document order matches the tips array order
  expect(urgent.compareDocumentPosition(warn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(warn.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
