// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchArrivalList from '../components/BatchArrivalList.jsx';

const t = {
  type: 'type', variety: 'variety', available: 'available',
  cost: 'cost', sell: 'sell', markup: 'markup', supplier: 'supplier',
  arrived: 'arrived', qty: 'qty', stems: 'stems',
  expand: 'Expand', collapse: 'Collapse',
  costMixedShort: 'mixed', costMixedTooltip: 'Mixed costs across receives — showing newest',
};

// Two batches of Rose Pink 60 at the same sell price (25 zł) but different
// costs and suppliers → ONE merged row with chevron + drill-down.
function makeMergedGroup() {
  return [{
    type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
    rows: [
      { id: 's1', current_quantity: 10, current_sell_price: 25, current_cost_price: 10, supplier: 'Akito',   date: '2026-05-10' },
      { id: 's2', current_quantity: 6,  current_sell_price: 25, current_cost_price: 12, supplier: 'Mondial', date: '2026-05-13' },
    ],
  }];
}

function makeSingleGroup() {
  return [{
    type_name: 'Peony', colour: 'White', size_cm: 50, cultivar: null,
    rows: [
      { id: 'p1', current_quantity: 8, current_sell_price: 30, current_cost_price: 9, supplier: 'Akito', date: '2026-05-12' },
    ],
  }];
}

describe('BatchArrivalList — merged-row drill-down (B3)', () => {
  it('renders a chevron only when the merged row covers >1 underlying stock', () => {
    render(<BatchArrivalList groups={[...makeMergedGroup(), ...makeSingleGroup()]} t={t} />);
    // One row per Variety+sell tier → two rows total. Only the Rose row has a chevron.
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(2);
    expect(screen.getAllByTestId('batch-row-expand')).toHaveLength(1);
  });

  it('chevron toggles drill-down panel without firing onRowClick', () => {
    const onRowClick = vi.fn();
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} onRowClick={onRowClick} />);
    expect(screen.queryByTestId('batch-row-detail')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('batch-row-expand'));
    expect(screen.getByTestId('batch-row-detail')).toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('batch-row-expand'));
    expect(screen.queryByTestId('batch-row-detail')).not.toBeInTheDocument();
  });

  it('drill-down shows one line per underlying stock with date / qty / cost / supplier', () => {
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} />);
    fireEvent.click(screen.getByTestId('batch-row-expand'));
    const panel = screen.getByTestId('batch-row-detail');
    // Newest first: s2 (May 13) before s1 (May 10).
    expect(panel).toHaveTextContent('13.05.2026');
    expect(panel).toHaveTextContent('10.05.2026');
    expect(panel).toHaveTextContent('Akito');
    expect(panel).toHaveTextContent('Mondial');
    expect(panel).toHaveTextContent('12.00'); // s2 cost
    expect(panel).toHaveTextContent('10.00'); // s1 cost
  });

  it('row tap-target still opens trace with the merged stockIds', () => {
    const onRowClick = vi.fn();
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByTestId('batch-arrival-row'));
    expect(onRowClick).toHaveBeenCalledWith(['s1', 's2']);
  });

  it('mixed-cost badge text comes from t.costMixedShort, not a hardcoded literal (CR-14)', () => {
    // Rose merged group has two costs (10 + 12) → costMixed true → badge shown.
    render(<BatchArrivalList groups={makeMergedGroup()} t={{ ...t, costMixedShort: 'XQZ' }} />);
    expect(screen.getByText('·XQZ')).toBeInTheDocument();
  });

  it('·mixed does NOT fire for one positive batch + a zero-qty absorbed demand entry (CR-14)', () => {
    // Anemone: one real receive @8.00 + an absorbed DE (qty 0) carrying a stray
    // cost 14.19. The DE has no cost basis → must not trigger the mixed badge.
    const groups = [{
      type_name: 'Anemone', colour: 'Burgundy', size_cm: 40, cultivar: null,
      rows: [
        { id: 'ab',  current_quantity: 10, current_sell_price: 20, current_cost_price: 8,     date: '2026-06-20' },
        { id: 'ade', current_quantity: 0,  current_sell_price: 20, current_cost_price: 14.19, date: '2026-06-17' },
      ],
    }];
    render(<BatchArrivalList groups={groups} t={t} />);
    expect(screen.getByText(/8\.00/)).toBeInTheDocument(); // newest positive receive cost
    expect(screen.queryByText('·mixed')).toBeNull();       // no spurious mix badge
  });

  it('·mixed DOES fire for two positive batches at different costs (CR-14 guard)', () => {
    const groups = [{
      type_name: 'Carnation', colour: 'Red', size_cm: 50, cultivar: null,
      rows: [
        { id: 'c1', current_quantity: 16, current_sell_price: 30, current_cost_price: 8,  date: '2026-06-20' },
        { id: 'c2', current_quantity: 14, current_sell_price: 30, current_cost_price: 12, date: '2026-06-15' },
      ],
    }];
    render(<BatchArrivalList groups={groups} t={t} />);
    expect(screen.getByText('·mixed')).toBeInTheDocument();
  });

  it('premade shown as a SUBSET: leads with free (qty − reserved), never additive "+" (CR-17)', () => {
    const groups = [{
      type_name: 'Hydrangea', colour: 'Blue', size_cm: 60, cultivar: null,
      rows: [{ id: 'h1', current_quantity: 18, current_sell_price: 40, current_cost_price: 9, supplier: 'Akito', date: '2026-06-20' }],
    }];
    render(<BatchArrivalList groups={groups} reservations={new Map([['h1', 6]])} t={{ ...t, inPremade: 'in premade' }} />);
    expect(screen.getByText('12')).toBeInTheDocument();        // free = 18 − 6 leads
    expect(screen.getByText(/6 in premade/)).toBeInTheDocument(); // labelled premade
    expect(screen.queryByText('+6')).toBeNull();               // never "+6" (the additive bug)
    expect(screen.queryByText('18')).toBeNull();               // physical total no longer the headline
  });
});
