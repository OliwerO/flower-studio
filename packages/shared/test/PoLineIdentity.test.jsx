// @vitest-environment jsdom
// #594 — a linked PO line shows its identity READ-ONLY, including the Variety
// the receive will actually resolve to. Changing the flower is a replace
// (remove the line, add a new one), so no re-pick affordance is offered here.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PoLineIdentity from '../components/PoLineIdentity.jsx';

const t = {
  receivesInto: 'поступит в',
  changeFlowerHint: 'Чтобы сменить цветок, удалите строку и добавьте новую',
};

const blueCard = {
  id: 'card-blue', 'Display Name': 'Hydrangea Blue',
  Type: 'Hydrangea', Colour: 'Blue', Size: null, Cultivar: null,
};

describe('PoLineIdentity (#594)', () => {
  it('shows the flower name read-only — no text input to re-pick with', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea Blue', 'Stock Item': ['card-blue'] }}
      stock={[blueCard]} t={t} />);

    expect(screen.getByTestId('po-line-identity-name')).toHaveTextContent('Hydrangea Blue');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the Variety the receive will resolve to, from the LINKED card', () => {
    // The whole point of #558: the name can say one thing while the link says
    // another. Surface the link's Variety so the divergence is visible.
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea White', 'Stock Item': ['card-blue'] }}
      stock={[blueCard]} t={t} />);

    const target = screen.getByTestId('po-line-receives-into');
    expect(target).toHaveTextContent('поступит в');
    expect(target).toHaveTextContent('Hydrangea Blue');
  });

  it('flags a mismatch when the line name disagrees with the linked Variety', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea White', 'Stock Item': ['card-blue'] }}
      stock={[blueCard]} t={t} />);

    expect(screen.getByTestId('po-line-identity-mismatch')).toBeInTheDocument();
  });

  it('does NOT flag a mismatch when name and linked Variety agree', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea Blue', 'Stock Item': ['card-blue'] }}
      stock={[blueCard]} t={t} />);

    expect(screen.queryByTestId('po-line-identity-mismatch')).not.toBeInTheDocument();
  });

  it('renders the Variety from the line itself when the card carries no attrs', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Tulip Yellow', 'Stock Item': ['legacy'], Type: 'Tulip', Colour: 'Yellow' }}
      stock={[{ id: 'legacy', 'Display Name': 'Tulip Yellow' }]} t={t} />);

    expect(screen.getByTestId('po-line-receives-into')).toHaveTextContent('Tulip Yellow');
  });

  it('tells the owner how to change the flower (remove + add)', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea Blue', 'Stock Item': ['card-blue'] }}
      stock={[blueCard]} t={t} />);

    expect(screen.getByTestId('po-line-change-hint')).toHaveTextContent(/удалите строку/i);
  });

  it('degrades gracefully when the linked card is missing from the loaded stock', () => {
    render(<PoLineIdentity
      line={{ 'Flower Name': 'Hydrangea Blue', 'Stock Item': ['gone'] }}
      stock={[]} t={t} />);

    expect(screen.getByTestId('po-line-identity-name')).toHaveTextContent('Hydrangea Blue');
    expect(screen.queryByTestId('po-line-receives-into')).not.toBeInTheDocument();
  });
});
