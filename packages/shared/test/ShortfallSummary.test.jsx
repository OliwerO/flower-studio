// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ShortfallSummary from '../components/ShortfallSummary.jsx';

const t = { stems: 'stems', undatedShort: '—' };

// One short Variety (net < 0) with a dated Demand Entry.
const groups = [{
  key: 'Peony|Pink|50|', type_name: 'Peony', colour: 'Pink', size_cm: 50, cultivar: null,
  rows: [{ id: 'd1', current_quantity: -7, date: '2026-06-20' }],
}];

describe('ShortfallSummary date header (CR-32)', () => {
  it('renders the needed-by date as a DateTag (DD.MM.YYYY), not a relative "+Nd"', () => {
    render(<ShortfallSummary groups={groups} t={t} today="2026-06-12" />);
    const section = screen.getByTestId('shortfall-date-2026-06-20');
    const tag = within(section).getByTestId('date-tag');
    expect(tag).toHaveTextContent('20.06.2026');
    expect(tag).toHaveAttribute('data-kind', 'needed');
  });

  it('never shows a raw ISO date or a "+Nd" label in the header', () => {
    render(<ShortfallSummary groups={groups} t={t} today="2026-06-12" />);
    const header = screen.getByTestId('shortfall-date-2026-06-20')
      .querySelector('[data-testid="date-tag"]').textContent;
    expect(header).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(header).not.toMatch(/\+\d+d/);
  });
});
