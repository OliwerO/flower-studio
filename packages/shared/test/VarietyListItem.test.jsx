// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VarietyListItem from '../components/VarietyListItem.jsx';

const t = { onHand: 'on hand', planned: 'planned', reserved: 'reserved', net: 'net', stems: 'stems' };
const variety = {
  key: 'Rose|Pink|60|',
  type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: null,
  rows: [{ id: 'b1', current_quantity: 10, date: '2026-05-10' }],
};

describe('VarietyListItem header', () => {
  it('renders Variety display (drops Type since under TypeGroupHeader): "Pink 60cm"', () => {
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Pink 60cm/)).toBeInTheDocument();
    expect(screen.queryByText('Rose')).not.toBeInTheDocument();
  });

  it('renders 4 buckets aligned right', () => {
    render(<VarietyListItem variety={variety} reservations={new Map([['b1', 3]])} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByTestId('bucket-onHand')).toHaveTextContent('10');
    expect(screen.getByTestId('bucket-planned')).toHaveTextContent('0');
    expect(screen.getByTestId('bucket-reserved')).toHaveTextContent('3');
    expect(screen.getByTestId('bucket-net')).toHaveTextContent('7');
  });

  it('cultivar shown only when non-null', () => {
    const v2 = { ...variety, cultivar: "Sarah Bernhardt" };
    render(<VarietyListItem variety={v2} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/Sarah Bernhardt/)).toBeInTheDocument();
  });

  it('toggles expanded on header click', () => {
    const onToggle = vi.fn();
    render(<VarietyListItem variety={variety} reservations={new Map()} t={t}
      hideType={true} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId('variety-header'));
    expect(onToggle).toHaveBeenCalled();
  });
});
