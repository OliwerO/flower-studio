import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import useDeliveryPricingPatch from '../hooks/useDeliveryPricingPatch.js';
import DeliveryPricingFields from '../components/DeliveryPricingFields.jsx';

const t = {
  deliveryFee: 'Delivery fee', deliveryCost: 'Delivery cost', deliveryMargin: 'Delivery margin',
  zl: 'zł', feeBelowCostWarning: 'Fee is below cost',
};

// Faithful reproduction of OrderDetailPanel's real wiring: `order` starts
// null (async fetch in flight) and DeliveryPricingFields only ever renders
// once `order.delivery` exists — exactly the `isDelivery && o.delivery &&
// (<DeliveryPricingFields value={deliveryPricing.value} .../>)` gate in
// apps/dashboard/src/components/OrderDetailPanel.jsx.
function Harness({ order, apiClient, onCommit }) {
  const deliveryPricing = useDeliveryPricingPatch(
    {
      fee: order?.delivery?.['Delivery Fee'] ?? null,
      cost: order?.delivery?.['Driver Payout'] ?? null,
      distanceKm: order?.delivery?.['Distance (km)'] ?? null,
      band: order?.delivery?.['Distance Band'] ?? null,
    },
    onCommit,
  );

  return order?.delivery ? (
    <DeliveryPricingFields
      address={order.delivery['Delivery Address']}
      deliveryMethod={order.delivery['Delivery Method'] || 'Driver'}
      value={deliveryPricing.value}
      onChange={deliveryPricing.onChange}
      apiClient={apiClient}
      t={t}
    />
  ) : null;
}

describe('useDeliveryPricingPatch + DeliveryPricingFields — async order-arrival integration', () => {
  // Regression test for a Critical bug found in review: opening an existing
  // delivery order with an ALREADY-KNOWN stored cost was firing a live
  // re-quote and silently PATCHing a fabricated cost/distance/band over the
  // real stored value the moment the panel's async order fetch resolved.
  // Root cause: DeliveryPricingFields seeds a one-time mount guard
  // (`lastQuoted = useRef(value?.cost != null ? key : null)`) from
  // whatever `value` the hook exposes on the CHILD's own first render — and
  // the child's first render happens on the exact same commit as the
  // parent's `order?.delivery` gate first turning true. An effect-based
  // resync in the parent hook is one render/commit too late to matter here:
  // the child has already latched the stale null forever by the time that
  // effect runs.
  it('does not fire a live re-quote (or commit a fabricated value) when an order with a stored cost finishes loading', async () => {
    const apiClient = {
      post: vi.fn().mockResolvedValue({
        data: { cost: 999, distanceKm: 99, band: { upToKm: 99, price: 999 } },
      }),
    };
    const onCommit = vi.fn();

    const { rerender } = render(<Harness order={null} apiClient={apiClient} onCommit={onCommit} />);

    // The async order fetch resolves: a real delivery order whose cost is
    // ALREADY known, exactly like opening an existing order in
    // OrderDetailPanel.
    act(() => {
      rerender(
        <Harness
          order={{
            delivery: {
              'Delivery Address': 'ul. Kwiatowa 1',
              'Delivery Method': 'Driver',
              'Delivery Fee': 50,
              'Driver Payout': 35,
              'Distance (km)': 4.2,
              'Distance Band': { upToKm: 5, price: 35 },
            },
          }}
          apiClient={apiClient}
          onCommit={onCommit}
        />,
      );
    });

    // DeliveryPricingFields' own mount-time guard must have seeded from the
    // REAL cost (35), so it must never have called the quote endpoint.
    expect(apiClient.post).not.toHaveBeenCalled();

    // Flush any pending microtask/effect chain and confirm no fabricated
    // value was ever committed back to the host's patchDelivery.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
