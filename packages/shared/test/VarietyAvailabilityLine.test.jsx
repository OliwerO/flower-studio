// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VarietyAvailabilityLine from '../components/VarietyAvailabilityLine.jsx';
import { getVarietyAvailability } from '../utils/stockMath.js';

const t = { onHand: 'On hand', committed: 'Committed', reserved: 'Reserved', net: 'Net', effective: 'Effective' };

describe('VarietyAvailabilityLine', () => {
  it('always shows On hand and Net; hides zero committed/reserved/incoming', () => {
    const a = getVarietyAvailability([{ id: 'a', current_quantity: 30 }]);
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const text = screen.getByTestId('variety-availability').textContent;
    expect(text).toContain('On hand');
    expect(text).toContain('Net');
    expect(text).not.toContain('Committed');
    expect(text).not.toContain('Reserved');
    expect(text).not.toContain('Effective');
    expect(screen.queryByTestId('avail-incoming')).toBeNull();
  });

  it('labels committed + reserved when present', () => {
    const a = getVarietyAvailability(
      [{ id: 'a', current_quantity: 30 }, { id: 'b', current_quantity: -8 }],
      new Map([['a', 3]]),
    );
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const text = screen.getByTestId('variety-availability').textContent;
    expect(text).toContain('Committed');
    expect(text).toContain('Reserved');
    expect(screen.getByTestId('avail-net').textContent).toContain('19');
  });

  it('flags a negative net as a shortfall (amber)', () => {
    const a = getVarietyAvailability([{ id: 'p', current_quantity: -7 }]);
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const netEl = screen.getByTestId('avail-net');
    expect(netEl.textContent).toContain('-7');
    expect(netEl.className).toMatch(/amber/);
  });

  it('shows incoming (+N), an arriving DateTag, and Effective when a PO is pending', () => {
    const a = getVarietyAvailability(
      [{ id: 'p', current_quantity: -7 }],
      new Map(),
      [{ date: '2026-06-16', qty: 7 }],
    );
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const inc = screen.getByTestId('avail-incoming');
    expect(inc.textContent).toContain('+7');
    expect(screen.getByTestId('variety-availability').textContent).toContain('Effective');
    expect(screen.getByTestId('date-tag').getAttribute('data-kind')).toBe('arriving');
  });
});
