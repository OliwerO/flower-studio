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
  it('renders Variety display (drops Type since under TypeGroupHeader): "Pink 60cm"', () => {
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Pink 60cm/)).toBeInTheDocument();
    expect(screen.queryByText('Rose')).not.toBeInTheDocument();
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

  it('shows one nested row per Stock Item when expanded', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.getAllByTestId('stock-item-row')).toHaveLength(3);
  });

  it('hides nested rows when collapsed', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.queryAllByTestId('stock-item-row')).toHaveLength(0);
  });

  it('row label includes (date) suffix per ADR-0006', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    expect(screen.getByText(/2026-05-10/)).toBeInTheDocument();
  });

  it('Demand Entry rows are visually distinct (data-row-kind="demand")', () => {
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} />);
    const rows = screen.getAllByTestId('stock-item-row');
    const kinds = rows.map(r => r.getAttribute('data-row-kind'));
    expect(kinds.filter(k => k === 'batch')).toHaveLength(2);
    expect(kinds.filter(k => k === 'demand')).toHaveLength(1);
  });

  it('clicking a Batch row fires onBatchClick(stockItemId)', () => {
    const onBatchClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onBatchClick={onBatchClick} />);
    const batches = screen.getAllByTestId('stock-item-row').filter(r => r.getAttribute('data-row-kind') === 'batch');
    fireEvent.click(batches[0]);
    expect(onBatchClick).toHaveBeenCalledWith('b1');
  });

  it('clicking a Demand Entry row does NOT fire onBatchClick', () => {
    const onBatchClick = vi.fn();
    render(<VarietyListItem variety={v} reservations={new Map()} t={t}
      hideType={true} expanded={true} onToggle={() => {}} onBatchClick={onBatchClick} />);
    const demand = screen.getAllByTestId('stock-item-row').find(r => r.getAttribute('data-row-kind') === 'demand');
    fireEvent.click(demand);
    expect(onBatchClick).not.toHaveBeenCalled();
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
