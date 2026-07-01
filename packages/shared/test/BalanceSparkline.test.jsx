// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BalanceSparkline from '../components/BalanceSparkline.jsx';

const t = {
  stems: 'stems',
  traceBalance: 'Balance',
  traceTypeOrder: 'Order',
  traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase',
  traceTypePremade: 'Premade',
  traceTypeDissolve: 'Dissolved',
};

const basicEvents = [
  { type: 'purchase', date: '2026-05-01', quantity: 30, supplier: 'Wholesale' },
  { type: 'order',    date: '2026-05-05', quantity: -10, orderId: '202605-001', customer: 'Anna', orderRecordId: 'rec_001' },
  { type: 'order',    date: '2026-05-10', quantity: -5,  orderId: '202605-002', customer: 'Bob',  orderRecordId: 'rec_002' },
];

// Parse SVG path "d" attribute into coordinate pairs [x, y]
function parsePath(d) {
  const coords = [];
  const parts = d.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (tok === 'M' || tok === 'L') {
      const x = parseFloat(parts[i + 1]);
      const y = parseFloat(parts[i + 2]);
      coords.push({ x, y });
      i += 2;
    }
  }
  return coords;
}

describe('BalanceSparkline — B2 opening balance', () => {
  // Orders before the first purchase → without opening the balance dives to −24.
  const negFirst = [
    { type: 'order',    date: '2026-06-03', quantity: -5,  orderId: 'o1', customer: 'A' },
    { type: 'writeoff', date: '2026-06-03', quantity: -1,  reason: 'Wilted' },
    { type: 'order',    date: '2026-06-04', quantity: -7,  orderId: 'o2', customer: 'B' },
    { type: 'purchase', date: '2026-06-05', quantity: 30,  supplier: 'X' },
  ];
  it('renders the opening marker + label when opening > 0', () => {
    render(<BalanceSparkline events={negFirst} t={{ ...t, traceOpening: 'opening' }} opening={13} />);
    expect(screen.getByTestId('opening-marker')).toBeInTheDocument();
  });
  it('no opening marker when opening is 0', () => {
    render(<BalanceSparkline events={negFirst} t={t} opening={0} />);
    expect(screen.queryByTestId('opening-marker')).not.toBeInTheDocument();
  });
  it('with opening, the running balance never falls below 0 (no negative y-floor label)', () => {
    // opening=13 lifts the −13 trough to exactly 0 → min is 0, so no red y-label-min.
    render(<BalanceSparkline events={negFirst} t={t} opening={13} />);
    expect(screen.queryByTestId('y-label-min')).not.toBeInTheDocument();
  });
});

describe('BalanceSparkline — staircase shape', () => {
  it('returns null for no events', () => {
    const { container } = render(<BalanceSparkline events={[]} t={t} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for events with no dates', () => {
    const { container } = render(
      <BalanceSparkline events={[{ type: 'premade', quantity: -3 }]} t={t} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a single-event chart gracefully (flat line)', () => {
    render(<BalanceSparkline events={[{ type: 'purchase', date: '2026-05-01', quantity: 20 }]} t={t} />);
    expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
    const path = document.querySelector('path');
    expect(path).not.toBeNull();
  });

  it('path contains vertical segments (staircase jumps)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const path = document.querySelector('path');
    const coords = parsePath(path.getAttribute('d'));

    // A vertical segment = two consecutive coords with same x, different y
    let hasVertical = false;
    for (let i = 1; i < coords.length; i++) {
      if (
        Math.abs(coords[i].x - coords[i - 1].x) < 0.1 &&
        Math.abs(coords[i].y - coords[i - 1].y) > 0.1
      ) {
        hasVertical = true;
        break;
      }
    }
    expect(hasVertical).toBe(true);
  });

  it('path contains horizontal segments (hold between events)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const path = document.querySelector('path');
    const coords = parsePath(path.getAttribute('d'));

    let hasHorizontal = false;
    for (let i = 1; i < coords.length; i++) {
      if (
        Math.abs(coords[i].y - coords[i - 1].y) < 0.1 &&
        Math.abs(coords[i].x - coords[i - 1].x) > 0.1
      ) {
        hasHorizontal = true;
        break;
      }
    }
    expect(hasHorizontal).toBe(true);
  });
});

describe('BalanceSparkline — zero line', () => {
  it('renders zero line even when all balances are positive', () => {
    const positiveOnly = [
      { type: 'purchase', date: '2026-05-01', quantity: 30 },
      { type: 'purchase', date: '2026-05-05', quantity: 10 },
    ];
    render(<BalanceSparkline events={positiveOnly} t={t} />);
    expect(screen.getByTestId('zero-line')).toBeInTheDocument();
  });

  it('renders zero line when balances go negative', () => {
    const mixed = [
      { type: 'purchase', date: '2026-05-01', quantity: 5 },
      { type: 'order',    date: '2026-05-05', quantity: -10 },
    ];
    render(<BalanceSparkline events={mixed} t={t} />);
    expect(screen.getByTestId('zero-line')).toBeInTheDocument();
  });
});

describe('BalanceSparkline — markers', () => {
  it('renders one marker per dated event', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const markers = screen.getAllByTestId(/^marker-/);
    expect(markers).toHaveLength(basicEvents.length);
  });

  it('purchase marker is green', () => {
    render(<BalanceSparkline events={[{ type: 'purchase', date: '2026-05-01', quantity: 20 }]} t={t} />);
    const marker = screen.getByTestId('marker-purchase');
    expect(marker.getAttribute('fill')).toBe('#10b981');
  });

  it('order marker (negative qty) is red', () => {
    render(<BalanceSparkline events={[{ type: 'order', date: '2026-05-05', quantity: -5, orderRecordId: 'r1' }]} t={t} />);
    const marker = screen.getByTestId('marker-order');
    expect(marker.getAttribute('fill')).toBe('#ef4444');
  });

  it('dissolve marker is gray', () => {
    render(<BalanceSparkline events={[{ type: 'dissolve', date: '2026-05-07', quantity: 0, releasedQty: 3 }]} t={t} />);
    const marker = screen.getByTestId('marker-dissolve');
    expect(marker.getAttribute('fill')).toBe('#9ca3af');
  });

  it('undated events produce no markers', () => {
    render(<BalanceSparkline events={[
      { type: 'purchase', date: '2026-05-01', quantity: 20 },
      { type: 'premade',  date: null,         quantity: -3 },
    ]} t={t} />);
    const markers = screen.getAllByTestId(/^marker-/);
    expect(markers).toHaveLength(1); // only the purchase
  });
});

describe('BalanceSparkline — axis labels', () => {
  it('renders a y-label for 0', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByTestId('y-label-zero')).toBeInTheDocument();
    expect(screen.getByTestId('y-label-zero')).toHaveTextContent('0');
  });

  it('renders a y-label for the max balance', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const maxLabel = screen.getByTestId('y-label-max');
    expect(maxLabel).toBeInTheDocument();
    // max after events: purchase(30) → order(-10) → order(-5) → max is 30
    expect(maxLabel.textContent).toContain('30');
  });

  it('renders x-tick for first date (DD.MM format)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const firstTick = screen.getByTestId('x-tick-2026-05-01');
    expect(firstTick).toBeInTheDocument();
    expect(firstTick.textContent).toBe('01.05');
  });

  it('renders x-tick for last date', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const lastTick = screen.getByTestId('x-tick-2026-05-10');
    expect(lastTick).toBeInTheDocument();
    expect(lastTick.textContent).toBe('10.05');
  });
});

describe('BalanceSparkline — interactivity', () => {
  it('calls onOrderClick with orderRecordId when an order marker is clicked', () => {
    const onOrderClick = vi.fn();
    render(<BalanceSparkline events={basicEvents} t={t} onOrderClick={onOrderClick} />);
    const orderMarkers = screen.getAllByTestId('marker-order');
    fireEvent.click(orderMarkers[0]);
    expect(onOrderClick).toHaveBeenCalledWith('rec_001', expect.objectContaining({ orderId: '202605-001' }));
  });

  it('does not call onOrderClick when a purchase marker is clicked', () => {
    const onOrderClick = vi.fn();
    render(<BalanceSparkline events={basicEvents} t={t} onOrderClick={onOrderClick} />);
    const purchaseMarker = screen.getByTestId('marker-purchase');
    fireEvent.click(purchaseMarker);
    expect(onOrderClick).not.toHaveBeenCalled();
  });

  it('order marker without onOrderClick is not a button', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    const orderMarkers = screen.getAllByTestId('marker-order');
    orderMarkers.forEach((m) => {
      expect(m.getAttribute('role')).not.toBe('button');
    });
  });

  it('order marker with onOrderClick has role=button', () => {
    const onOrderClick = vi.fn();
    render(<BalanceSparkline events={basicEvents} t={t} onOrderClick={onOrderClick} />);
    const orderMarkers = screen.getAllByTestId('marker-order');
    orderMarkers.forEach((m) => {
      expect(m.getAttribute('role')).toBe('button');
    });
  });

  it('order marker without orderRecordId is not clickable', () => {
    const onOrderClick = vi.fn();
    const noRecId = [{ type: 'order', date: '2026-05-05', quantity: -5, orderId: '202605-001' }];
    render(<BalanceSparkline events={noRecId} t={t} onOrderClick={onOrderClick} />);
    const orderMarker = screen.getByTestId('marker-order');
    expect(orderMarker.getAttribute('role')).not.toBe('button');
    fireEvent.click(orderMarker);
    expect(onOrderClick).not.toHaveBeenCalled();
  });
});

describe('BalanceSparkline — data-testid preserved', () => {
  it('root element has data-testid="trace-sparkline"', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByTestId('trace-sparkline')).toBeInTheDocument();
  });
});

describe('BalanceSparkline — CR-18 on-chart legibility', () => {
  it('shows the running balance after each step as a visible text node (not just hover)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByText('30')).toBeInTheDocument(); // after purchase
    expect(screen.getByText('20')).toBeInTheDocument(); // after -10
    expect(screen.getByText('15')).toBeInTheDocument(); // after -5
  });

  it('shows the signed delta at each consuming event', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByText('-10')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
  });

  it('shows a short identity for order events (customer name)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders a colour legend (in / out)', () => {
    render(<BalanceSparkline events={basicEvents} t={t} />);
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(screen.getByText('out')).toBeInTheDocument();
  });

  it('renders a negative-floor y-label when the balance goes below zero', () => {
    const events = [
      { type: 'purchase', date: '2026-05-01', quantity: 5 },
      { type: 'order',    date: '2026-05-05', quantity: -12, orderRecordId: 'r1' },
    ];
    render(<BalanceSparkline events={events} t={t} />);
    expect(screen.getByTestId('y-label-min')).toHaveTextContent('-7');
  });
});
