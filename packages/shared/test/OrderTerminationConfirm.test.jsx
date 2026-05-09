// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(() => cleanup());
import OrderTerminationConfirm from '../components/OrderTerminationConfirm.jsx';

const T = {
  cancelConfirm:        'Are you sure you want to cancel?',
  cancelAndReturn:      'Cancel + return stock',
  cancelNoReturn:       'Cancel only',
  cancel:               'Dismiss',
  deleteOrderConfirmYes: 'Delete permanently',
};

function makeFlow(overrides = {}) {
  return {
    confirmOpen:      true,
    pendingKind:      'cancel',
    saving:           false,
    cancelWithReturn: vi.fn(),
    cancelOnly:       vi.fn(),
    deleteWithReturn: vi.fn(),
    dismiss:          vi.fn(),
    requestCancel:    vi.fn(),
    requestDelete:    vi.fn(),
    ...overrides,
  };
}

describe('OrderTerminationConfirm', () => {
  it('renders three buttons with correct t-key labels', () => {
    render(<OrderTerminationConfirm flow={makeFlow()} t={T} />);

    expect(screen.getByText(T.cancelConfirm)).toBeTruthy();
    expect(screen.getByText(T.cancelAndReturn)).toBeTruthy();
    expect(screen.getByText(T.cancelNoReturn)).toBeTruthy();
    expect(screen.getByText(T.cancel)).toBeTruthy();
  });

  it('calls cancelWithReturn when first button clicked', async () => {
    const flow = makeFlow();
    render(<OrderTerminationConfirm flow={flow} t={T} />);
    screen.getByText(T.cancelAndReturn).click();
    expect(flow.cancelWithReturn).toHaveBeenCalledTimes(1);
  });

  it('calls cancelOnly when second button clicked', () => {
    const flow = makeFlow();
    render(<OrderTerminationConfirm flow={flow} t={T} />);
    screen.getByText(T.cancelNoReturn).click();
    expect(flow.cancelOnly).toHaveBeenCalledTimes(1);
  });

  it('calls dismiss when third button clicked', () => {
    const flow = makeFlow();
    render(<OrderTerminationConfirm flow={flow} t={T} />);
    screen.getByText(T.cancel).click();
    expect(flow.dismiss).toHaveBeenCalledTimes(1);
  });

  it('disables all buttons when saving=true', () => {
    render(<OrderTerminationConfirm flow={makeFlow({ saving: true })} t={T} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    buttons.forEach(btn => expect(btn.disabled).toBe(true));
  });

  // ── delete mode ────────────────────────────────────────────────────────────

  it('delete mode: renders two buttons (confirm delete + dismiss) when pendingKind=delete and allowDelete=true', () => {
    const flow = makeFlow({ pendingKind: 'delete' });
    render(<OrderTerminationConfirm flow={flow} t={T} allowDelete />);

    // Should have the confirm-delete button and dismiss button
    expect(screen.getByText(T.deleteOrderConfirmYes, { exact: false })).toBeTruthy();
    expect(screen.getByText(T.cancel)).toBeTruthy();
    // Should NOT have cancel-mode buttons
    expect(screen.queryByText(T.cancelAndReturn)).toBeNull();
    expect(screen.queryByText(T.cancelNoReturn)).toBeNull();
  });

  it('delete mode: calls deleteWithReturn when confirm button clicked', () => {
    const flow = makeFlow({ pendingKind: 'delete' });
    render(<OrderTerminationConfirm flow={flow} t={T} allowDelete />);
    screen.getByText(T.deleteOrderConfirmYes, { exact: false }).click();
    expect(flow.deleteWithReturn).toHaveBeenCalledTimes(1);
  });

  it('delete mode: calls dismiss when dismiss button clicked', () => {
    const flow = makeFlow({ pendingKind: 'delete' });
    render(<OrderTerminationConfirm flow={flow} t={T} allowDelete />);
    screen.getByText(T.cancel).click();
    expect(flow.dismiss).toHaveBeenCalledTimes(1);
  });

  it('delete mode hidden when allowDelete=false (default)', () => {
    // When pendingKind='delete' but allowDelete is false, falls through to cancel UI
    // (in practice this state shouldn't occur, but the component is safe)
    const flow = makeFlow({ pendingKind: 'delete' });
    render(<OrderTerminationConfirm flow={flow} t={T} />);
    // Falls back to cancel mode — cancelConfirm copy is present
    expect(screen.getByText(T.cancelConfirm)).toBeTruthy();
    expect(screen.queryByText(T.deleteOrderConfirmYes, { exact: false })).toBeNull();
  });
});
