// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PendingArrivalsPanel from '../components/PendingArrivalsPanel.jsx';

// CR-33: pending arrivals are grouped BY ARRIVAL DATE (mirrors ShortfallSummary),
// each date headed by a DateTag (kind=arriving); no "+Nd" chip, no "N varieties /
// N stems incoming" summary.
const t = { pendingArrivals: 'Incoming', stems: 'stems', undatedShort: '—' };
const TODAY = '2026-06-12';

function setup(pendingPO, stock) {
  return render(<PendingArrivalsPanel pendingPO={pendingPO} stock={stock} t={t} today={TODAY} />);
}

describe('PendingArrivalsPanel (date-grouped, CR-33)', () => {
  it('renders nothing when no pending PO', () => {
    const { container } = setup({}, []);
    expect(container.firstChild).toBeNull();
  });

  it('groups arrivals by date — different flowers on the same date share one section', () => {
    const stock = [
      { id: 's1', Type: 'Peony',      Colour: 'Pink',  Size: 50, Cultivar: null },
      { id: 's2', Type: 'Lisianthus', Colour: 'White', Size: 50, Cultivar: null },
    ];
    const pendingPO = {
      s1: { ordered: 7,  plannedDate: '2026-06-16', pos: [{ id: 'p1', quantity: 7,  plannedDate: '2026-06-16' }] },
      s2: { ordered: 20, plannedDate: '2026-06-16', pos: [{ id: 'p2', quantity: 20, plannedDate: '2026-06-16' }] },
    };
    setup(pendingPO, stock);
    expect(screen.getAllByTestId(/^pending-arrival-date-/)).toHaveLength(1);
    const section = screen.getByTestId('pending-arrival-date-2026-06-16');
    expect(within(section).getAllByTestId('pending-arrival-row')).toHaveLength(2);
  });

  it('heads each date with a DateTag (kind=arriving, DD.MM.YYYY)', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = { s1: { ordered: 7, plannedDate: '2026-06-16', pos: [{ id: 'p1', quantity: 7, plannedDate: '2026-06-16' }] } };
    setup(pendingPO, stock);
    const tag = within(screen.getByTestId('pending-arrival-date-2026-06-16')).getByTestId('date-tag');
    expect(tag).toHaveTextContent('16.06.2026');
    expect(tag).toHaveAttribute('data-kind', 'arriving');
  });

  it('lists each flower with its incoming qty under the date', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = { s1: { ordered: 7, plannedDate: '2026-06-16', pos: [{ id: 'p1', quantity: 7, plannedDate: '2026-06-16' }] } };
    setup(pendingPO, stock);
    const row = screen.getByTestId('pending-arrival-row');
    expect(row.textContent).toContain('Peony');
    expect(row.textContent).toContain('+7');
  });

  it('separate dates → separate sections, earliest first', () => {
    const stock = [
      { id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
      { id: 's2', Type: 'Rose',  Colour: 'Red',  Size: 60, Cultivar: 'Naomi' },
    ];
    const pendingPO = {
      s1: { ordered: 5, plannedDate: '2026-06-20', pos: [{ id: 'p1', quantity: 5, plannedDate: '2026-06-20' }] },
      s2: { ordered: 3, plannedDate: '2026-06-14', pos: [{ id: 'p2', quantity: 3, plannedDate: '2026-06-14' }] },
    };
    setup(pendingPO, stock);
    const dates = screen.getAllByTestId(/^pending-arrival-date-/);
    expect(dates).toHaveLength(2);
    expect(dates[0]).toHaveAttribute('data-testid', 'pending-arrival-date-2026-06-14');
  });

  it('shows no relative "+Nd" label and no "stems incoming" summary', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = { s1: { ordered: 7, plannedDate: '2026-06-16', pos: [{ id: 'p1', quantity: 7, plannedDate: '2026-06-16' }] } };
    const { container } = setup(pendingPO, stock);
    expect(screen.queryByTestId('pending-arrivals-stems')).toBeNull();
    expect(screen.queryByTestId('pending-arrivals-varieties')).toBeNull();
    expect(container.textContent).not.toMatch(/\+\d+d\b/);
  });

  it('falls back to the flower name for a legacy (typeless) stock row', () => {
    const stock = [{ id: 's1', 'Display Name': 'Custom Bouquet Filler', Type: null }];
    const pendingPO = { s1: { ordered: 3, plannedDate: '2026-06-13', flowerName: 'Custom Bouquet Filler',
                              pos: [{ id: 'p1', quantity: 3, plannedDate: '2026-06-13' }] } };
    setup(pendingPO, stock);
    expect(screen.getByText('Custom Bouquet Filler')).toBeInTheDocument();
  });

  it('collapse toggles the date sections', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = { s1: { ordered: 5, plannedDate: '2026-06-13', pos: [{ id: 'p1', quantity: 5, plannedDate: '2026-06-13' }] } };
    setup(pendingPO, stock);
    expect(screen.getAllByTestId(/^pending-arrival-date-/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('pending-arrivals-header'));
    expect(screen.queryByTestId(/^pending-arrival-date-/)).toBeNull();
  });

  describe('row-expand to VarietyTracePanel', () => {
    const expandStock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: 'Sarah' }];
    const expandPendingPO = {
      s1: { plannedDate: '2026-06-25', flowerName: 'Peony', pos: [{ quantity: 25, plannedDate: '2026-06-25' }] },
    };

    it('expands a pending row to VarietyTracePanel via fetchVarietyUsage', async () => {
      const fetchVarietyUsage = vi.fn().mockResolvedValue({
        events: [{ type: 'purchase', qty: 25, supplier: 'FarmCo', date: '2026-06-25' }],
        unaccountedStems: 0,
      });
      render(
        <PendingArrivalsPanel
          pendingPO={expandPendingPO}
          stock={expandStock}
          t={{ ...t, traceTypeOrder: 'Order', traceTypePurchase: 'Purchase', traceEmpty: 'No events' }}
          fetchVarietyUsage={fetchVarietyUsage}
        />,
      );

      fireEvent.click(screen.getByTestId('pending-arrival-row'));
      await waitFor(() => expect(fetchVarietyUsage).toHaveBeenCalledWith('Peony|Pink|60|Sarah'));
      expect(await screen.findByTestId('trace-row')).toBeInTheDocument();
    });

    it('legacy rows (untyped) are not expandable and do not call fetchVarietyUsage', async () => {
      const fetchVarietyUsage = vi.fn().mockResolvedValue({ events: [], unaccountedStems: 0 });
      const legacyStock = [{ id: 'L1', 'Display Name': 'Filler', Type: null }];
      const legacyPO = { L1: { plannedDate: '2026-06-25', flowerName: 'Filler', pos: [{ quantity: 5, plannedDate: '2026-06-25' }] } };
      render(
        <PendingArrivalsPanel
          pendingPO={legacyPO}
          stock={legacyStock}
          t={{ ...t, traceEmpty: 'No events' }}
          fetchVarietyUsage={fetchVarietyUsage}
        />,
      );
      fireEvent.click(screen.getByTestId('pending-arrival-row'));
      // Drain microtasks deterministically (no wall-clock wait — a legacy row
      // triggers no fetch, so a microtask flush is enough to prove the negative).
      await Promise.resolve();
      expect(fetchVarietyUsage).not.toHaveBeenCalled();
      expect(screen.queryByTestId('trace-row')).toBeNull();
    });
  });
});
