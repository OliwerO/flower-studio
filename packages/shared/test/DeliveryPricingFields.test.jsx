import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';
import DeliveryPricingFields from '../components/DeliveryPricingFields.jsx';

const t = {
  deliveryFee: 'Delivery fee', deliveryCost: 'Delivery cost', deliveryMargin: 'Delivery margin',
  zl: 'zł', feeBelowCostWarning: 'Fee is below cost',
};

function makeApiClient(quoteResponse) {
  return { post: vi.fn().mockResolvedValue({ data: quoteResponse }) };
}

describe('DeliveryPricingFields', () => {
  it('calls the quote endpoint on address change (debounced) and reports cost/distance/band back', async () => {
    const apiClient = makeApiClient({ distanceKm: 4.2, band: { upToKm: 5, price: 35 }, cost: 35, resolvedAddress: 'ul. Kwiatowa 1' });
    const onChange = vi.fn();

    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: null, cost: null }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/delivery-pricing/quote', {
      address: 'ul. Kwiatowa 1', deliveryMethod: 'Driver',
    }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cost: 35, distanceKm: 4.2, band: { upToKm: 5, price: 35 } }));
  });

  it('short-circuits to zero cost for Delivery Method = Florist without calling the API', async () => {
    const apiClient = makeApiClient({});
    const onChange = vi.fn();

    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Florist"
        value={{ fee: null, cost: null }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cost: 0, distanceKm: null, band: null }));
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('shows the live margin as the fee is typed', () => {
    const apiClient = makeApiClient({});
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 50, cost: 35 }} onChange={vi.fn()}
        apiClient={apiClient} t={t}
      />,
    );
    expect(screen.getByTestId('delivery-margin')).toHaveTextContent('15');
  });

  it('warns when the fee is below the cost', () => {
    const apiClient = makeApiClient({});
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 20, cost: 35 }} onChange={vi.fn()}
        apiClient={apiClient} t={t}
      />,
    );
    expect(screen.getByTestId('delivery-fee-below-cost-warning')).toBeInTheDocument();
  });

  it('editing the fee input calls onChange with the new fee', () => {
    const apiClient = makeApiClient({});
    const onChange = vi.fn();
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 50, cost: 35 }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );
    fireEvent.change(screen.getByTestId('delivery-fee-input'), { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledWith({ fee: 60 });
  });

  it('editing the cost input calls onChange with the manual override', () => {
    const apiClient = makeApiClient({});
    const onChange = vi.fn();
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 50, cost: 35 }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );
    fireEvent.change(screen.getByTestId('delivery-cost-input'), { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith({ cost: 45, distanceKm: null, band: null });
  });

  it('hides the margin row and below-cost warning when showMargin is false, while keeping the fee/cost inputs editable', () => {
    const apiClient = makeApiClient({});
    const onChange = vi.fn();
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 50, cost: 35 }} onChange={onChange}
        apiClient={apiClient} t={t}
        showMargin={false}
      />,
    );
    expect(screen.queryByTestId('delivery-margin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delivery-fee-below-cost-warning')).not.toBeInTheDocument();

    const feeInput = screen.getByTestId('delivery-fee-input');
    const costInput = screen.getByTestId('delivery-cost-input');
    expect(feeInput).toBeInTheDocument();
    expect(costInput).toBeInTheDocument();

    fireEvent.change(feeInput, { target: { value: '60' } });
    expect(onChange).toHaveBeenCalledWith({ fee: 60 });

    fireEvent.change(costInput, { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith({ cost: 45, distanceKm: null, band: null });
  });

  it('shows a neutral placeholder for the margin when the cost is not yet known (e.g. an unresolved quote), and skips the below-cost warning', () => {
    const apiClient = makeApiClient({});
    render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: 35, cost: null }} onChange={vi.fn()}
        apiClient={apiClient} t={t}
      />,
    );
    const margin = screen.getByTestId('delivery-margin');
    expect(margin).toHaveTextContent('—');
    expect(margin).not.toHaveTextContent('35');
    expect(margin.className).not.toMatch(/text-emerald-600|text-rose-600/);
    expect(screen.queryByTestId('delivery-fee-below-cost-warning')).not.toBeInTheDocument();
  });

  it('re-fetches after a Florist detour and back, even with the address unchanged (stale lastQuoted ref)', async () => {
    const apiClient = makeApiClient({ distanceKm: 4.2, band: { upToKm: 5, price: 35 }, cost: 35, resolvedAddress: 'ul. Kwiatowa 1' });
    const onChange = vi.fn();

    const { rerender } = render(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: null, cost: null }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cost: 35, distanceKm: 4.2, band: { upToKm: 5, price: 35 } }));

    // Detour: switch to Florist. Short-circuits to zero cost, no new API call
    // for this address+method combo — same as the dedicated Florist test above.
    rerender(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Florist"
        value={{ fee: null, cost: 35 }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cost: 0, distanceKm: null, band: null }));
    expect(apiClient.post).toHaveBeenCalledTimes(1);

    // Correct the method back to Driver — SAME address as the very first quote.
    // Must re-fetch (the owner picked the wrong method and fixed it), not silently
    // keep the Florist branch's stale cost: 0.
    rerender(
      <DeliveryPricingFields
        address="ul. Kwiatowa 1" deliveryMethod="Driver"
        value={{ fee: null, cost: 0 }} onChange={onChange}
        apiClient={apiClient} t={t}
      />,
    );

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ cost: 35, distanceKm: 4.2, band: { upToKm: 5, price: 35 } }));
  });

  describe('mount-time quote suppression when a cost already exists', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('does not re-fetch on a fresh mount with an existing cost for the same address (Back/Next remount, detail-panel open), but still quotes once the address genuinely changes', () => {
      const apiClient = makeApiClient({ distanceKm: 3, band: { upToKm: 5, price: 30 }, cost: 30, resolvedAddress: 'ul. Nowa 2' });
      const onChange = vi.fn();

      // Fresh mount — as if Step3Details had just remounted after Back/Next, or
      // an order-detail panel had just opened — with a cost ALREADY set for this
      // exact address. Must NOT fire an unsolicited quote that would silently
      // overwrite a manual override or a stored distance/band/cost (ADR-0019).
      const { rerender } = render(
        <DeliveryPricingFields
          address="ul. Kwiatowa 1" deliveryMethod="Driver"
          value={{ fee: 50, cost: 35 }} onChange={onChange}
          apiClient={apiClient} t={t}
        />,
      );

      expect(apiClient.post).not.toHaveBeenCalled();

      // The seed must not permanently disable quoting — once the address
      // genuinely changes to something new, a fresh quote must still fire.
      rerender(
        <DeliveryPricingFields
          address="ul. Nowa 2" deliveryMethod="Driver"
          value={{ fee: 50, cost: 35 }} onChange={onChange}
          apiClient={apiClient} t={t}
        />,
      );
      act(() => { vi.advanceTimersByTime(500); });

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith('/delivery-pricing/quote', {
        address: 'ul. Nowa 2', deliveryMethod: 'Driver',
      });
    });

    it('DOES quote on a fresh mount when no cost exists yet (genuine first-time quote, e.g. address prefilled from a saved contact)', () => {
      const apiClient = makeApiClient({ distanceKm: 4.2, band: { upToKm: 5, price: 35 }, cost: 35, resolvedAddress: 'ul. Kwiatowa 1' });
      const onChange = vi.fn();

      render(
        <DeliveryPricingFields
          address="ul. Kwiatowa 1" deliveryMethod="Driver"
          value={{ fee: null, cost: null }} onChange={onChange}
          apiClient={apiClient} t={t}
        />,
      );

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith('/delivery-pricing/quote', {
        address: 'ul. Kwiatowa 1', deliveryMethod: 'Driver',
      });
    });
  });

  describe('debounce collapses rapid address changes', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('does not fire a quote per keystroke — only once, for the final settled address', () => {
      const apiClient = makeApiClient({ distanceKm: 2.1, band: { upToKm: 5, price: 25 }, cost: 25, resolvedAddress: 'ul. Kwiatowa 123' });
      const onChange = vi.fn();

      // Mount with an empty address so there is no immediate leading-edge quote
      // to conflate with the "keystrokes" below (useDebouncedValue's initial
      // state equals the mount-time prop with no delay — see useDebouncedValue.js).
      const { rerender } = render(
        <DeliveryPricingFields
          address="" deliveryMethod="Driver"
          value={{ fee: null, cost: null }} onChange={onChange}
          apiClient={apiClient} t={t}
        />,
      );

      const keystrokes = ['u', 'ul', 'ul.', 'ul. K', 'ul. Kwiatowa', 'ul. Kwiatowa 123'];
      keystrokes.forEach(address => {
        rerender(
          <DeliveryPricingFields
            address={address} deliveryMethod="Driver"
            value={{ fee: null, cost: null }} onChange={onChange}
            apiClient={apiClient} t={t}
          />,
        );
        // Well under the 500ms debounce window — each keystroke cancels and
        // reschedules the previous timer (useDebouncedValue's effect cleanup).
        act(() => { vi.advanceTimersByTime(100); });
      });

      expect(apiClient.post).not.toHaveBeenCalled();

      // Let the debounce settle past the LAST keystroke.
      act(() => { vi.advanceTimersByTime(500); });

      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith('/delivery-pricing/quote', {
        address: 'ul. Kwiatowa 123', deliveryMethod: 'Driver',
      });
    });
  });
});
