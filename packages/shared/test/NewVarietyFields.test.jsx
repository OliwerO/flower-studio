// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewVarietyFields from '../components/NewVarietyFields.jsx';

const t = { flowerType: 'Type', flowerColour: 'Colour', flowerCultivar: 'Cultivar', flowerSizeCm: 'Size cm' };
const stockItems = [
  { 'Type': 'Rose', 'Colour': 'Red', 'Cultivar': 'Freedom', 'Size': 60 },
  { type_name: 'Peony', colour: 'Pink', cultivar: 'Sarah Bernhardt', size_cm: 50 },
  { 'Type': 'Rose', 'Colour': 'White', 'Size': 60 },
];

const openList = (id) => fireEvent.click(screen.getByTestId(`${id}-toggle`));
const listed = (id) => screen.getAllByTestId(`${id}-option`).map((o) => o.textContent);

describe('NewVarietyFields', () => {
  it('renders the four Variety inputs with Type marked required', () => {
    render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} />);
    expect(screen.getByTestId('nv-type')).toHaveAttribute('placeholder', 'Type *');
    expect(screen.getByTestId('nv-colour')).toBeInTheDocument();
    expect(screen.getByTestId('nv-cultivar')).toBeInTheDocument();
    expect(screen.getByTestId('nv-size')).toBeInTheDocument();
  });

  it('offers each attribute as a real list, de-duplicated and sorted (dual-read Pascal/snake)', () => {
    render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} />);
    openList('nv-type');
    expect(listed('nv-type')).toEqual(['Peony', 'Rose']);
    openList('nv-colour');
    expect(listed('nv-colour')).toEqual(['Pink', 'Red', 'White']);
    openList('nv-cultivar');
    expect(listed('nv-cultivar')).toEqual(['Freedom', 'Sarah Bernhardt']);
  });

  it('suggests the sizes already in stock, numerically sorted', () => {
    render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} />);
    openList('nv-size');
    expect(listed('nv-size')).toEqual(['50', '60']);
  });

  it('lets the caller narrow the size list to one Variety (the PO line form does)', () => {
    render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} sizeOptions={[70]} />);
    openList('nv-size');
    expect(listed('nv-size')).toEqual(['70']);
  });

  it('propagates a picked value through onChange as a functional updater', () => {
    const onChange = vi.fn();
    render(<NewVarietyFields form={{ typeName: '' }} onChange={onChange} t={t} stockItems={stockItems} />);
    openList('nv-colour');
    fireEvent.click(screen.getByText('Red'));
    expect(onChange).toHaveBeenCalledTimes(1);
    // updater merges into prior form state
    const updater = onChange.mock.calls[0][0];
    expect(updater({ typeName: 'Rose' })).toEqual({ typeName: 'Rose', colour: 'Red' });
  });

  it('will not let a typed near-miss become a second Colour', () => {
    // `white` must snap to the stored `White`, never create a rival value.
    const onChange = vi.fn();
    render(<NewVarietyFields form={{}} onChange={onChange} t={t} stockItems={stockItems} />);
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'white' } });
    fireEvent.blur(screen.getByTestId('nv-colour'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]({})).toEqual({ colour: 'White' });
  });

  it('still allows a genuinely new value, but only on a deliberate choice', () => {
    const onChange = vi.fn();
    render(<NewVarietyFields form={{}} onChange={onChange} t={t} stockItems={stockItems} />);
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Dahlia' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('nv-type-create'));
    expect(onChange.mock.calls[0][0]({})).toEqual({ typeName: 'Dahlia' });
  });

  it('shows current form values', () => {
    render(<NewVarietyFields form={{ typeName: 'Tulip', colour: 'Yellow', sizeCm: '40', cultivar: 'X' }} onChange={() => {}} t={t} stockItems={[]} />);
    expect(screen.getByTestId('nv-type')).toHaveValue('Tulip');
    expect(screen.getByTestId('nv-colour')).toHaveValue('Yellow');
    expect(screen.getByTestId('nv-size')).toHaveValue(40);
    expect(screen.getByTestId('nv-cultivar')).toHaveValue('X');
  });

  it('is a plain text box on an empty catalogue — there is nothing to pick', () => {
    const onChange = vi.fn();
    render(<NewVarietyFields form={{}} onChange={onChange} t={t} stockItems={[]} />);
    expect(screen.queryByTestId('nv-type-toggle')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('nv-type'), { target: { value: 'Rose' } });
    fireEvent.blur(screen.getByTestId('nv-type'));
    expect(onChange.mock.calls[0][0]({})).toEqual({ typeName: 'Rose' });
  });
});
