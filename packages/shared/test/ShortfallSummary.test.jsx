// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import ShortfallSummary from '../components/ShortfallSummary.jsx';

const t = {
  stems: 'stems', undatedShort: '—',
  shortfallsTitle: 'Shortfalls',
  traceEmpty: 'No events',
  traceTypeOrder: 'Order', traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase', traceTypePremade: 'Premade',
};

// One short Variety (net < 0) with a dated Demand Entry.
const groups = [{
  key: 'Peony|Pink|50|', type_name: 'Peony', colour: 'Pink', size_cm: 50, cultivar: null,
  rows: [{ id: 'd1', current_quantity: -7, date: '2026-06-20' }],
}];

describe('ShortfallSummary date header (CR-32)', () => {
  it('renders the needed-by date as a DateTag (DD.MM.YYYY), not a relative "+Nd"', () => {
    render(<ShortfallSummary groups={groups} t={t} today="2026-06-12" />);
    const section = screen.getByTestId('shortfall-date-2026-06-20');
    const tag = within(section).getByTestId('date-tag');
    expect(tag).toHaveTextContent('20.06.2026');
    expect(tag).toHaveAttribute('data-kind', 'needed');
  });

  it('never shows a raw ISO date or a "+Nd" label in the header', () => {
    render(<ShortfallSummary groups={groups} t={t} today="2026-06-12" />);
    const header = screen.getByTestId('shortfall-date-2026-06-20')
      .querySelector('[data-testid="date-tag"]').textContent;
    expect(header).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(header).not.toMatch(/\+\d+d/);
  });
});

describe('ShortfallSummary date-aware netting (CR-39)', () => {
  const tn = { ...t };

  it('an IN-TIME pending arrival clears the shortfall (row drops)', () => {
    const g = [{
      key: 'Lisianthus|White|50|', type_name: 'Lisianthus', colour: 'White', size_cm: 50, cultivar: null,
      rows: [{ id: 'd1', current_quantity: -12, date: '2026-06-18' }],
    }];
    const pendingPO = { d1: { ordered: 20, plannedDate: '2026-06-16',
      pos: [{ quantity: 20, plannedDate: '2026-06-16' }] } };
    const { container } = render(
      <ShortfallSummary groups={g} pendingPO={pendingPO} t={tn} today="2026-06-12" />,
    );
    // Covered in time → the whole panel renders nothing.
    expect(container.firstChild).toBeNull();
  });

  it('a LATE pending arrival leaves the shortfall but signals it', () => {
    const g = [{
      key: 'Peony|Pink|50|', type_name: 'Peony', colour: 'Pink', size_cm: 50, cultivar: null,
      rows: [{ id: 'd1', current_quantity: -7, date: '2026-06-15' }],
    }];
    const pendingPO = { d1: { ordered: 7, plannedDate: '2026-06-16',
      pos: [{ quantity: 7, plannedDate: '2026-06-16' }] } };
    render(<ShortfallSummary groups={g} pendingPO={pendingPO} t={tn} today="2026-06-12" />);
    const section = screen.getByTestId('shortfall-date-2026-06-15');
    expect(within(section).getByTestId('shortfall-row')).toHaveTextContent('Peony');
    expect(within(section).getByTestId('shortfall-late')).toHaveTextContent('7');
  });

  it('no PO → full shortfall, no late signal', () => {
    const g = [{
      key: 'Ranunculus|Orange|40|', type_name: 'Ranunculus', colour: 'Orange', size_cm: 40, cultivar: null,
      rows: [{ id: 'd1', current_quantity: -5, date: '2026-06-20' }],
    }];
    render(<ShortfallSummary groups={g} t={tn} today="2026-06-12" />);
    expect(screen.getByTestId('shortfall-date-2026-06-20')).toBeInTheDocument();
    expect(screen.queryByTestId('shortfall-late')).toBeNull();
  });
});

// ── Task 2: fetchVarietyUsage → VarietyTracePanel ──────────────────────────
const groupsForTrace = [{
  key: 'Peony|Pink|60|Sarah',
  type_name: 'Peony', colour: 'Pink', size_cm: 60, cultivar: 'Sarah',
  rows: [{ id: 'de1', date: '2026-06-22', current_quantity: -7 }],
}];

it('expands a shortfall row to the full VarietyTracePanel via fetchVarietyUsage', async () => {
  const fetchVarietyUsage = vi.fn().mockResolvedValue({
    events: [
      { type: 'order', qty: -7, orderId: '#202605-1', customer: 'Jane', date: '2026-06-20' },
      { type: 'purchase', qty: 25, supplier: 'FarmCo', date: '2026-06-18' },
    ],
    unaccountedStems: 0,
  });

  render(<ShortfallSummary groups={groupsForTrace} reservations={new Map()} t={t} fetchVarietyUsage={fetchVarietyUsage} today="2026-06-21" />);

  fireEvent.click(screen.getByTestId('shortfall-row'));
  await waitFor(() => expect(fetchVarietyUsage).toHaveBeenCalledWith('Peony|Pink|60|Sarah'));
  // VarietyTracePanel renders trace-row entries (order + purchase), not just orders.
  const rows = await screen.findAllByTestId('trace-row');
  expect(rows.length).toBe(2);
  expect(screen.getByText('Purchase')).toBeInTheDocument();
});
