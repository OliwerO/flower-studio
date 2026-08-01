// @vitest-environment jsdom
//
// ValueCombobox — the picker behind every Variety attribute field (#610).
//
// The owner typed `DA` looking for dahlias and met four plain-looking text
// boxes. A `<datalist>` is a suggestion, not a picker: it shows no affordance,
// often refuses to open at all on her browser (#587), and — worst — a typed
// value that matches nothing is committed silently. `dahlia` beside `Dahlia`,
// `Dark pink` beside `Dark Pink`, and the Variety 4-tuple IS the identity, so
// stock splits across two cards (the #562 / #558 shape).
//
// So these pin, in order of how badly each one bites:
//   1. an unknown value is NEVER committed by typing alone — it takes a
//      deliberate act (click the create row, or Enter while it is highlighted);
//   2. a value that already exists snaps to that option's exact casing, so
//      `dahlia` can never become a second Dahlia;
//   3. the list opens on demand and shows everything, so she can look before
//      she types;
//   4. with nothing to pick from, the control is honestly a plain text box.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ValueCombobox from '../components/ValueCombobox.jsx';

const COLOURS = ['Coral', 'Dark Pink', 'Pink', 'White'];
const t = { varietyValueCreate: 'Создать' };

function setup(props = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ValueCombobox
      value=""
      onChange={onChange}
      options={COLOURS}
      placeholder="Цвет"
      testId="cb"
      t={t}
      {...props}
    />,
  );
  return { onChange, ...utils };
}

const input = () => screen.getByTestId('cb');
const optionTexts = () => screen.getAllByTestId('cb-option').map((o) => o.textContent);

describe('ValueCombobox — opening and browsing', () => {
  it('starts closed', () => {
    setup();
    expect(screen.queryByTestId('cb-list')).not.toBeInTheDocument();
  });

  it('opens on click and shows every option', () => {
    setup();
    fireEvent.click(input());
    expect(screen.getByTestId('cb-list')).toBeInTheDocument();
    expect(optionTexts()).toEqual(COLOURS);
  });

  it('opens and closes from the toggle button', () => {
    setup();
    fireEvent.click(screen.getByTestId('cb-toggle'));
    expect(screen.getByTestId('cb-list')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cb-toggle'));
    expect(screen.queryByTestId('cb-list')).not.toBeInTheDocument();
  });

  it('marks itself as a combobox for assistive tech', () => {
    setup();
    expect(input()).toHaveAttribute('role', 'combobox');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(input());
    expect(input()).toHaveAttribute('aria-expanded', 'true');
  });

  it('filters case-insensitively on substring, not just prefix', () => {
    setup();
    fireEvent.change(input(), { target: { value: 'pink' } });
    expect(optionTexts()).toEqual(['Dark Pink', 'Pink']);
  });
});

describe('ValueCombobox — committing an existing value', () => {
  it('commits the option, not the typed text, when clicked', () => {
    const { onChange } = setup();
    fireEvent.change(input(), { target: { value: 'cor' } });
    fireEvent.click(screen.getByText('Coral'));
    expect(onChange).toHaveBeenCalledWith('Coral');
    expect(screen.queryByTestId('cb-list')).not.toBeInTheDocument();
  });

  it('snaps a differently-cased exact match to the stored casing', () => {
    // The whole point: `dark pink` must never become a second "Dark Pink".
    const { onChange } = setup();
    fireEvent.change(input(), { target: { value: 'dark pink' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Dark Pink');
  });

  it('snaps on blur too — leaving the field cannot leave a case variant behind', () => {
    const { onChange } = setup();
    fireEvent.change(input(), { target: { value: 'WHITE' } });
    fireEvent.blur(input());
    expect(onChange).toHaveBeenCalledWith('White');
  });

  it('walks the list with the arrow keys and picks with Enter', () => {
    const { onChange } = setup();
    fireEvent.click(input());
    fireEvent.keyDown(input(), { key: 'ArrowDown' }); // Coral
    fireEvent.keyDown(input(), { key: 'ArrowDown' }); // Dark Pink
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Dark Pink');
  });

  it('ArrowUp from the top wraps to the last option', () => {
    const { onChange } = setup();
    fireEvent.click(input());
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('White');
  });
});

describe('ValueCombobox — creating a value that does not exist', () => {
  it('offers an explicit create row carrying the raw text', () => {
    setup();
    fireEvent.change(input(), { target: { value: 'Lilac' } });
    expect(screen.getByTestId('cb-create')).toHaveTextContent('Lilac');
    expect(screen.queryAllByTestId('cb-option')).toHaveLength(0);
  });

  it('does not commit the typed text until the create row is chosen', () => {
    const { onChange } = setup();
    fireEvent.change(input(), { target: { value: 'Lilac' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('cb-create'));
    expect(onChange).toHaveBeenCalledWith('Lilac');
  });

  it('commits on Enter, because the create row is highlighted by default', () => {
    const { onChange } = setup();
    fireEvent.change(input(), { target: { value: 'Lilac' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Lilac');
  });

  it('reverts to the committed value when the field is left without choosing', () => {
    // Typing alone must never invent an attribute value — this is the bug.
    const { onChange } = setup({ value: 'Pink' });
    fireEvent.change(input(), { target: { value: 'Lilc' } }); // typo, no match
    fireEvent.blur(input());
    expect(onChange).not.toHaveBeenCalled();
    expect(input()).toHaveValue('Pink');
  });

  it('reverts on Escape and closes', () => {
    const { onChange } = setup({ value: 'Pink' });
    fireEvent.change(input(), { target: { value: 'Lil' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(input()).toHaveValue('Pink');
    expect(screen.queryByTestId('cb-list')).not.toBeInTheDocument();
  });

  it('offers no create row when the caller forbids it', () => {
    setup({ allowCreate: false });
    fireEvent.change(input(), { target: { value: 'Lilac' } });
    expect(screen.queryByTestId('cb-create')).not.toBeInTheDocument();
    expect(screen.getByTestId('cb-empty')).toBeInTheDocument();
  });

  it('treats whitespace-only text as nothing to create', () => {
    setup();
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(screen.queryByTestId('cb-create')).not.toBeInTheDocument();
  });

  it('clearing the field commits the empty value', () => {
    // Colour/Cultivar are optional, and a blank one is a real, distinct identity
    // under ADR-0006 — so the owner must be able to erase one.
    const { onChange } = setup({ value: 'Pink' });
    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('ValueCombobox — nothing to pick from', () => {
  it('is an honest plain text box when there are no options', () => {
    const { onChange } = setup({ options: [] });
    fireEvent.click(input());
    expect(screen.queryByTestId('cb-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cb-toggle')).not.toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'Lilac' } });
    fireEvent.blur(input());
    expect(onChange).toHaveBeenCalledWith('Lilac');
  });

  it('keeps a numeric keypad for numeric fields', () => {
    setup({ numeric: true, options: [] });
    expect(input()).toHaveAttribute('inputmode', 'numeric');
  });
});

describe('ValueCombobox — externally driven value', () => {
  it('shows a value set by the parent after mount', () => {
    const { rerender, onChange } = setup();
    rerender(
      <ValueCombobox value="Coral" onChange={onChange} options={COLOURS} testId="cb" t={t} />,
    );
    expect(input()).toHaveValue('Coral');
  });
});
