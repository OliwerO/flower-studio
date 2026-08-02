import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});
