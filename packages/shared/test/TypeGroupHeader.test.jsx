// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TypeGroupHeader from '../components/TypeGroupHeader.jsx';

describe('TypeGroupHeader', () => {
  it('renders Type label + total qty across varieties', () => {
    render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByText('Rose')).toBeInTheDocument();
    expect(screen.getByText(/42/)).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it('toggles collapsed on click', () => {
    const onToggle = vi.fn();
    render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={onToggle} t={{ stems: 'stems' }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('chevron rotates when collapsed', () => {
    const { rerender } = render(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={false} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByTestId('type-chevron')).toHaveAttribute('data-collapsed', 'false');
    rerender(<TypeGroupHeader typeName="Rose" totalQty={42} varietyCount={3}
      collapsed={true} onToggle={() => {}} t={{ stems: 'stems' }} />);
    expect(screen.getByTestId('type-chevron')).toHaveAttribute('data-collapsed', 'true');
  });
});
