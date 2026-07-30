// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import PoLineForm from '../components/PoLineForm.jsx';
import { linkAgreesWithAttrs } from '../utils/poLineVariety.js';

const t = {
  flowerType: 'Type', flowerColour: 'Colour', flowerCultivar: 'Cultivar', flowerSizeCm: 'Size cm',
  stems: 'шт', supplier: 'Supplier', farmer: 'Farmer', costPrice: 'Cost', sellPrice: 'Sell',
  po: { variety: 'Сорт', qtyNeeded: 'Нужно', packages: 'Пачки', notes: 'Notes' },
  shopping: { lotSize: 'В пачке', totalCost: 'Итого' },
};

const PINK_60 = {
  id: 'sp-1', 'Display Name': 'Peony Pink 60cm',
  Type: 'Peony', Colour: 'Pink', Size: 60, Cultivar: null,
  'Current Cost Price': 4.5, 'Current Sell Price': 14, 'Lot Size': 10, Supplier: 'Zielona',
};
const PINK_70 = {
  id: 'sp-2', 'Display Name': 'Peony Pink 70cm',
  Type: 'Peony', Colour: 'Pink', Size: 70, Cultivar: null,
  'Current Cost Price': 5.2, 'Current Sell Price': 16, 'Lot Size': 10, Supplier: 'Zielona',
};
const STOCK = [PINK_60, PINK_70];

const EMPTY = {
  flowerName: '', stockItemId: '', supplier: '', farmer: '', notes: '',
  lotSize: '', qty: '', costPerStem: '', sellPerStem: '',
  type: '', colour: '', size: '', cultivar: '',
};

/** Host harness — mirrors how the real screens own line state. */
function Harness({ initial = EMPTY, onLine, ...props }) {
  const [line, setLine] = useState(initial);
  return (
    <PoLineForm
      value={line}
      onChange={(patch) => setLine((prev) => {
        const next = { ...prev, ...patch };
        onLine?.(next);
        return next;
      })}
      stock={STOCK}
      t={t}
      targetMarkup={2.5}
      {...props}
    />
  );
}

describe('PoLineForm — Variety visibility', () => {
  it('shows the Variety block even when nothing is picked', () => {
    render(<Harness />);
    expect(screen.getByTestId('nv-type')).toBeInTheDocument();
    expect(screen.getByTestId('po-variety-badge')).toHaveTextContent('not selected');
  });

  it('keeps the Variety block visible AND filled after picking a flower', () => {
    // The bug this feature exists to fix: picking a flower used to set
    // stockItemId, which hid the block entirely.
    render(<Harness />);
    fireEvent.change(screen.getByTestId('stock-search-input'), { target: { value: 'Peony Pink 60' } });
    fireEvent.mouseDown(screen.getByText('Peony Pink 60cm'));

    expect(screen.getByTestId('nv-type')).toHaveValue('Peony');
    expect(screen.getByTestId('nv-colour')).toHaveValue('Pink');
    expect(screen.getByTestId('nv-size')).toHaveValue(60);
    expect(screen.getByTestId('po-variety-badge')).toHaveTextContent('from stock card');
  });

  it('adopts the picked card\'s price, lot size and supplier', () => {
    render(<Harness />);
    fireEvent.change(screen.getByTestId('stock-search-input'), { target: { value: 'Peony Pink 60' } });
    fireEvent.mouseDown(screen.getByText('Peony Pink 60cm'));

    expect(screen.getByTestId('po-cost')).toHaveValue(4.5);
    expect(screen.getByTestId('po-sell')).toHaveValue(14);
    expect(screen.getByTestId('po-lot')).toHaveValue(10);
    expect(screen.getByTestId('po-supplier')).toHaveValue('Zielona');
  });
});

describe('PoLineForm — re-resolution (ADR-0014)', () => {
  it('re-links to another existing Variety when the size is changed to one in stock', () => {
    const seen = [];
    render(<Harness initial={{ ...EMPTY, ...linkedTo(PINK_60) }} onLine={(l) => seen.push(l)} />);

    fireEvent.change(screen.getByTestId('nv-size'), { target: { value: '70' } });

    const last = seen.at(-1);
    expect(last.stockItemId).toBe('sp-2');
    expect(last.flowerName).toBe('Peony Pink 70cm');
    expect(screen.getByTestId('po-variety-badge')).toHaveTextContent('from stock card');
  });

  it('detaches when an edit produces a Variety that does not exist', () => {
    const seen = [];
    render(<Harness initial={{ ...EMPTY, ...linkedTo(PINK_60) }} onLine={(l) => seen.push(l)} />);

    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'White' } });

    const last = seen.at(-1);
    expect(last.stockItemId).toBe('');
    expect(last.colour).toBe('White');
    expect(screen.getByTestId('po-variety-badge')).toHaveTextContent('new variety');
  });

  it('never leaves a stock link attached to a Variety it disagrees with (#558)', () => {
    // The invariant. Walk a realistic edit sequence and assert it after each
    // step — a linked-but-edited line receives stems into the wrong card.
    const seen = [];
    render(<Harness onLine={(l) => seen.push(l)} />);

    fireEvent.change(screen.getByTestId('stock-search-input'), { target: { value: 'Peony Pink 60' } });
    fireEvent.mouseDown(screen.getByText('Peony Pink 60cm'));
    fireEvent.change(screen.getByTestId('nv-size'), { target: { value: '70' } });
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'White' } });
    fireEvent.change(screen.getByTestId('nv-cultivar'), { target: { value: 'Duchesse' } });

    expect(seen.length).toBeGreaterThan(3);
    for (const line of seen) {
      expect(linkAgreesWithAttrs(STOCK, line.stockItemId, line)).toBe(true);
    }
  });

  it('clears the link when the search box is typed into freely', () => {
    const seen = [];
    render(<Harness initial={{ ...EMPTY, ...linkedTo(PINK_60) }} onLine={(l) => seen.push(l)} />);
    fireEvent.change(screen.getByTestId('stock-search-input'), { target: { value: 'Peo' } });
    expect(seen.at(-1).stockItemId).toBe('');
  });

  it('offers only the sizes stocked for the chosen Type', () => {
    const { container } = render(
      <Harness initial={{ ...EMPTY, type: 'Peony' }} idPrefix="x" />,
    );
    const sizes = [...container.querySelectorAll('#x-nv-sizes option')].map((o) => o.value);
    expect(sizes).toEqual(['60', '70']);
  });
});

describe('PoLineForm — packages are derived (D1)', () => {
  it('shows packages computed from stems and lot size', () => {
    render(<Harness initial={{ ...EMPTY, qty: '40', lotSize: '10' }} />);
    expect(screen.getByTestId('po-packages')).toHaveValue(4);
    expect(screen.getByTestId('po-stems-line')).toHaveTextContent('4 × 10 = 40 шт');
  });

  it('sets stems when packages is edited', () => {
    const seen = [];
    render(<Harness initial={{ ...EMPTY, qty: '40', lotSize: '10' }} onLine={(l) => seen.push(l)} />);
    fireEvent.change(screen.getByTestId('po-packages'), { target: { value: '6' } });
    expect(seen.at(-1).qty).toBe('60');
  });

  it('shows a fractional package count rather than rounding the stem count', () => {
    render(<Harness initial={{ ...EMPTY, qty: '35', lotSize: '10' }} />);
    expect(screen.getByTestId('po-packages')).toHaveValue(3.5);
    expect(screen.getByTestId('po-qty')).toHaveValue(35);
  });

  it('disables packages when there is no meaningful lot', () => {
    render(<Harness initial={{ ...EMPTY, qty: '12', lotSize: '' }} />);
    expect(screen.getByTestId('po-packages')).toBeDisabled();
    expect(screen.getByTestId('po-stems-line')).toHaveTextContent('12 шт');
  });
});

describe('PoLineForm — host modes', () => {
  it('hides Farmer and the line note on the shopping-supervision screen', () => {
    render(<Harness mode="shopping" />);
    expect(screen.queryByTestId('po-farmer')).toBeNull();
    expect(screen.queryByTestId('po-notes')).toBeNull();
    // Quantity math is never mode-dependent.
    expect(screen.getByTestId('po-qty')).toBeInTheDocument();
    expect(screen.getByTestId('po-packages')).toBeInTheDocument();
  });

  it('shows them everywhere else', () => {
    render(<Harness mode="sent" />);
    expect(screen.getByTestId('po-farmer')).toBeInTheDocument();
    expect(screen.getByTestId('po-notes')).toBeInTheDocument();
  });
});

/** A line already linked to `item`, as a host would hydrate it from the API. */
function linkedTo(item) {
  return {
    stockItemId: item.id,
    flowerName: item['Display Name'],
    type: item.Type, colour: item.Colour,
    size: item.Size != null ? String(item.Size) : '',
    cultivar: item.Cultivar ?? '',
    lotSize: String(item['Lot Size']),
    costPerStem: String(item['Current Cost Price']),
    sellPerStem: String(item['Current Sell Price']),
    supplier: item.Supplier ?? '',
  };
}

describe('PoLineForm — locked identity (#593)', () => {
  const LINKED_LINE = {
    id: 'ln-1', 'Flower Name': 'Peony Pink 60cm', 'Stock Item': ['sp-1'],
    Type: 'Peony', Colour: 'Pink', Size: 60,
  };

  it('replaces the picker and Variety inputs with the read-only identity block', () => {
    // Changing a linked line's flower is a REPLACE (remove + re-add), so the
    // form must not offer an edit the backend will reject with a 409.
    render(<Harness initial={{ ...EMPTY, ...linkedTo(PINK_60) }} identityLocked line={LINKED_LINE} />);

    expect(screen.queryByTestId('stock-search-input')).toBeNull();
    expect(screen.queryByTestId('nv-type')).toBeNull();
    expect(screen.queryByTestId('po-variety-badge')).toBeNull();
  });

  it('keeps quantities and prices editable on a locked line', () => {
    // Only identity is frozen — the owner still corrects how much and for how
    // much right up until the order is evaluated.
    const seen = [];
    render(<Harness initial={{ ...EMPTY, ...linkedTo(PINK_60) }} identityLocked line={LINKED_LINE}
                    onLine={(l) => seen.push(l)} />);

    fireEvent.change(screen.getByTestId('po-qty'), { target: { value: '80' } });
    expect(seen.at(-1).qty).toBe('80');
    expect(screen.getByTestId('po-cost')).toBeInTheDocument();
    expect(screen.getByTestId('po-packages')).toBeInTheDocument();
  });
});
