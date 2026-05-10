// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WriteOffBatchPicker from '../components/WriteOffBatchPicker.jsx';

const t = {
  writeOffPickerTitle: 'Write off stems',
  writeOffQty: 'Quantity',
  writeOffReason: 'Reason',
  writeOffBatch: 'Batch',
  writeOffConfirm: 'Confirm',
  cancel: 'Cancel',
  stems: 'stems',
};

const variety = {
  key: 'Rose|Pink|60|',
  type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
  rows: [
    { id: 'b2', current_quantity: 5,  date: '2026-05-12' },  // Newer batch
    { id: 'b1', current_quantity: 10, date: '2026-05-10' },  // Oldest batch
    { id: 'd1', current_quantity: -3, date: '2026-05-12' },  // Demand entry — excluded
  ],
};

const REASONS = [
  { value: 'wilted', label: 'Wilted' },
  { value: 'damaged', label: 'Damaged' },
];

describe('WriteOffBatchPicker', () => {
  it('renders Batch options only (Demand Entries excluded)', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const opts = screen.getAllByTestId('writeoff-batch-option');
    expect(opts).toHaveLength(2);
    expect(screen.queryByText(/d1/)).not.toBeInTheDocument();
  });

  it('selects oldest Batch by date as default', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const selected = screen.getByTestId('writeoff-batch-option-selected');
    expect(selected).toHaveAttribute('data-stock-id', 'b1');
  });

  it('Owner can override the default Batch', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const opts = screen.getAllByTestId('writeoff-batch-option');
    fireEvent.click(opts[1]);  // After sort by date asc, opts[1] = newer batch (b2)
    expect(screen.getByTestId('writeoff-batch-option-selected'))
      .toHaveAttribute('data-stock-id', 'b2');
  });

  it('confirm fires onConfirm with { stockId, qty, reason }', () => {
    const onConfirm = vi.fn();
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'wilted' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledWith({ stockId: 'b1', qty: 3, reason: 'wilted' });
  });

  it('Confirm disabled until qty > 0 AND reason selected', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Confirm')).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '3' } });
    expect(screen.getByText('Confirm')).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'wilted' } });
    expect(screen.getByText('Confirm')).not.toBeDisabled();
  });

  it('Confirm disabled when qty exceeds selected Batch.current_quantity', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'wilted' } });
    // b1 has qty 10 → 10 is OK
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '10' } });
    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '11' } });
    expect(screen.getByText('Confirm')).toBeDisabled();
  });

  it('Cancel button fires onCancel', () => {
    const onCancel = vi.fn();
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });
});
