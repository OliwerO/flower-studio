// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatchTraceModal from '../components/BatchTraceModal.jsx';

const t = {
  traceTypeOrder: 'Order', traceTypeWriteoff: 'Write-off',
  traceTypePurchase: 'Purchase', traceTypePremade: 'Premade',
  traceEmpty: 'No history yet', stems: 'stems',
  close: 'Close', batchTraceTitle: 'Batch history',
};

describe('BatchTraceModal', () => {
  it('mounts trail panel + close button', () => {
    render(<BatchTraceModal trail={[{ type: 'order', date: '2026-05-10', qty: 5 }]}
      t={t} onClose={() => {}} />);
    expect(screen.getByTestId('trace-row')).toBeInTheDocument();
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('clicking close button fires onClose', () => {
    const onClose = vi.fn();
    render(<BatchTraceModal trail={[]} t={t} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape key closes modal', () => {
    const onClose = vi.fn();
    render(<BatchTraceModal trail={[]} t={t} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(<BatchTraceModal trail={[]} t={t} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trace-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking inside the modal does NOT close', () => {
    const onClose = vi.fn();
    render(<BatchTraceModal trail={[]} t={t} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('trace-modal-content'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
