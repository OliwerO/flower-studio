// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchTracePanel from '../components/BatchTracePanel.jsx';

const t = {
  traceTypeOrder: 'Order',
  traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase',
  traceTypePremade: 'Premade',
  traceEmpty: 'No history yet',
  stems: 'stems',
};

describe('BatchTracePanel', () => {
  it('renders one row per trail event with type, date, qty', () => {
    const trail = [
      { type: 'order', date: '2026-05-10', qty: 5, customer: 'Anna' },
      { type: 'writeoff', date: '2026-05-09', qty: 2, reason: 'Wilted' },
      { type: 'purchase', date: '2026-05-08', qty: 30, supplier: 'Wholesale Co' },
      { type: 'premade', date: '2026-05-07', qty: 3, bouquetName: 'Spring Mix' },
    ];
    render(<BatchTracePanel trail={trail} t={t} />);
    expect(screen.getAllByTestId('trace-row')).toHaveLength(4);
  });

  it('order row shows customer name', () => {
    const trail = [{ type: 'order', date: '2026-05-10', qty: 5, customer: 'Anna' }];
    render(<BatchTracePanel trail={trail} t={t} />);
    // Scope to the trace row — the balance graph now also labels the event (CR-18).
    expect(screen.getByTestId('trace-row')).toHaveTextContent('Anna');
  });

  it('writeoff row shows reason', () => {
    const trail = [{ type: 'writeoff', date: '2026-05-09', qty: 2, reason: 'Wilted' }];
    render(<BatchTracePanel trail={trail} t={t} />);
    expect(screen.getByTestId('trace-row')).toHaveTextContent('Wilted');
  });

  it('empty trail shows traceEmpty message', () => {
    render(<BatchTracePanel trail={[]} t={t} />);
    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });

  it('row carries data-trace-kind attribute matching event type', () => {
    const trail = [
      { type: 'order',    date: '2026-05-10', qty: 5 },
      { type: 'writeoff', date: '2026-05-09', qty: 2 },
    ];
    render(<BatchTracePanel trail={trail} t={t} />);
    const rows = screen.getAllByTestId('trace-row');
    // Sorted chronologically oldest → newest, so the 05-09 writeoff precedes
    // the 05-10 order regardless of input order.
    expect(rows[0]).toHaveAttribute('data-trace-kind', 'writeoff');
    expect(rows[1]).toHaveAttribute('data-trace-kind', 'order');
  });

  it('sorts events chronologically oldest → newest, undated last', () => {
    const trail = [
      { type: 'order',    date: '2026-05-10', qty: 5 },
      { type: 'premade',  date: null,         qty: 3 },
      { type: 'purchase', date: '2026-05-08', qty: 30 },
    ];
    render(<BatchTracePanel trail={trail} t={t} />);
    const kinds = screen.getAllByTestId('trace-row').map(r => r.getAttribute('data-trace-kind'));
    expect(kinds).toEqual(['purchase', 'order', 'premade']);
  });

  it('graph is OFF by default (traceability first); the toggle reveals/hides it', () => {
    const trail = [
      { type: 'purchase', date: '2026-05-08', qty: 30 },
      { type: 'order',    date: '2026-05-10', qty: -5, customer: 'Anna' },
    ];
    render(<BatchTracePanel trail={trail} t={{ ...t, showGraph: 'Show graph', hideGraph: 'Hide graph' }} />);
    // List shown immediately, graph is NOT.
    expect(screen.getAllByTestId('trace-row').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
    // Reveal on demand.
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
    // Hide again.
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
  });

  it('fires onOrderClick with the order record id when an order row is tapped', () => {
    const onOrderClick = vi.fn();
    const trail = [{ type: 'order', date: '2026-05-10', qty: -5, orderId: '202605-1', orderRecordId: 'rec_9', customer: 'Anna' }];
    render(<BatchTracePanel trail={trail} t={t} onOrderClick={onOrderClick} />);
    fireEvent.click(screen.getByTestId('trace-row'));
    expect(onOrderClick).toHaveBeenCalledWith('rec_9', expect.objectContaining({ orderId: '202605-1' }));
  });

  it('order row is not clickable without onOrderClick or without orderRecordId', () => {
    const { rerender } = render(<BatchTracePanel trail={[{ type: 'order', date: '2026-05-10', qty: -5, orderRecordId: 'rec_9' }]} t={t} />);
    expect(screen.getByTestId('trace-row').getAttribute('role')).not.toBe('button'); // no handler
    rerender(<BatchTracePanel trail={[{ type: 'order', date: '2026-05-10', qty: -5 }]} t={t} onOrderClick={() => {}} />);
    expect(screen.getByTestId('trace-row').getAttribute('role')).not.toBe('button'); // no record id
  });
});
