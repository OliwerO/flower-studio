// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import OrderQuickViewModal from '../components/OrderQuickViewModal.jsx';

const t = {
  close: 'Close',
  loading: 'Loading...',
  customer: 'Customer',
  delivery: 'Delivery',
  pickup: 'Pickup',
  paid: 'Paid',
  unpaid: 'Unpaid',
  orderItems: 'Items',
  orderOpenFull: 'Open full order',
  currency: 'zł',
  statusDelivered: 'Доставлен',
};

const order = {
  id: 'rec_abc',
  'App Order ID': '202606-029',
  Status: 'Delivered',
  'Customer Name': 'Roman Kokyrla',
  'Customer Phone': '+48 500 100 200',
  'Delivery Type': 'Delivery',
  'Required By': '2026-07-01',
  'Delivery Time': '08:00-10:00',
  delivery: { 'Delivery Address': 'ul. Kwiatowa 5' },
  orderLines: [{ id: 'l1', 'Flower Name': 'Hydrangea White', Quantity: 5 }],
  'Final Price': 335,
  'Payment Status': 'Paid',
};

function mockClient(data = order) {
  return { get: vi.fn().mockResolvedValue({ data }) };
}

describe('OrderQuickViewModal', () => {
  it('renders nothing when orderId is falsy', () => {
    const { container } = render(<OrderQuickViewModal orderId={null} apiClient={mockClient()} t={t} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('fetches GET /orders/:id and shows the order summary', async () => {
    const client = mockClient();
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={client} t={t} onClose={() => {}} />);
    expect(client.get).toHaveBeenCalledWith('/orders/rec_abc');
    // async content
    expect(await screen.findByText('202606-029')).toBeInTheDocument();
    expect(screen.getByText('Roman Kokyrla')).toBeInTheDocument();
    expect(screen.getByText('Hydrangea White')).toBeInTheDocument();
    expect(screen.getByText('× 5')).toBeInTheDocument();
    expect(screen.getByText(/335\.00 zł/)).toBeInTheDocument();
    expect(screen.getByText('ul. Kwiatowa 5')).toBeInTheDocument();
  });

  it('localizes the status via the status* translation key', async () => {
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={() => {}} />);
    // Status "Delivered" → t.statusDelivered = 'Доставлен'
    expect(await screen.findByText('Доставлен')).toBeInTheDocument();
  });

  it('shows a Paid pill when Payment Status is Paid', async () => {
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={() => {}} />);
    expect(await screen.findByText('Paid')).toBeInTheDocument();
  });

  it('calls onClose when the ✕ button is clicked', async () => {
    const onClose = vi.fn();
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={onClose} />);
    await screen.findByText('202606-029');
    fireEvent.click(screen.getByTestId('order-quickview-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked (returns to trace)', async () => {
    const onClose = vi.fn();
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={onClose} />);
    await screen.findByText('202606-029');
    fireEvent.click(screen.getByTestId('order-quickview-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={onClose} />);
    await screen.findByText('202606-029');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders "Open full order" only when onOpenFull is provided, and fires it with the orderId', async () => {
    const onOpenFull = vi.fn();
    const { rerender } = render(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={() => {}} />);
    await screen.findByText('202606-029');
    expect(screen.queryByTestId('order-quickview-openfull')).toBeNull();

    rerender(<OrderQuickViewModal orderId="rec_abc" apiClient={mockClient()} t={t} onClose={() => {}} onOpenFull={onOpenFull} />);
    const btn = await screen.findByTestId('order-quickview-openfull');
    fireEvent.click(btn);
    expect(onOpenFull).toHaveBeenCalledWith('rec_abc');
  });

  it('shows an error message when the fetch fails (trace stays behind)', async () => {
    const client = { get: vi.fn().mockRejectedValue({ message: 'boom' }) };
    render(<OrderQuickViewModal orderId="rec_abc" apiClient={client} t={{ ...t, error: 'Could not load the order.' }} onClose={() => {}} />);
    expect(await screen.findByText('Could not load the order.')).toBeInTheDocument();
  });
});
