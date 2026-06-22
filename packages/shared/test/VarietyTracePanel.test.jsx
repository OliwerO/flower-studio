// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyTracePanel from '../components/VarietyTracePanel.jsx';

const t = {
  traceTypeOrder: 'Order',
  traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase',
  traceTypePremade: 'Premade',
  traceEmpty: 'No history yet',
  stems: 'stems',
  unaccountedStems: 'Unaccounted',
};

describe('VarietyTracePanel', () => {
  it('renders all four event kinds', () => {
    const events = [
      { type: 'purchase', date: '2026-05-08', quantity: 30, supplier: 'Wholesale Co' },
      { type: 'order',    date: '2026-05-10', quantity: -5, orderId: '202605-1', customer: 'Anna' },
      { type: 'writeoff', date: '2026-05-09', quantity: -2, reason: 'Wilted' },
      { type: 'premade',  date: null,         quantity: -3, bouquetName: 'Spring Mix' },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    const kinds = screen.getAllByTestId('trace-row').map(r => r.getAttribute('data-trace-kind'));
    expect(kinds).toHaveLength(4);
    expect(new Set(kinds)).toEqual(new Set(['purchase', 'order', 'writeoff', 'premade']));
  });

  it('sorts events chronologically oldest → newest, undated last', () => {
    const events = [
      { type: 'order',    date: '2026-05-10', quantity: -5 },
      { type: 'premade',  date: null,         quantity: -3 },
      { type: 'purchase', date: '2026-05-08', quantity: 30 },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    const kinds = screen.getAllByTestId('trace-row').map(r => r.getAttribute('data-trace-kind'));
    expect(kinds).toEqual(['purchase', 'order', 'premade']);
  });

  it('empty events shows traceEmpty message', () => {
    render(<VarietyTracePanel events={[]} unaccountedStems={0} t={t} />);
    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });

  it('hides the unaccounted footer when unaccountedStems is 0', () => {
    const events = [{ type: 'purchase', date: '2026-05-08', quantity: 30 }];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    expect(screen.queryByTestId('unaccounted-footer')).not.toBeInTheDocument();
  });

  it('shows the unaccounted footer with signed count when non-zero', () => {
    const events = [{ type: 'purchase', date: '2026-05-08', quantity: 30 }];
    render(<VarietyTracePanel events={events} unaccountedStems={7} t={t} />);
    const footer = screen.getByTestId('unaccounted-footer');
    expect(footer).toHaveTextContent('Unaccounted');
    expect(footer).toHaveTextContent('+7 stems');
  });

  it('renders the unaccounted footer even with no events', () => {
    render(<VarietyTracePanel events={[]} unaccountedStems={-4} t={t} />);
    expect(screen.getByTestId('unaccounted-footer')).toHaveTextContent('-4 stems');
  });

  it('renders a balance sparkline when there is at least one dated event', () => {
    const events = [
      { type: 'purchase', qty: 25, date: '2026-06-18' },
      { type: 'order', qty: -30, date: '2026-06-20' },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={-5} t={{ stems: 'stems', traceBalance: 'Balance', traceTypeOrder: 'Order', traceTypePurchase: 'Purchase' }} />);
    expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
  });

  it('omits the sparkline when no event is dated', () => {
    render(<VarietyTracePanel events={[{ type: 'premade', qty: -6 }]} unaccountedStems={-6} t={{ stems: 'stems', traceTypePremade: 'Premade' }} />);
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
  });

  it('fires onOrderClick with the order record id when an order row is tapped', () => {
    const onOrderClick = vi.fn();
    const events = [{ type: 'order', qty: -7, orderId: '202606-020', orderRecordId: 'rec_abc', customer: 'Caden', date: '2026-06-22' }];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={{ stems: 'stems', traceTypeOrder: 'Order' }} onOrderClick={onOrderClick} />);
    fireEvent.click(screen.getByTestId('trace-row'));
    expect(onOrderClick).toHaveBeenCalledWith('rec_abc', expect.objectContaining({ orderId: '202606-020' }));
  });

  it('does not make order rows clickable without onOrderClick', () => {
    const events = [{ type: 'order', qty: -7, orderId: '202606-020', orderRecordId: 'rec_abc', date: '2026-06-22' }];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={{ stems: 'stems', traceTypeOrder: 'Order' }} />);
    const row = screen.getByTestId('trace-row');
    expect(row.tagName).toBe('LI'); // plain list item, not a button
  });
});
