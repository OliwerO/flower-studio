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
    expect(screen.getByText(/Sarah Bernhardt/)).toBeInTheDocument();
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
    expect(onSelectStock).toHaveBeenCalledWith({ kind: 'fresh', date: '2026-05-12' });
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
