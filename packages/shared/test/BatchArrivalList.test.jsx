// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchArrivalList from '../components/BatchArrivalList.jsx';
import { EMPTY_STOCK_FILTER } from '../utils/stockFilters.js';

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

// One Rose (qty 10) + one Peony (qty 8) — distinct types for filter/footer tests.
function twoTypes() {
  return [
    { type_name: 'Rose',  colour: 'Pink',  size_cm: 60, cultivar: null,
      rows: [{ id: 'r1', current_quantity: 10, current_sell_price: 25, current_cost_price: 10, supplier: 'Akito',   date: '2026-05-10' }] },
    { type_name: 'Peony', colour: 'White', size_cm: 50, cultivar: null,
      rows: [{ id: 'p1', current_quantity: 8,  current_sell_price: 30, current_cost_price: 9,  supplier: 'Mondial', date: '2026-05-12' }] },
  ];
}

// A Not-Found original: a pure Demand Entry (negative qty, no batches) that was
// substituted. Its group carries substitutedBy = the substitute display name.
function substitutedGroup() {
  return [{
    key: 'Dahlia|Pink||', type_name: 'Dahlia', colour: 'Pink', size_cm: null, cultivar: null,
    substitutedBy: 'Dahlia Peach',
    rows: [{ id: 'd1', current_quantity: -10, current_sell_price: 20, current_cost_price: 8, date: '2026-08-01' }],
  }];
}

describe('BatchArrivalList — substituted tag (#376)', () => {
  it('tags a substituted original with the substitute display name', () => {
    render(<BatchArrivalList groups={substitutedGroup()} t={{ ...t, substitutedBy: 'замена' }} />);
    const tag = screen.getByTestId('batch-substituted');
    expect(tag).toBeInTheDocument();
    expect(tag).toHaveTextContent('замена');
    expect(tag).toHaveTextContent('Dahlia Peach');
  });

  it('renders no substituted tag for a normal Variety', () => {
    render(<BatchArrivalList groups={makeSingleGroup()} t={t} />);
    expect(screen.queryByTestId('batch-substituted')).not.toBeInTheDocument();
  });
});

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

  it('row tap-target opens trace with the merged stockIds + the flattened row (varietyKey)', () => {
    const onRowClick = vi.fn();
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByTestId('batch-arrival-row'));
    expect(onRowClick).toHaveBeenCalledWith(
      ['s1', 's2'],
      expect.objectContaining({ varietyKey: 'Rose|Pink|60|' }),
    );
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

  it('A: hideEmpty drops 0-qty tiers within a surviving Variety, but shows them by default', () => {
    // Hydrangea Pink with three sell tiers, only the 60zł tier has stock — the
    // 65zł/70zł tiers are the "0 available" duplicates the owner saw.
    const mixed = () => [{
      type_name: 'Hydrangea', colour: 'Pink', size_cm: 60, cultivar: null,
      rows: [
        { id: 'a', current_quantity: 5, current_sell_price: 60, current_cost_price: 22, date: '2026-06-30' },
        { id: 'b', current_quantity: 0, current_sell_price: 65, current_cost_price: 0,  date: '2026-06-30' },
        { id: 'c', current_quantity: 0, current_sell_price: 70, current_cost_price: 0,  date: '2026-06-30' },
      ],
    }];
    // Default: all three tiers render.
    const { unmount } = render(<BatchArrivalList groups={mixed()} t={t} />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(3);
    unmount();
    // hideEmpty: only the in-stock tier survives.
    render(<BatchArrivalList groups={mixed()} t={t} hideEmpty />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(1);
  });

  it('A: hideEmpty keeps a 0-qty tier that still holds premade reservations', () => {
    const groups = [{
      type_name: 'Hydrangea', colour: 'Pink', size_cm: 60, cultivar: null,
      rows: [
        { id: 'a', current_quantity: 5, current_sell_price: 60, date: '2026-06-30' },
        { id: 'b', current_quantity: 0, current_sell_price: 65, date: '2026-06-30' },
      ],
    }];
    render(<BatchArrivalList groups={groups} reservations={new Map([['b', 4]])} t={t} hideEmpty />);
    // tier a (in stock) + tier b (0 on hand but 4 reserved) both survive.
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(2);
  });

  it('E1: filter prop excludes non-matching rows', () => {
    render(<BatchArrivalList groups={twoTypes()} t={t} filter={{ ...EMPTY_STOCK_FILTER, typeQuery: 'peony' }} onFilterChange={() => {}} />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(1);
    expect(screen.getByText('White')).toBeInTheDocument(); // the Peony row
    expect(screen.queryByText('Pink')).toBeNull();          // Rose filtered out
  });

  it('E1: keeps the header + shows empty state when a filter matches nothing (popovers stay reachable)', () => {
    render(<BatchArrivalList groups={twoTypes()} t={t} filter={{ ...EMPTY_STOCK_FILTER, typeQuery: 'zzz' }} onFilterChange={() => {}} />);
    expect(screen.getByTestId('batch-arrival-empty')).toBeInTheDocument();
    expect(screen.getByTestId('sort-type')).toBeInTheDocument(); // header survives
  });

  it('E1: renders per-column filter triggers only when onFilterChange is provided', () => {
    const { unmount } = render(<BatchArrivalList groups={twoTypes()} t={t} />);
    expect(screen.queryByLabelText('type')).toBeNull(); // no funnel without a handler
    unmount();
    render(<BatchArrivalList groups={twoTypes()} t={t} onFilterChange={() => {}} />);
    expect(screen.getByLabelText('type')).toBeInTheDocument(); // funnel trigger present
  });

  it('E2: footer sums count + qty over the visible rows only when footer is set', () => {
    const { unmount } = render(<BatchArrivalList groups={twoTypes()} t={t} />);
    expect(screen.queryByTestId('batch-arrival-footer')).toBeNull();
    unmount();
    render(<BatchArrivalList groups={twoTypes()} t={{ ...t, total: 'Total' }} footer />);
    const footer = screen.getByTestId('batch-arrival-footer');
    expect(footer).toHaveTextContent('Total (2)');
    expect(footer).toHaveTextContent('18'); // 10 + 8 qty
  });

  it('E2: footer totals reflect the active filter', () => {
    render(<BatchArrivalList groups={twoTypes()} t={{ ...t, total: 'Total' }} footer filter={{ ...EMPTY_STOCK_FILTER, typeQuery: 'rose' }} onFilterChange={() => {}} />);
    const footer = screen.getByTestId('batch-arrival-footer');
    expect(footer).toHaveTextContent('Total (1)');
    expect(footer).toHaveTextContent('10'); // only the Rose qty
  });

  it('no legacy Correct-count toggle — the +/- are always-visible now (2026-07-14)', () => {
    render(<BatchArrivalList groups={makeSingleGroup()} t={t} onAdjust={() => {}} />);
    expect(screen.queryByTestId('batch-correct-toggle')).toBeNull();
  });

  it('reserves an actions column only when onAdjust or onWriteOff is wired', () => {
    const { unmount } = render(<BatchArrivalList groups={makeSingleGroup()} t={t} />);
    expect(screen.queryByTestId('batch-actions-header')).toBeNull();
    expect(screen.queryByTestId('batch-adjust-inc')).toBeNull();
    unmount();
    render(<BatchArrivalList groups={makeSingleGroup()} t={t} onAdjust={() => {}} />);
    expect(screen.getByTestId('batch-actions-header')).toBeInTheDocument();
  });

  it('+/- are visible with no toggle and fire onAdjust(stockId, ±1) without opening the trace', () => {
    const onAdjust = vi.fn();
    const onRowClick = vi.fn();
    render(<BatchArrivalList groups={makeSingleGroup()} t={t} onAdjust={onAdjust} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByTestId('batch-adjust-inc'));
    expect(onAdjust).toHaveBeenCalledWith('p1', 1);
    fireEvent.click(screen.getByTestId('batch-adjust-dec'));
    expect(onAdjust).toHaveBeenCalledWith('p1', -1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('adjust targets the FEFO-oldest in-stock batch of a merged row', () => {
    // Merged Rose row: s1 (May 10) + s2 (May 13). Oldest in-stock = s1.
    const onAdjust = vi.fn();
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} onAdjust={onAdjust} />);
    fireEvent.click(screen.getByTestId('batch-adjust-dec'));
    expect(onAdjust).toHaveBeenCalledWith('s1', -1);
  });

  it('🗑 write-off button renders with onWriteOff and fires onWriteOff(row) with the row, not the trace', () => {
    const onWriteOff = vi.fn();
    const onRowClick = vi.fn();
    render(<BatchArrivalList groups={makeMergedGroup()} t={t} onWriteOff={onWriteOff} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByTestId('batch-writeoff'));
    expect(onWriteOff).toHaveBeenCalledTimes(1);
    expect(onWriteOff.mock.calls[0][0].stockIds).toEqual(['s1', 's2']);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('hides row actions for a synthesized shortfall row with no in-stock batch', () => {
    // A Variety with only a Demand Entry (negative qty) → no positive batch →
    // fefoOldestId is null → nothing to recount or write off.
    const shortfallOnly = [{
      type_name: 'Tulip', colour: 'Red', size_cm: 40, cultivar: null,
      rows: [{ id: 'de1', current_quantity: -5, current_sell_price: 15, date: '2026-06-01' }],
    }];
    render(<BatchArrivalList groups={shortfallOnly} t={t} onAdjust={() => {}} onWriteOff={() => {}} />);
    expect(screen.queryByTestId('batch-adjust-inc')).toBeNull();
    expect(screen.queryByTestId('batch-writeoff')).toBeNull();
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

// #533 follow-up — the flat table must show each Variety's REAL position
// (net of committed demand), matching the by-Variety buckets, and must not
// pile up zero-qty sibling rows from receive/substitute card creation.
describe('BatchArrivalList — demand-aware Available (#533 follow-up)', () => {
  // Prod shape 2026-07-08: Hydrangea Pink batch +5 (Jul 8) exactly offset by a
  // Demand Entry −5 for an order due Jul 12. Physical 5, committed 5, net 0.
  const hydrangea = () => [{
    key: 'Hydrangea|Pink||',
    type_name: 'Hydrangea', colour: 'Pink', size_cm: null, cultivar: null,
    hasActiveConsumer: true,
    rows: [
      { id: 'batch',  current_quantity: 5,  current_sell_price: 60, current_cost_price: 20, supplier: 'Stefan', date: '2026-07-08' },
      { id: 'demand', current_quantity: -5, current_sell_price: 60, date: '2026-07-12' },
    ],
  }];

  it('Available = physical − committed, with a "committed · date" hint', () => {
    render(<BatchArrivalList groups={hydrangea()} t={{ ...t, committed: 'Committed' }} />);
    const row = screen.getByTestId('batch-arrival-row').parentElement;
    expect(row).toHaveTextContent(/·\s*5 committed · 12\.07/); // hint names the claim + its date
    expect(screen.getByText('0')).toBeInTheDocument();         // headline = net, not physical 5
    expect(screen.queryByText('5', { selector: '.text-base' })).toBeNull();
  });

  it('hideEmpty keeps a fully-committed (net-zero) tier visible — tier-level #533', () => {
    render(<BatchArrivalList groups={hydrangea()} t={t} hideEmpty />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(1);
  });

  it('a Variety with demand but NO batches still gets a (negative) shortfall row', () => {
    const groups = [{
      key: 'Peony|Coral||',
      type_name: 'Peony', colour: 'Coral', size_cm: null, cultivar: null,
      rows: [{ id: 'de1', current_quantity: -4, current_sell_price: 30, date: '2026-07-15' }],
    }];
    render(<BatchArrivalList groups={groups} t={t} hideEmpty />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(1);
    expect(screen.getByText('-4')).toBeInTheDocument(); // pure shortfall is visible, not silently dropped
  });

  it('FEFO: committed drains the oldest tier first, remainder hits the newer tier', () => {
    const groups = [{
      key: 'Rose|Red||',
      type_name: 'Rose', colour: 'Red', size_cm: null, cultivar: null,
      rows: [
        { id: 'old', current_quantity: 10, current_sell_price: 40, date: '2026-06-01' },
        { id: 'new', current_quantity: 5,  current_sell_price: 60, date: '2026-07-01' },
        { id: 'de',  current_quantity: -12, current_sell_price: 60, date: '2026-07-10' },
      ],
    }];
    render(<BatchArrivalList groups={groups} t={t} />);
    // old tier: 10 − 10 = 0; new tier: 5 − 2 = 3.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('10', { selector: '.text-base' })).toBeNull();
  });

  it('footer qty sums the displayed available (net), not raw physical', () => {
    render(<BatchArrivalList groups={hydrangea()} t={{ ...t, total: 'Total' }} footer />);
    const footer = screen.getByTestId('batch-arrival-footer');
    expect(footer).toHaveTextContent('Total (1)');
    // qty cell = 0 (net), not 5 (physical)
    expect(footer.querySelectorAll('span')[2].textContent).toBe('0');
  });

  it('C: a zero-qty sibling card (substitute/orig) is hidden from the expansion — no 0-row duplicate', () => {
    // Prod shape: "Rose Country Blues" substitute card (qty 0) + its dated batch
    // (qty 20), created in the same evaluate — must read as ONE row, no chevron.
    const groups = [{
      key: 'Rose|Dark Pink||',
      type_name: 'Rose', colour: 'Dark Pink', size_cm: null, cultivar: null,
      rows: [
        { id: 'card',  current_quantity: 0,  current_sell_price: 15, current_cost_price: 3.6, supplier: '4f', date: '2026-07-07' },
        { id: 'batch', current_quantity: 20, current_sell_price: 15, current_cost_price: 3.6, supplier: '4f', date: '2026-07-07' },
      ],
    }];
    render(<BatchArrivalList groups={groups} t={t} />);
    expect(screen.getAllByTestId('batch-arrival-row')).toHaveLength(1);
    expect(screen.getByText('20')).toBeInTheDocument();
    // Only one meaningful constituent → no expand chevron at all.
    expect(screen.queryByTestId('batch-row-expand')).toBeNull();
  });

  it('C: expansion still lists multiple POSITIVE constituents, zero-qty cards filtered out', () => {
    const groups = [{
      key: 'Rose|Pink|60|',
      type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
      rows: [
        { id: 'card', current_quantity: 0,  current_sell_price: 25, current_cost_price: 10, supplier: 'Akito', date: '2026-05-01' },
        { id: 's1',   current_quantity: 10, current_sell_price: 25, current_cost_price: 10, supplier: 'Akito', date: '2026-05-10' },
        { id: 's2',   current_quantity: 6,  current_sell_price: 25, current_cost_price: 12, supplier: 'Mondial', date: '2026-05-13' },
      ],
    }];
    render(<BatchArrivalList groups={groups} t={t} />);
    fireEvent.click(screen.getByTestId('batch-row-expand'));
    const panel = screen.getByTestId('batch-row-detail');
    expect(panel).toHaveTextContent('13.05.2026');
    expect(panel).toHaveTextContent('10.05.2026');
    expect(panel).not.toHaveTextContent('01.05.2026'); // the empty card row is gone
  });
});
