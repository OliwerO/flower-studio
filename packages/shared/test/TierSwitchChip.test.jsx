// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TierSwitchChip from '../components/TierSwitchChip.jsx';

const t = { currency: 'zł', stems: 'stems', switchTier: 'Switch sell tier' };

const twoTiers = [
  { key: '25.00', sell: 25, totalQty: 15, stockIds: [{ id: 'b1', qty: 10, date: '2026-05-10' }, { id: 'b2', qty: 5, date: '2026-05-12' }] },
  { key: '30.00', sell: 30, totalQty: 7,  stockIds: [{ id: 'b3', qty: 7,  date: '2026-05-11' }] },
];

describe('TierSwitchChip', () => {
  it('renders plain text when there is at most one tier (nothing to switch)', () => {
    render(<TierSwitchChip currentSell={25} tiers={[twoTiers[0]]} onPick={() => {}} t={t} />);
    expect(screen.queryByTestId('tier-switch-chip')).not.toBeInTheDocument();
    expect(screen.getByText(/25 zł/)).toBeInTheDocument();
  });

  it('renders an interactive chip when ≥2 tiers exist', () => {
    render(<TierSwitchChip currentSell={25} tiers={twoTiers} onPick={() => {}} t={t} />);
    expect(screen.getByTestId('tier-switch-chip')).toBeInTheDocument();
  });

  it('clicking the chip opens a tier menu with all options', () => {
    render(<TierSwitchChip currentSell={25} tiers={twoTiers} onPick={() => {}} t={t} />);
    fireEvent.click(screen.getByTestId('tier-switch-chip'));
    const opts = screen.getAllByTestId('tier-switch-option');
    expect(opts).toHaveLength(2);
    const keys = opts.map(o => o.getAttribute('data-tier-key'));
    expect(keys).toContain('25.00');
    expect(keys).toContain('30.00');
  });

  it('picking a tier calls onPick with the FEFO-oldest underlying stock id', () => {
    const onPick = vi.fn();
    render(<TierSwitchChip currentSell={25} tiers={twoTiers} onPick={onPick} t={t} />);
    fireEvent.click(screen.getByTestId('tier-switch-chip'));
    const tier30 = screen.getAllByTestId('tier-switch-option').find(o => o.getAttribute('data-tier-key') === '30.00');
    fireEvent.click(tier30);
    expect(onPick).toHaveBeenCalledWith('b3');
  });

  it('menu closes after a pick', () => {
    render(<TierSwitchChip currentSell={25} tiers={twoTiers} onPick={() => {}} t={t} />);
    fireEvent.click(screen.getByTestId('tier-switch-chip'));
    expect(screen.getByTestId('tier-switch-menu')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('tier-switch-option')[0]);
    expect(screen.queryByTestId('tier-switch-menu')).not.toBeInTheDocument();
  });
});
