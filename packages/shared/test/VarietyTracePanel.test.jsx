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
  traceFirstPo: 'First PO',
  traceFirstDemand: 'First demand',
};

describe('VarietyTracePanel — B2 opening balance', () => {
  const evs = [
    { type: 'order', date: '2026-06-03', quantity: -5, orderId: '1', customer: 'A' },
    { type: 'writeoff', date: '2026-06-03', quantity: -1, reason: 'Wilted' },
    { type: 'purchase', date: '2026-06-05', quantity: 30, supplier: 'X' },
  ];
  it('renders an opening-balance row when openingBalance > 0', () => {
    render(<VarietyTracePanel events={evs} openingBalance={6} t={{ ...t, traceOpening: 'Opening' }} />);
    const row = screen.getByTestId('opening-row');
    expect(row).toHaveTextContent('Opening');
    expect(row).toHaveTextContent('+6 stems');
  });
  it('omits the opening-balance row when openingBalance is 0', () => {
    render(<VarietyTracePanel events={evs} openingBalance={0} t={t} />);
    expect(screen.queryByTestId('opening-row')).not.toBeInTheDocument();
  });
  it('B3: the unaccounted footer includes an explanatory hint', () => {
    render(<VarietyTracePanel events={evs} drift={6} t={{ ...t, unaccountedHint: 'from before the switch' }} />);
    expect(screen.getByTestId('unaccounted-footer')).toHaveTextContent('from before the switch');
  });
});

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

  it('shows the unaccounted footer with drift count when drift > 0', () => {
    const events = [{ type: 'purchase', date: '2026-05-08', quantity: 30 }];
    render(<VarietyTracePanel events={events} unaccountedStems={30} drift={7} t={t} />);
    const footer = screen.getByTestId('unaccounted-footer');
    expect(footer).toHaveTextContent('Unaccounted');
    expect(footer).toHaveTextContent('+7 stems');
  });

  it('hides the footer when drift is 0 (even with unaccountedStems > 0)', () => {
    // Footer is driven by drift, not unaccountedStems — drift=0 means reconciled.
    render(<VarietyTracePanel events={[]} unaccountedStems={-4} drift={0} t={t} />);
    expect(screen.queryByTestId('unaccounted-footer')).not.toBeInTheDocument();
  });

  it('CR-12: graph is hidden by default; row expansion shows the orders list, the toggle reveals/hides the sparkline', () => {
    const events = [
      { type: 'purchase', qty: 25, date: '2026-06-18' },
      { type: 'order', qty: -30, date: '2026-06-20', orderId: '202606-1', customer: 'Ann' },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={-5} t={t} />);
    // List is shown immediately; graph is NOT (the owner clicks to see orders, not the graph).
    expect(screen.getAllByTestId('trace-row').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
    // Reveal on demand.
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
    // Hide again.
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
  });

  it('omits the sparkline (and shows no graph toggle) when there are no events', () => {
    render(<VarietyTracePanel events={[]} unaccountedStems={0} t={t} />);
    expect(screen.queryByTestId('trace-sparkline')).toBeNull();
    expect(screen.queryByTestId('trace-graph-toggle')).toBeNull();
  });

  it('graph toggle shows even when the only event is undated, but the sparkline stays empty', () => {
    render(<VarietyTracePanel events={[{ type: 'premade', qty: -6 }]} unaccountedStems={-6} t={{ ...t, traceTypePremade: 'Premade' }} />);
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    expect(screen.queryByTestId('trace-sparkline')).toBeNull(); // BalanceSparkline returns null with no dated events
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

  it('renders traceFirstPo pill on a purchase event with firstPo flag', () => {
    const events = [
      { type: 'purchase', date: '2026-05-01', quantity: 20, firstPo: true },
      { type: 'purchase', date: '2026-05-10', quantity: 15 },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    expect(screen.getByText('First PO')).toBeInTheDocument();
    // Only one "First PO" pill
    expect(screen.getAllByText('First PO')).toHaveLength(1);
  });

  it('renders traceFirstDemand pill on an order event with firstDemand flag', () => {
    const events = [
      { type: 'order', date: '2026-05-03', quantity: -3, firstDemand: true },
      { type: 'order', date: '2026-05-12', quantity: -5 },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    expect(screen.getByText('First demand')).toBeInTheDocument();
    expect(screen.getAllByText('First demand')).toHaveLength(1);
  });

  it('balance sparkline is unaffected by firstPo and firstDemand flags', () => {
    // Events with flags — should produce same balance as without
    const eventsWithFlags = [
      { type: 'purchase', date: '2026-05-01', qty: 20, firstPo: true },
      { type: 'order',    date: '2026-05-05', qty: -8, firstDemand: true },
    ];
    const eventsWithout = [
      { type: 'purchase', date: '2026-05-01', qty: 20 },
      { type: 'order',    date: '2026-05-05', qty: -8 },
    ];
    const { unmount } = render(<VarietyTracePanel events={eventsWithFlags} unaccountedStems={12} t={t} />);
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    const sparklineWith = screen.getByTestId('trace-sparkline');
    const balanceTextWith = sparklineWith.textContent;
    unmount();

    render(<VarietyTracePanel events={eventsWithout} unaccountedStems={12} t={t} />);
    fireEvent.click(screen.getByTestId('trace-graph-toggle'));
    const sparklineWithout = screen.getByTestId('trace-sparkline');
    const balanceTextWithout = sparklineWithout.textContent;

    // Final balance label should be identical
    expect(balanceTextWith).toBe(balanceTextWithout);
  });

  it('does not render any marker pill when no flags are set', () => {
    const events = [
      { type: 'purchase', date: '2026-05-01', quantity: 20 },
      { type: 'order',    date: '2026-05-05', quantity: -8 },
    ];
    render(<VarietyTracePanel events={events} unaccountedStems={0} t={t} />);
    expect(screen.queryByText('First PO')).not.toBeInTheDocument();
    expect(screen.queryByText('First demand')).not.toBeInTheDocument();
  });
});

describe('VarietyTracePanel — S6 drift-driven footer', () => {
  it('hides the footer when drift is 0 even if unaccountedStems is large', () => {
    // e.g. healthy Rose Red: unaccountedStems=4 but drift=0 (on-hand=4)
    const events = [{ type: 'purchase', date: '2026-05-01', quantity: 40 }];
    render(<VarietyTracePanel events={events} unaccountedStems={4} drift={0} t={t} />);
    expect(screen.queryByTestId('unaccounted-footer')).not.toBeInTheDocument();
  });

  it('hides the footer when drift is negative (more physical stock than events explain)', () => {
    // opening balance scenario: drift < 0 — not actionable
    const events = [{ type: 'purchase', date: '2026-05-01', quantity: 10 }];
    render(<VarietyTracePanel events={events} unaccountedStems={-5} drift={-5} t={t} />);
    expect(screen.queryByTestId('unaccounted-footer')).not.toBeInTheDocument();
  });

  it('shows the footer with the drift value when drift > 0', () => {
    // Iris Purple 50: purchase+30, on-hand=20, drift=10
    const events = [{ type: 'purchase', date: '2026-06-01', quantity: 30 }];
    render(<VarietyTracePanel events={events} unaccountedStems={30} drift={10} t={t} />);
    const footer = screen.getByTestId('unaccounted-footer');
    expect(footer).toHaveTextContent('Unaccounted');
    expect(footer).toHaveTextContent('+10 stems');
  });

  it('drift defaults to 0 so footer is hidden when prop is omitted', () => {
    const events = [{ type: 'purchase', date: '2026-05-01', quantity: 20 }];
    render(<VarietyTracePanel events={events} unaccountedStems={20} t={t} />);
    expect(screen.queryByTestId('unaccounted-footer')).not.toBeInTheDocument();
  });
});
