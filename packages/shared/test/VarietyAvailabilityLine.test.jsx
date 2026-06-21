// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VarietyAvailabilityLine from '../components/VarietyAvailabilityLine.jsx';
import { getVarietyAvailability } from '../utils/stockMath.js';

const t = { onHand: 'On hand', premade: 'Premade', available: 'Available', effective: 'Effective' };

describe('VarietyAvailabilityLine', () => {
  it('shows On hand and Available with the premade gap', () => {
    render(<VarietyAvailabilityLine availability={{ net: 22, reserved: 6, available: 28, incoming: 0, effective: 22, arrivals: [] }} />);
    expect(screen.getByTestId('avail-onhand')).toHaveTextContent('22');
    expect(screen.getByText(/6/)).toBeInTheDocument();      // premade
    expect(screen.getByTestId('avail-available')).toHaveTextContent('28');
    expect(screen.queryByText(/Committed/)).toBeNull();      // dropped
  });

  it('hides Premade/Available when nothing reserved', () => {
    render(<VarietyAvailabilityLine availability={{ net: 9, reserved: 0, available: 9, incoming: 0, effective: 9, arrivals: [] }} />);
    expect(screen.getByTestId('avail-onhand')).toHaveTextContent('9');
    expect(screen.queryByTestId('avail-available')).toBeNull();
  });

  it('flags a negative net as a shortfall (amber)', () => {
    const a = getVarietyAvailability([{ id: 'p', current_quantity: -7 }]);
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const onHandEl = screen.getByTestId('avail-onhand');
    expect(onHandEl.textContent).toContain('-7');
    expect(onHandEl.className).toMatch(/amber/);
  });

  it('shows incoming (+N), an arriving DateTag, and Effective when a PO is pending', () => {
    const a = getVarietyAvailability(
      [{ id: 'p', current_quantity: -7 }],
      new Map(),
      [{ date: '2026-06-16', qty: 7, overdue: false }],
    );
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const inc = screen.getByTestId('avail-incoming');
    expect(inc.textContent).toContain('+7');
    expect(screen.getByTestId('variety-availability').textContent).toContain('Effective');
    expect(screen.getByTestId('date-tag').getAttribute('data-kind')).toBe('arriving');
  });

  it('DateTag receives overdue=true when arrival is overdue', () => {
    const arrivals = [{ date: '2026-06-16', qty: 7, overdue: true }];
    const a = getVarietyAvailability([{ id: 'p', current_quantity: -7 }], new Map(), arrivals);
    render(<VarietyAvailabilityLine availability={a} t={t} />);
    const tag = screen.getByTestId('date-tag');
    // overdue tag should render red classes
    expect(tag.className).toMatch(/red/);
  });
});
