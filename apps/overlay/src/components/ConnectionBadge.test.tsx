import { render, screen } from '@testing-library/react';
import { ConnectionBadge } from './ConnectionBadge';

it('shows connected vs disconnected', () => {
  const { rerender } = render(<ConnectionBadge connected={true} />);
  expect(screen.getByText(/live/i)).toBeInTheDocument();
  rerender(<ConnectionBadge connected={false} />);
  expect(screen.getByText(/waiting/i)).toBeInTheDocument();
});
