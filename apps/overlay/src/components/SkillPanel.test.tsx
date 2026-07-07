import { render, screen } from '@testing-library/react';
import type { SkillReadout } from '@dc/shared';
import { SkillPanel } from './SkillPanel';
import { t } from '../theme';

const base: SkillReadout = {
  key: 'lina_laguna_blade',
  name: 'Laguna Blade',
  level: 2,
  maxLevel: 3,
  damage: 700,
  damageNext: 900,
  dmgType: 'Magical',
  cooldown: 60,
  remainingCooldown: 0,
  manaCost: 300,
  canCast: true,
  ultimate: true,
  passive: false,
};

it('renders nothing when skills is empty', () => {
  const { container } = render(<SkillPanel skills={[]} />);
  expect(container).toBeEmptyDOMElement();
});

it('renders name, level pips, damage badge, next-level damage, cd and mana', () => {
  render(<SkillPanel skills={[base]} />);
  expect(screen.getByText('Laguna Blade')).toBeInTheDocument();
  expect(screen.getByText('●●○')).toBeInTheDocument();
  expect(screen.getByText('700')).toBeInTheDocument();
  expect(screen.getByText('M')).toHaveStyle({ color: '#a78bfa' });
  expect(screen.getByText('→ 900')).toBeInTheDocument();
  expect(screen.getByText('CD 60s')).toBeInTheDocument();
  expect(screen.getByText('300 mana')).toBeInTheDocument();
  expect(screen.queryByText(/on CD/)).not.toBeInTheDocument();
  expect(screen.queryByText('passive')).not.toBeInTheDocument();
});

it('colors physical and pure damage badges', () => {
  render(
    <SkillPanel
      skills={[
        { ...base, key: 'a', dmgType: 'Physical' },
        { ...base, key: 'b', dmgType: 'Pure' },
        { ...base, key: 'c', dmgType: null },
      ]}
    />,
  );
  expect(screen.getByText('P')).toHaveStyle({ color: '#f87171' });
  expect(screen.getByText('Pure')).toHaveStyle({ color: '#fbbf24' });
  expect(screen.getByText('?')).toHaveStyle({ color: t.color.textMuted });
});

it('omits damage/cd/mana when null and shows the live cooldown in amber', () => {
  render(
    <SkillPanel
      skills={[{
        ...base, damage: null, damageNext: null, dmgType: null,
        cooldown: null, manaCost: null, remainingCooldown: 12,
      }]}
    />,
  );
  expect(screen.queryByText('700')).not.toBeInTheDocument();
  expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  expect(screen.queryByText(/CD 60s/)).not.toBeInTheDocument();
  expect(screen.queryByText(/mana/)).not.toBeInTheDocument();
  expect(screen.getByText('on CD 12s')).toHaveStyle({ color: t.color.warn });
});

it('tags passives and dims unleveled skills', () => {
  render(
    <SkillPanel
      skills={[{
        ...base, key: 'passive0', name: 'Fiery Soul', level: 0, maxLevel: 4,
        damage: null, damageNext: null, dmgType: null, cooldown: null,
        manaCost: null, remainingCooldown: null, ultimate: false, passive: true,
      }]}
    />,
  );
  expect(screen.getByText('passive')).toBeInTheDocument();
  expect(screen.getByText('○○○○')).toBeInTheDocument();
  const row = screen.getByText('Fiery Soul').closest('div');
  expect(row).toHaveStyle({ opacity: 0.45 });
});
