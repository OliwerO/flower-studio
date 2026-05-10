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
