// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyAllocationPicker from '../components/VarietyAllocationPicker.jsx';

const t = {
  pickerSearchPlaceholder: 'Search…',
  pickerCreateNew: '+ Create new Variety',
  pickerNoResults: 'No matches',
  stems: 'stems',
  onHand: 'on hand',
  planned: 'planned',
  reserved: 'reserved',
  net: 'net',
  pickerSaveContinue: 'Save & continue',
  pickerOrderFreshAll: 'Order fresh for all',
};

const makeRows = () => [
  { id: 'b1', type_name: 'Rose',   colour: 'Pink',  size_cm: 60, cultivar: null,             current_quantity: 10, date: '2026-05-10' },
  { id: 'b2', type_name: 'Rose',   colour: 'Pink',  size_cm: 60, cultivar: null,             current_quantity: -3, date: '2026-05-12' },
  { id: 'b3', type_name: 'Rose',   colour: 'White', size_cm: 70, cultivar: "Sarah Bernhardt", current_quantity: 5,  date: '2026-05-10' },
  { id: 'b4', type_name: 'Peony',  colour: 'Pink',  size_cm: 50, cultivar: null,             current_quantity: 0,  date: '2026-05-10' },
];

describe('VarietyAllocationPicker — Stage 1 typeahead', () => {
  it('renders one row per non-zero Variety (Peony hidden — zero qty)', () => {
    render(<VarietyAllocationPicker
      stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1}
      role="florist" t={t} onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getAllByTestId('variety-row')).toHaveLength(2);
    expect(screen.getByText(/Rose Pink 60cm/)).toBeInTheDocument();
    expect(screen.getByText(/Rose White 70cm Sarah Bernhardt/)).toBeInTheDocument();
    expect(screen.queryByText(/Peony/)).not.toBeInTheDocument();
  });

  it('cross-field substring match — "sarah" returns one Variety', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'sarah' } });
    expect(screen.getAllByTestId('variety-row')).toHaveLength(1);
    // VarietyIdentity renders cultivar both as a visible italic span and inside the
    // sr-only combined-name span, so multiple matches are expected (#311).
    expect(screen.getAllByText(/Sarah Bernhardt/).length).toBeGreaterThan(0);
  });

  it('cross-field — "60" returns all 60cm Varieties', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '60' } });
    expect(screen.getAllByTestId('variety-row')).toHaveLength(1);
  });

  it('hides zero-qty Varieties by default', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/Peony/)).not.toBeInTheDocument();
  });

  it('"+ Create new Variety" hidden for florist', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('+ Create new Variety')).not.toBeInTheDocument();
  });

  it('"+ Create new Variety" visible for owner', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getByText('+ Create new Variety')).toBeInTheDocument();
  });
});

describe('VarietyAllocationPicker — availability + hide net-zero (S3.2-i)', () => {
  // A benign healthy Variety keeps the list (Stage-1) active so the hide rule
  // is exercised on the LIST path (a lone Variety skips straight to the form).
  const filler = { id: 'f', type_name: 'Tulip', colour: 'Red', size_cm: 40, cultivar: null, current_quantity: 20, date: '2026-05-10' };
  // Lily White 60: 5 on hand, all 5 reserved by premades → net 0, effective 0.
  // Old rule (totalQty 5 > 0) showed it; new rule (effective ≤ 0) hides it (D3).
  const lily = { id: 'x', type_name: 'Lily', colour: 'White', size_cm: 60, cultivar: null, current_quantity: 5, date: '2026-05-10' };

  it('hides a Variety reserved down to effective ≤ 0 by default', () => {
    render(<VarietyAllocationPicker stockItems={[filler, lily]} reservations={new Map([['x', 5]])}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/Lily/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Tulip/).length).toBeGreaterThan(0);
  });

  it('reveals the hidden Variety when searched (deliberate over-promise — D3)', () => {
    render(<VarietyAllocationPicker stockItems={[filler, lily]} reservations={new Map([['x', 5]])}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'lily' } });
    expect(screen.getAllByTestId('variety-row')).toHaveLength(1);
  });

  it('surfaces a negative-stock Variety when incoming PO makes effective > 0 (CR-22 surplus)', () => {
    const peony = { id: 'p1', type_name: 'Peony', colour: 'Pink', size_cm: 50, cultivar: null, current_quantity: -7, date: '2026-05-13' };
    const pendingPO = { p1: { plannedDate: '2026-06-16', pos: [{ quantity: 10, plannedDate: '2026-06-16' }] } };
    render(<VarietyAllocationPicker stockItems={[filler, peony]} reservations={new Map()} pendingPO={pendingPO}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getAllByTestId('variety-row')).toHaveLength(2);
    expect(screen.getByTestId('avail-incoming').textContent).toContain('+10');
  });

  it('renders the labelled availability line on each visible row', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getAllByTestId('variety-availability').length).toBe(2);
  });
});

describe('VarietyAllocationPicker — allocation form (S3.2-ii)', () => {
  // Single Rose Pink 60 batch, no demand → the engine default is the batch.
  const oneBatch = [
    { id: 'b1', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null, current_quantity: 10, date: '2026-05-10' },
  ];

  it('a single Variety opens straight at the allocation form — no Stage-1 search (CR-24)', () => {
    render(<VarietyAllocationPicker stockItems={oneBatch} reservations={new Map()}
      requiredBy="2026-06-01" qty={4} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByPlaceholderText('Search…')).toBeNull();
    expect(screen.getByTestId('alloc-source')).toBeInTheDocument();
    expect(screen.getByTestId('alloc-qty')).toBeInTheDocument();
    expect(screen.getByTestId('alloc-add')).toBeInTheDocument();
  });

  it('multiple Varieties: Stage-1 search shows; tapping a row reveals the form', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    expect(screen.getByTestId('alloc-source')).toBeInTheDocument();
  });

  it('qty defaults to the order need; remaining = source available − qty (CR-25)', () => {
    render(<VarietyAllocationPicker stockItems={oneBatch} reservations={new Map()}
      requiredBy="2026-06-01" qty={4} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('alloc-qty').value).toBe('4');
    expect(screen.getByTestId('alloc-remaining').textContent).toContain('6'); // 10 - 4
  });

  it('changing qty updates the remaining counter live (CR-25)', () => {
    render(<VarietyAllocationPicker stockItems={oneBatch} reservations={new Map()}
      requiredBy="2026-06-01" qty={4} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('alloc-qty'), { target: { value: '7' } });
    expect(screen.getByTestId('alloc-remaining').textContent).toContain('3'); // 10 - 7
  });

  it('source dropdown surfaces "from incoming PO" when a PO is pending (CR-26)', () => {
    const peony = [{ id: 'p1', type_name: 'Peony', colour: 'Pink', size_cm: 50, cultivar: null, current_quantity: -7, date: '2026-05-13' }];
    const pendingPO = { p1: { plannedDate: '2026-06-16', pos: [{ quantity: 10, plannedDate: '2026-06-16' }] } };
    render(<VarietyAllocationPicker stockItems={peony} reservations={new Map()} pendingPO={pendingPO}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    const opts = [...screen.getByTestId('alloc-source').querySelectorAll('option')].map(o => o.value);
    expect(opts).toContain('incoming');
    expect(opts).toContain('fresh');
  });

  it('Add fires onSelectStock with the chosen stock row AND the typed amount (CR-25)', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={oneBatch} reservations={new Map()}
      requiredBy="2026-06-01" qty={4} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('alloc-qty'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('alloc-add'));
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 5);
  });

  it('Add with "New demand" fires kind:fresh + requiredBy + amount', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={oneBatch} reservations={new Map()}
      requiredBy="2026-06-01" qty={2} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('alloc-source'), { target: { value: 'fresh' } });
    fireEvent.click(screen.getByTestId('alloc-add'));
    expect(onSelectStock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'fresh', date: '2026-06-01' }),
      2,
    );
  });
});

describe('VarietyAllocationPicker — Create new Variety (Owner)', () => {
  it('expands inline 4-field form when clicked (Owner)', () => {
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}}
      onCreateVariety={vi.fn()} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    expect(screen.getByLabelText(/Type/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Colour/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Size/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Cultivar/)).toBeInTheDocument();
  });

  it('Save & continue calls onCreateVariety with the draft', async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: 'new-stock-id' });
    const onSelect = vi.fn();
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={onSelect} onClose={() => {}} onCreateVariety={onCreate} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Tulip' } });
    fireEvent.change(screen.getByLabelText(/Colour/), { target: { value: 'Yellow' } });
    fireEvent.click(screen.getByText(t.pickerSaveContinue || 'Save & continue'));
    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
        type_name: 'Tulip', colour: 'Yellow', size_cm: null, cultivar: null,
      }));
    });
  });

  it('Type is required — Save disabled with empty Type', () => {
    render(<VarietyAllocationPicker stockItems={[]} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="owner" t={t}
      onSelectStock={() => {}} onClose={() => {}} onCreateVariety={vi.fn()} />);
    fireEvent.click(screen.getByText('+ Create new Variety'));
    expect(screen.getByText(t.pickerSaveContinue || 'Save & continue')).toBeDisabled();
  });
});

describe('VarietyAllocationPicker — collapse Batch options by sell tier (2026-05-31)', () => {
  // Two Rose Pink 60 batches at the same sell price → ONE Batch option.
  // A third batch at a different sell price → its own Batch option (tier).
  const tieredRows = [
    { id: 'b1', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
      current_quantity: 10, date: '2026-05-10', current_sell_price: 25 },
    { id: 'b2', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
      current_quantity: 5,  date: '2026-05-12', current_sell_price: 25 },
    { id: 'b3', type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
      current_quantity: 7,  date: '2026-05-11', current_sell_price: 30 },
  ];
  const tT = { ...t, currency: 'zł', useStock: 'Use stock' };

  it('lists each sell tier as a source option (label carries the price)', () => {
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    const labels = [...screen.getByTestId('alloc-source').querySelectorAll('option')].map(o => o.textContent);
    expect(labels.some(l => l.includes('25.00 zł'))).toBe(true);
    expect(labels.some(l => l.includes('30.00 zł'))).toBe(true);
  });

  it('picking a sell tier + Add targets the FEFO-oldest underlying stock_id', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('alloc-source'), { target: { value: 'batch:25.00' } });
    fireEvent.click(screen.getByTestId('alloc-add'));
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), 1);
  });

  it('single tier renders one "From stock" option without a price label', () => {
    const oneTier = tieredRows.filter(r => r.current_sell_price === 25);
    render(<VarietyAllocationPicker stockItems={oneTier} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    const batchOpts = [...screen.getByTestId('alloc-source').querySelectorAll('option')]
      .filter(o => o.value.startsWith('batch:'));
    expect(batchOpts).toHaveLength(1);
    expect(batchOpts[0].textContent).not.toContain('zł');
  });

  it('tier source available is summed across underlying batches (FEFO)', () => {
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={5} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('alloc-source'), { target: { value: 'batch:25.00' } });
    // 10 + 5 = 15 free in the 25 zł tier; remaining = 15 − 5 = 10.
    expect(screen.getByTestId('alloc-remaining').textContent).toContain('10');
  });
});

describe('VarietyAllocationPicker — Order fresh for all', () => {
  it('renders "Order fresh for all" CTA when host passes bulkCandidates', () => {
    const onBulkFresh = vi.fn();
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}}
      bulkCandidates={['Rose|Pink|60|', 'Rose|White|70|Sarah Bernhardt']}
      onBulkFreshForAll={onBulkFresh} />);
    fireEvent.click(screen.getByText(t.pickerOrderFreshAll || 'Order fresh for all'));
    expect(onBulkFresh).toHaveBeenCalledWith(['Rose|Pink|60|', 'Rose|White|70|Sarah Bernhardt']);
  });

  it('CTA hidden when bulkCandidates is empty/undefined', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={1} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(t.pickerOrderFreshAll || 'Order fresh for all')).not.toBeInTheDocument();
  });
});
