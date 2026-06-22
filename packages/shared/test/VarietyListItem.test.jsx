// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyListItem from '../components/VarietyListItem.jsx';

const t = { onHand: 'on hand', planned: 'planned', reserved: 'reserved', net: 'net', stems: 'stems' };
const variety = {
  key: 'Rose|Pink|60|',
  type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
  rows: [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }],
};

describe('VarietyListItem header', () => {
  it('hides Type when hideType=true (under TypeGroupHeader)', () => {
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('Pink')).toBeInTheDocument();
    expect(screen.getByText('60cm')).toBeInTheDocument();
    expect(screen.queryByText('Rose')).not.toBeInTheDocument();
  });

  it('shows Type inline at same prominence as Colour when hideType=false (default)', () => {
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      expanded={false} onToggle={() => {}} />);
    expect(screen.getByText('Rose')).toBeInTheDocument();
    expect(screen.getByText('Pink')).toBeInTheDocument();
  });

  it('renders 4 buckets aligned right', () => {
    render(<VarietyListItem variety={variety} reservations={new Map([['b1', 3]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByTestId('bucket-onHand')).toHaveTextContent('10');
    expect(screen.getByTestId('bucket-planned')).toHaveTextContent('0');
    expect(screen.getByTestId('bucket-reserved')).toHaveTextContent('3');
    expect(screen.getByTestId('bucket-net')).toHaveTextContent('7');
  });

  it('cultivar shown only when non-null', () => {
    const v2 = { ...variety, cultivar: "Sarah Bernhardt" };
    render(<VarietyListItem variety={v2} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Sarah Bernhardt/)).toBeInTheDocument();
  });

  it('toggles expanded on header click', () => {
    const onToggle = vi.fn();
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('variety-header'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('header click toggles expand but does NOT auto-open trace (CR-37)', () => {
    const onRowClick = vi.fn();
    const onVarietyTrace = vi.fn();
    const onToggle = vi.fn();
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={onToggle}
      onRowClick={onRowClick} onVarietyTrace={onVarietyTrace} />);
    fireEvent.click(screen.getByTestId('variety-header'));
    expect(onToggle).toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onVarietyTrace).not.toHaveBeenCalled();
  });

  it('explicit Trace button calls onVarietyTrace(variety.key) (CR-37)', () => {
    const onVarietyTrace = vi.fn();
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onVarietyTrace={onVarietyTrace} />);
    fireEvent.click(screen.getByTestId('variety-trace-btn'));
    expect(onVarietyTrace).toHaveBeenCalledWith('Rose|Pink|60|');
  });

  it('Trace button falls back to onRowClick(primary positive Batch) when no onVarietyTrace', () => {
    const v = {
      key: 'Rose|Pink|60|',
      type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
      rows: [
        { id: 'd1', current_quantity: -3, date: '2026-05-12' }, // Demand first
        { id: 'b1', current_quantity: 10, date: '2026-05-10' }, // Batch second
      ],
    };
    const onRowClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onRowClick={onRowClick} />);
    fireEvent.click(screen.getByTestId('variety-trace-btn'));
    expect(onRowClick).toHaveBeenCalledWith('b1');
  });
});

describe('VarietyListItem expansion', () => {
  const v = {
    key: 'Rose|Pink|60|',
    type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
    rows: [
      { id: 'b1', current_quantity: 10, date: '2026-05-10' },
      { id: 'b2', current_quantity:  5, date: '2026-05-11' },
      { id: 'd1', current_quantity: -3, date: '2026-05-12' },
    ],
  };

  it('merges Batch rows with same sell price; Demand rows stay distinct (merge rule, 2026-05-31)', () => {
    // b1 + b2 both have current_sell_price unset → both collapse into one
    // merged Batch row. d1 is a Demand Entry, stays separate. Total: 2 rows.
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.getAllByTestId('stock-item-row')).toHaveLength(2);
  });

  it('hides nested rows when collapsed', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.queryAllByTestId('stock-item-row')).toHaveLength(0);
  });

  it('Demand rows surface their requirement date; Batch rows hide arrival date after merge', () => {
    // 2026-05-12 is the Demand requirement date — should render.
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.getByText(/12\.05\.2026/)).toBeInTheDocument();
  });

  it('Demand Entry rows are visually distinct (data-row-kind="demand")', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    const rows = screen.getAllByTestId('stock-item-row');
    const kinds = rows.map(r => r.getAttribute('data-row-kind'));
    // After merge: 1 merged Batch row + 1 Demand row.
    expect(kinds.filter(k => k === 'batch')).toHaveLength(1);
    expect(kinds.filter(k => k === 'demand')).toHaveLength(1);
  });

  it('clicking a Batch row fires onRowClick(stockItemId)', () => {
    const onRowClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onRowClick={onRowClick} />);
    const batches = screen.getAllByTestId('stock-item-row').filter(r => r.getAttribute('data-row-kind') === 'batch');
    fireEvent.click(batches[0]);
    expect(onRowClick).toHaveBeenCalledWith('b1');
  });

  it('clicking a Demand Entry row also fires onRowClick (both kinds open the same trace)', () => {
    // Both Batches AND DEs are clickable in the redesign — /stock/:id/usage
    // surfaces the trail for either kind (linked orders for DEs).
    const onRowClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onRowClick={onRowClick} />);
    const demand = screen.getAllByTestId('stock-item-row').find(r => r.getAttribute('data-row-kind') === 'demand');
    fireEvent.click(demand);
    expect(onRowClick).toHaveBeenCalledWith('d1');
  });

  it('still honours legacy onBatchClick prop name (back-compat)', () => {
    const onBatchClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onBatchClick={onBatchClick} />);
    const batches = screen.getAllByTestId('stock-item-row').filter(r => r.getAttribute('data-row-kind') === 'batch');
    fireEvent.click(batches[0]);
    expect(onBatchClick).toHaveBeenCalledWith('b1');
  });

  it('hides sell-price label when only one Batch tier is expanded', () => {
    // Single tier (all batches collapse) → label is redundant; drop it.
    const oneTier = {
      ...v,
      rows: [
        { id: 'b1', current_quantity: 10, current_sell_price: 25, date: '2026-05-10' },
        { id: 'b2', current_quantity:  5, current_sell_price: 25, date: '2026-05-11' },
      ],
    };
    render(<VarietyListItem variety={oneTier} reservations={new Map()} t={{ ...t, currency: 'zł' }}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.queryByText(/25\.00 zł/)).not.toBeInTheDocument();
  });

  it('shows sell-price label on each tier when multiple tiers are expanded', () => {
    // Two tiers (25 and 30) → owner needs to know which is which.
    const twoTiers = {
      ...v,
      rows: [
        { id: 'b1', current_quantity: 10, current_sell_price: 25, date: '2026-05-10' },
        { id: 'b3', current_quantity:  7, current_sell_price: 30, date: '2026-05-11' },
      ],
    };
    render(<VarietyListItem variety={twoTiers} reservations={new Map()} t={{ ...t, currency: 'zł' }}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.getByText(/25\.00 zł/)).toBeInTheDocument();
    expect(screen.getByText(/30\.00 zł/)).toBeInTheDocument();
  });
});

describe('VarietyListItem per-Batch quick-adjust', () => {
  const v = {
    key: 'Rose|Pink|60|',
    type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
    rows: [
      { id: 'b1', current_quantity: 10, date: '2026-05-10' },
      { id: 'b2', current_quantity:  5, date: '2026-05-11' },
      { id: 'd1', current_quantity: -3, date: '2026-05-12' },
    ],
  };

  it('renders no +/- controls when onAdjust is absent', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.queryAllByTestId('variety-adjust-inc')).toHaveLength(0);
    expect(screen.queryAllByTestId('variety-adjust-dec')).toHaveLength(0);
  });

  it('renders +/- on Batch rows only, never on Demand rows', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onAdjust={() => {}} />);
    // After merge: 1 merged Batch row → 1 inc + 1 dec; the Demand row gets none.
    expect(screen.getAllByTestId('variety-adjust-inc')).toHaveLength(1);
    expect(screen.getAllByTestId('variety-adjust-dec')).toHaveLength(1);
  });

  it('clicking + fires onAdjust(stockId, +1) without firing onRowClick', () => {
    const onAdjust = vi.fn();
    const onRowClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onAdjust={onAdjust} onRowClick={onRowClick} />);
    fireEvent.click(screen.getAllByTestId('variety-adjust-inc')[0]);
    expect(onAdjust).toHaveBeenCalledWith('b1', 1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('clicking - fires onAdjust(stockId, -1)', () => {
    const onAdjust = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onAdjust={onAdjust} />);
    fireEvent.click(screen.getAllByTestId('variety-adjust-dec')[0]);
    expect(onAdjust).toHaveBeenCalledWith('b1', -1);
  });
});

describe('VarietyListItem reserved-bucket tap', () => {
  const v = {
    key: 'Rose|Pink|60|',
    type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
    rows: [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }],
  };
  const premades = new Map([
    ['b1', [
      { id: 'pm1', name: 'Spring Bouquet', qty: 2 },
      { id: 'pm2', name: 'Wedding Pink',  qty: 3 },
    ]],
  ]);

  it('reserved bucket is a clickable button when reservedForPremades > 0 AND premadesByStockId provided', () => {
    render(<VarietyListItem variety={v} reservations={new Map([['b1', 5]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}}
      premadesByStockId={premades} />);
    expect(screen.getByTestId('bucket-reserved').tagName).toBe('BUTTON');
  });

  it('reserved bucket is inert (not a button) when reservedForPremades === 0', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}}
      premadesByStockId={premades} />);
    expect(screen.getByTestId('bucket-reserved').tagName).not.toBe('BUTTON');
  });

  it('reserved bucket is inert when premadesByStockId is undefined', () => {
    render(<VarietyListItem variety={v} reservations={new Map([['b1', 5]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByTestId('bucket-reserved').tagName).not.toBe('BUTTON');
  });

  it('clicking reserved bucket reveals premade list (toggle)', () => {
    render(<VarietyListItem variety={v} reservations={new Map([['b1', 5]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}}
      premadesByStockId={premades} />);
    expect(screen.queryByText('Spring Bouquet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bucket-reserved'));
    expect(screen.getByText('Spring Bouquet')).toBeInTheDocument();
    expect(screen.getByText('Wedding Pink')).toBeInTheDocument();
  });

  it('premade list lists qty per bouquet', () => {
    render(<VarietyListItem variety={v} reservations={new Map([['b1', 5]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}}
      premadesByStockId={premades} />);
    fireEvent.click(screen.getByTestId('bucket-reserved'));
    expect(screen.getByTestId('premade-row-pm1')).toHaveTextContent('Spring Bouquet');
    expect(screen.getByTestId('premade-row-pm1')).toHaveTextContent('2');
    expect(screen.getByTestId('premade-row-pm2')).toHaveTextContent('3');
  });

  it('clicking reserved bucket does NOT fire onToggle (header expansion)', () => {
    const onToggle = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map([['b1', 5]])} t={t}
      hideType={true} expanded={false} onToggle={onToggle}
      premadesByStockId={premades} />);
    fireEvent.click(screen.getByTestId('bucket-reserved'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('VarietyListItem owner financials on expand (CR-36)', () => {
  const v = {
    key: 'Peony|Pink|60|', type_name: 'Peony', colour: 'Pink', size_cm: 60, cultivar: 'Sarah Bernhardt',
    rows: [{ id: 'b1', current_quantity: 25, date: '2026-06-10',
             current_cost_price: 12, current_sell_price: 42, supplier: 'Stojek' }],
  };

  it('shows cost / sell / markup / supplier on expand when isOwner', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} isOwner={true} onToggle={() => {}} />);
    const fin = screen.getByTestId('variety-owner-financials');
    expect(fin).toHaveTextContent('12');     // cost
    expect(fin).toHaveTextContent('42');     // sell
    expect(fin).toHaveTextContent('3.5');    // markup 42/12
    expect(fin).toHaveTextContent('Stojek'); // supplier
  });

  // C26: the grouped /stock API emits PascalCase fields via pgToResponse
  // ('Current Cost Price' / 'Current Sell Price' / 'Supplier'), NOT the
  // snake_case current_cost_price/current_sell_price keys the component used to
  // read. Reading only snake_case rendered 0.00 for the owner in production.
  // The snake_case test above stays green (varietyFinancials dual-reads).
  it('reads PascalCase API fields, not just snake_case (C26)', () => {
    const vPascal = {
      key: 'Peony|Pink|60|', type_name: 'Peony', colour: 'Pink', size_cm: 60, cultivar: 'Sarah Bernhardt',
      rows: [{ id: 'b1', current_quantity: 25, date: '2026-06-10',
               'Current Cost Price': 12, 'Current Sell Price': 42, Supplier: 'Stojek' }],
    };
    render(<VarietyListItem variety={vPascal} reservations={new Map()} t={t}
      hideType={true} expanded={true} isOwner={true} onToggle={() => {}} />);
    const fin = screen.getByTestId('variety-owner-financials');
    expect(fin).toHaveTextContent('12.00'); // cost — rendered 0.00 before the fix
    expect(fin).toHaveTextContent('42.00'); // sell — rendered 0.00 before the fix
    expect(fin).toHaveTextContent('3.5');   // markup 42/12
    expect(fin).toHaveTextContent('Stojek'); // supplier
  });

  it('hides owner financials for non-owner', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} isOwner={false} onToggle={() => {}} />);
    expect(screen.queryByTestId('variety-owner-financials')).toBeNull();
  });

  it('does not render financials when collapsed even for owner', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={false} isOwner={true} onToggle={() => {}} />);
    expect(screen.queryByTestId('variety-owner-financials')).toBeNull();
  });
});

describe('VarietyListItem incoming PO sub-line (CR-03)', () => {
  const variety = {
    key: 'Rose|Pink|60|',
    type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
    rows: [{ id: 'b1', current_quantity: 5, date: '2026-05-10' }],
  };

  // pendingPO shape mirrors the /stock/pending-po response:
  // { stockId: { ordered, plannedDate, pos: [{ quantity, plannedDate }] } }
  const pendingPO = {
    b1: {
      ordered: 20,
      plannedDate: '2026-07-01',
      pos: [{ quantity: 20, plannedDate: '2026-07-01' }],
    },
  };

  it('shows data-testid="variety-incoming" with incoming qty when pendingPO supplies an arrival', () => {
    render(
      <VarietyListItem
        variety={variety}
        reservations={new Map()}
        pendingPO={pendingPO}
        todayIso="2026-06-21"
        t={t}
        hideType={true}
        expanded={false}
        onToggle={() => {}}
      />
    );
    const incoming = screen.getByTestId('variety-incoming');
    expect(incoming).toBeInTheDocument();
    expect(incoming).toHaveTextContent('+20');
  });

  it('shows effective (net + incoming) alongside the arrival', () => {
    // net = 5 (onHand) - 0 (planned) - 0 (reserved) = 5; effective = 5 + 20 = 25
    render(
      <VarietyListItem
        variety={variety}
        reservations={new Map()}
        pendingPO={pendingPO}
        todayIso="2026-06-21"
        t={t}
        hideType={true}
        expanded={false}
        onToggle={() => {}}
      />
    );
    const incoming = screen.getByTestId('variety-incoming');
    expect(incoming).toHaveTextContent('25');
  });

  it('hides the incoming sub-line when pendingPO is empty', () => {
    render(
      <VarietyListItem
        variety={variety}
        reservations={new Map()}
        pendingPO={{}}
        todayIso="2026-06-21"
        t={t}
        hideType={true}
        expanded={false}
        onToggle={() => {}}
      />
    );
    expect(screen.queryByTestId('variety-incoming')).toBeNull();
  });

  it('overdue arrival renders DateTag in red (bg-red-100 / text-red-700)', () => {
    // todayIso AFTER the planned date → overdue
    render(
      <VarietyListItem
        variety={variety}
        reservations={new Map()}
        pendingPO={pendingPO}
        todayIso="2026-08-01"
        t={t}
        hideType={true}
        expanded={false}
        onToggle={() => {}}
      />
    );
    const dateTag = screen.getByTestId('date-tag');
    // data-kind stays "arriving"
    expect(dateTag).toHaveAttribute('data-kind', 'arriving');
    // overdue=true → class includes bg-red-100 text-red-700
    expect(dateTag.className).toMatch(/bg-red-100/);
    expect(dateTag.className).toMatch(/text-red-700/);
  });

  it('future arrival renders DateTag in blue (bg-blue-100 / text-blue-700)', () => {
    // todayIso BEFORE the planned date → not overdue
    render(
      <VarietyListItem
        variety={variety}
        reservations={new Map()}
        pendingPO={pendingPO}
        todayIso="2026-06-21"
        t={t}
        hideType={true}
        expanded={false}
        onToggle={() => {}}
      />
    );
    const dateTag = screen.getByTestId('date-tag');
    expect(dateTag).toHaveAttribute('data-kind', 'arriving');
    expect(dateTag.className).toMatch(/bg-blue-100/);
    expect(dateTag.className).toMatch(/text-blue-700/);
  });
});
