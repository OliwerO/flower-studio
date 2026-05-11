// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PendingArrivalsPanel from '../components/PendingArrivalsPanel.jsx';

const t = {
  pendingArrivals: 'Incoming',
  shortfallsVarieties: 'varieties',
  shortfallsStems: 'stems',
  stems: 'stems',
  today: 'Today',
  tomorrow: 'Tomorrow',
  daysSuffix: 'd',
};

const TODAY = '2026-05-11';

function setup(pendingPO, stock) {
  return render(<PendingArrivalsPanel pendingPO={pendingPO} stock={stock} t={t} today={TODAY} />);
}

describe('PendingArrivalsPanel', () => {
  it('renders nothing when no pending PO', () => {
    const { container } = setup({}, []);
    expect(container.firstChild).toBeNull();
  });

  it('groups multiple stockIds by Variety 4-tuple', () => {
    const stock = [
      { id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
      { id: 's2', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
      { id: 's3', Type: 'Rose',  Colour: 'Red',  Size: 60, Cultivar: 'Naomi' },
    ];
    const pendingPO = {
      s1: { ordered: 10, plannedDate: '2026-05-13', pos: [{ id: 'p1', number: 'PO-1', quantity: 10, plannedDate: '2026-05-13' }] },
      s2: { ordered: 5,  plannedDate: '2026-05-15', pos: [{ id: 'p2', number: 'PO-2', quantity: 5,  plannedDate: '2026-05-15' }] },
      s3: { ordered: 20, plannedDate: '2026-05-12', pos: [{ id: 'p3', number: 'PO-3', quantity: 20, plannedDate: '2026-05-12' }] },
    };
    setup(pendingPO, stock);
    const rows = screen.getAllByTestId('pending-arrivals-row');
    expect(rows).toHaveLength(2); // Two unique Varieties
  });

  it('sums quantities across stockIds of the same Variety', () => {
    const stock = [
      { id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
      { id: 's2', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
    ];
    const pendingPO = {
      s1: { ordered: 10, plannedDate: '2026-05-13', pos: [{ id: 'p1', quantity: 10, plannedDate: '2026-05-13' }] },
      s2: { ordered: 7,  plannedDate: '2026-05-15', pos: [{ id: 'p2', quantity: 7,  plannedDate: '2026-05-15' }] },
    };
    setup(pendingPO, stock);
    expect(screen.getByText('+17 stems')).toBeInTheDocument();
  });

  it('renders arrival pills with relative date labels', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = {
      s1: {
        ordered: 15,
        plannedDate: '2026-05-12',
        pos: [
          { id: 'p1', quantity: 10, plannedDate: '2026-05-12' }, // +1d → Tomorrow
          { id: 'p2', quantity: 5,  plannedDate: '2026-05-18' }, // +7d
        ],
      },
    };
    setup(pendingPO, stock);
    const arrivals = screen.getAllByTestId('pending-arrivals-arrival');
    expect(arrivals).toHaveLength(2);
    expect(arrivals[0].textContent).toContain('+10');
    expect(arrivals[0].textContent).toContain('Tomorrow');
    expect(arrivals[1].textContent).toContain('+5');
    expect(arrivals[1].textContent).toContain('+7d');
  });

  it('falls back to flower name when stock row has no Type (legacy item)', () => {
    const stock = [{ id: 's1', 'Display Name': 'Custom Bouquet Filler', Type: null, Colour: null, Size: null, Cultivar: null }];
    const pendingPO = {
      s1: { ordered: 3, plannedDate: '2026-05-13', flowerName: 'Custom Bouquet Filler',
            pos: [{ id: 'p1', quantity: 3, plannedDate: '2026-05-13' }] },
    };
    setup(pendingPO, stock);
    expect(screen.getByText('Custom Bouquet Filler')).toBeInTheDocument();
  });

  it('collapse toggles row visibility', () => {
    const stock = [{ id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null }];
    const pendingPO = { s1: { ordered: 5, plannedDate: '2026-05-13', pos: [{ id: 'p1', quantity: 5, plannedDate: '2026-05-13' }] } };
    setup(pendingPO, stock);
    expect(screen.getAllByTestId('pending-arrivals-row')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('pending-arrivals-header'));
    expect(screen.queryByTestId('pending-arrivals-row')).toBeNull();
  });

  it('orders groups by earliest arrival date (most urgent first)', () => {
    const stock = [
      { id: 's1', Type: 'Peony', Colour: 'Pink', Size: 50, Cultivar: null },
      { id: 's2', Type: 'Rose',  Colour: 'Red',  Size: 60, Cultivar: 'Naomi' },
    ];
    const pendingPO = {
      s1: { ordered: 5, plannedDate: '2026-05-20', pos: [{ id: 'p1', quantity: 5, plannedDate: '2026-05-20' }] },
      s2: { ordered: 3, plannedDate: '2026-05-12', pos: [{ id: 'p2', quantity: 3, plannedDate: '2026-05-12' }] },
    };
    setup(pendingPO, stock);
    const rows = screen.getAllByTestId('pending-arrivals-row');
    // First row should be Rose (earlier arrival)
    expect(rows[0].textContent).toContain('Rose');
    expect(rows[1].textContent).toContain('Peony');
  });
});
