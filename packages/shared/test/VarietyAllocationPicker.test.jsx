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

describe('VarietyAllocationPicker — Stage 2 allocation panel', () => {
  it('renders engine options when a Variety row is expanded', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    expect(screen.getByTestId('option-batch')).toBeInTheDocument();
    expect(screen.getByTestId('option-merge')).toBeInTheDocument();
    expect(screen.getByTestId('option-fresh')).toBeInTheDocument();
  });

  it('marks default option per smart-default rule (same-date Demand Entry)', () => {
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    expect(screen.getByTestId('option-merge')).toHaveAttribute('data-default', 'true');
  });

  it('shows free/total/reserved breakdown per Batch', () => {
    const reservations = new Map([['b1', 4]]);
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={reservations}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const batch = screen.getByTestId('option-batch');
    expect(batch).toHaveTextContent('6');  // freeQty = 10 - 4
    expect(batch).toHaveTextContent('10'); // total
    expect(batch).toHaveTextContent('4');  // reservedQty
  });

  it('clicking a Batch option calls onSelectStock with the row', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    fireEvent.click(screen.getByTestId('option-batch'));
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('clicking fresh fires onSelectStock with kind:fresh + requiredBy', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={makeRows()} reservations={new Map()}
      requiredBy="2026-05-12" qty={2} role="florist" t={t}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    fireEvent.click(screen.getByTestId('option-fresh'));
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'fresh',
      date: '2026-05-12',
      variety: expect.objectContaining({ type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null }),
    }));
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

  it('two batches at same sell price collapse into one tier row', () => {
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const batches = screen.getAllByTestId('option-batch');
    expect(batches).toHaveLength(2);
    // FEFO ordering inside the 25 zł tier: b1 (May 10) before b2 (May 12).
    const ids = batches.map(b => b.getAttribute('data-stock-ids'));
    expect(ids).toContain('b1,b2');
    expect(ids).toContain('b3');
  });

  it('renders sell-price label on each tier when multiple tiers exist', () => {
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const batches = screen.getAllByTestId('option-batch');
    const labels = batches.map(b => b.textContent);
    expect(labels.some(l => l.includes('25.00 zł'))).toBe(true);
    expect(labels.some(l => l.includes('30.00 zł'))).toBe(true);
  });

  it('hides sell-price label when only one tier exists (renders "Use stock")', () => {
    const oneTier = tieredRows.filter(r => r.current_sell_price === 25);
    render(<VarietyAllocationPicker stockItems={oneTier} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const batch = screen.getByTestId('option-batch');
    expect(batch).toHaveTextContent('Use stock');
    expect(batch).not.toHaveTextContent('zł');
  });

  it('clicking a tier targets the FEFO-oldest underlying stock_id', () => {
    const onSelectStock = vi.fn();
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={onSelectStock} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    // Pick the 25 zł tier (b1+b2). Oldest = b1.
    const tier25 = screen.getAllByTestId('option-batch')
      .find(b => b.getAttribute('data-stock-ids') === 'b1,b2');
    fireEvent.click(tier25);
    expect(onSelectStock).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('tier freeQty is summed across underlying batches', () => {
    render(<VarietyAllocationPicker stockItems={tieredRows} reservations={new Map()}
      requiredBy="2026-05-15" qty={1} role="florist" t={tT}
      onSelectStock={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTestId('variety-row')[0]);
    const tier25 = screen.getAllByTestId('option-batch')
      .find(b => b.getAttribute('data-stock-ids') === 'b1,b2');
    // 10 + 5 = 15 free, 15 total.
    expect(tier25).toHaveTextContent('15');
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
