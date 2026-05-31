// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WriteOffBatchPicker from '../components/WriteOffBatchPicker.jsx';

const t = {
  writeOffPickerTitle: 'Write off stems',
  writeOffQty: 'Quantity',
  writeOffReason: 'Reason',
  writeOffBatch: 'Tier',
  writeOffConfirm: 'Confirm',
  cancel: 'Cancel',
  stems: 'stems',
  currency: 'zł',
};

// Two sell tiers: 25 zł (b1 + b2 merged, total 15) and 30 zł (b3, 7).
const variety = {
  key: 'Rose|Pink|60|',
  type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
  rows: [
    { id: 'b2', current_quantity: 5,  date: '2026-05-12', current_sell_price: 25 },
    { id: 'b1', current_quantity: 10, date: '2026-05-10', current_sell_price: 25 },
    { id: 'b3', current_quantity: 7,  date: '2026-05-11', current_sell_price: 30 },
    { id: 'd1', current_quantity: -3, date: '2026-05-12' },  // Demand entry — excluded
  ],
};

const REASONS = [
  { value: 'wilted', label: 'Wilted' },
  { value: 'damaged', label: 'Damaged' },
];

describe('WriteOffBatchPicker (merge-by-sell tier)', () => {
  it('renders one tier option per sell price; Demand Entries excluded', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const opts = screen.getAllByTestId('writeoff-batch-option');
    expect(opts).toHaveLength(2);
    // Tier chips reference all underlying ids in FEFO order via data-stock-ids.
    const idsByTier = opts.map(o => o.getAttribute('data-stock-ids'));
    expect(idsByTier).toContain('b1,b2'); // 25 zł tier, FEFO oldest first
    expect(idsByTier).toContain('b3');    // 30 zł tier
  });

  it('selects cheapest tier as default', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const selected = screen.getByTestId('writeoff-batch-option-selected');
    expect(selected).toHaveAttribute('data-tier-key', '25.00');
  });

  it('Owner can switch to a different tier', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    const opts = screen.getAllByTestId('writeoff-batch-option');
    // Sorted by sell asc, opts[1] = 30 zł tier
    fireEvent.click(opts[1]);
    expect(screen.getByTestId('writeoff-batch-option-selected'))
      .toHaveAttribute('data-tier-key', '30.00');
  });

  it('confirm fires onConfirm with { stockIds (FEFO), qty, reason }', () => {
    const onConfirm = vi.fn();
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'wilted' } });
    fireEvent.click(screen.getByText('Confirm'));
    // 25 zł tier selected by default; b1 (older) before b2.
    expect(onConfirm).toHaveBeenCalledWith({ stockIds: ['b1', 'b2'], qty: 3, reason: 'wilted' });
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

  it('Confirm disabled when qty exceeds tier totalQty', () => {
    render(<WriteOffBatchPicker variety={variety} reasons={REASONS} t={t}
      onConfirm={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'wilted' } });
    // 25 zł tier total = 15. 15 OK, 16 not.
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '15' } });
    expect(screen.getByText('Confirm')).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '16' } });
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
