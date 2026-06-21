// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DateTag from '../components/DateTag.jsx';

const t = { undatedShort: '—' };

describe('DateTag', () => {
  it('renders the date as DD.MM.YYYY by default', () => {
    render(<DateTag date="2026-06-15" kind="needed" t={t} />);
    expect(screen.getByTestId('date-tag')).toHaveTextContent('15.06.2026');
  });

  it('renders DD.MM (no year) in compact mode', () => {
    render(<DateTag date="2026-06-15" kind="needed" compact t={t} />);
    const tag = screen.getByTestId('date-tag');
    expect(tag).toHaveTextContent('15.06');
    expect(tag).not.toHaveTextContent('2026');
  });

  it('tags the kind via data-kind for styling/queries', () => {
    render(<DateTag date="2026-06-15" kind="arriving" t={t} />);
    expect(screen.getByTestId('date-tag')).toHaveAttribute('data-kind', 'arriving');
  });

  it('colours by kind: arrived=grey, needed=red, arriving=blue', () => {
    const { rerender } = render(<DateTag date="2026-06-15" kind="arrived" t={t} />);
    expect(screen.getByTestId('date-tag').className).toMatch(/gray/);
    rerender(<DateTag date="2026-06-15" kind="needed" t={t} />);
    expect(screen.getByTestId('date-tag').className).toMatch(/red/);
    rerender(<DateTag date="2026-06-15" kind="arriving" t={t} />);
    expect(screen.getByTestId('date-tag').className).toMatch(/blue/);
  });

  it('shows the undated marker when no date is given', () => {
    render(<DateTag date={null} kind="arrived" t={t} />);
    expect(screen.getByTestId('date-tag')).toHaveTextContent('—');
  });

  it('never shows a raw ISO date or a relative "+Nd" label', () => {
    render(<DateTag date="2026-06-20" kind="needed" t={t} />);
    const text = screen.getByTestId('date-tag').textContent;
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no ISO
    expect(text).not.toMatch(/\+\d+d/);            // no "+3d"
  });

  it('overdue=true renders red regardless of kind (arriving normally = blue)', () => {
    render(<DateTag date="2026-06-16" kind="arriving" overdue={true} t={t} />);
    const tag = screen.getByTestId('date-tag');
    expect(tag.className).toMatch(/red/);
    expect(tag.className).not.toMatch(/blue/);
  });

  it('overdue=false keeps the kind colour (arriving = blue)', () => {
    render(<DateTag date="2026-07-01" kind="arriving" overdue={false} t={t} />);
    expect(screen.getByTestId('date-tag').className).toMatch(/blue/);
  });

  it('compact drops the year (DD.MM only)', () => {
    render(<DateTag date="2026-07-15" kind="arrived" compact={true} t={t} />);
    const tag = screen.getByTestId('date-tag');
    expect(tag.textContent).toBe('15.07');
    expect(tag.textContent).not.toContain('2026');
  });
});
