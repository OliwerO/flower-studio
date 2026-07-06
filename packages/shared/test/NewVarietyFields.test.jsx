// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewVarietyFields from '../components/NewVarietyFields.jsx';

const t = { flowerType: 'Type', flowerColour: 'Colour', flowerCultivar: 'Cultivar', flowerSizeCm: 'Size cm' };
const stockItems = [
  { 'Type': 'Rose', 'Colour': 'Red', 'Cultivar': 'Freedom' },
  { type_name: 'Peony', colour: 'Pink', cultivar: 'Sarah Bernhardt' },
  { 'Type': 'Rose', 'Colour': 'White' },
];

describe('NewVarietyFields', () => {
  it('renders the four Variety inputs with Type marked required', () => {
    render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} />);
    expect(screen.getByTestId('nv-type')).toHaveAttribute('placeholder', 'Type *');
    expect(screen.getByTestId('nv-colour')).toBeInTheDocument();
    expect(screen.getByTestId('nv-cultivar')).toBeInTheDocument();
    expect(screen.getByTestId('nv-size')).toBeInTheDocument();
  });

  it('derives de-duplicated, sorted datalist suggestions from stock (dual-read Pascal/snake)', () => {
    const { container } = render(<NewVarietyFields form={{}} onChange={() => {}} t={t} stockItems={stockItems} idPrefix="x" />);
    const opts = (id) => [...container.querySelectorAll(`#x-${id} option`)].map(o => o.value);
    expect(opts('types')).toEqual(['Peony', 'Rose']);       // deduped + sorted
    expect(opts('colours')).toEqual(['Pink', 'Red', 'White']);
    expect(opts('cultivars')).toEqual(['Freedom', 'Sarah Bernhardt']);
  });

  it('propagates edits through onChange as a functional updater', () => {
    const onChange = vi.fn();
    render(<NewVarietyFields form={{ typeName: '' }} onChange={onChange} t={t} stockItems={[]} />);
    fireEvent.change(screen.getByTestId('nv-colour'), { target: { value: 'Coral' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    // updater merges into prior form state
    const updater = onChange.mock.calls[0][0];
    expect(updater({ typeName: 'Rose' })).toEqual({ typeName: 'Rose', colour: 'Coral' });
  });

  it('shows current form values', () => {
    render(<NewVarietyFields form={{ typeName: 'Tulip', colour: 'Yellow', sizeCm: '40', cultivar: 'X' }} onChange={() => {}} t={t} stockItems={[]} />);
    expect(screen.getByTestId('nv-type')).toHaveValue('Tulip');
    expect(screen.getByTestId('nv-colour')).toHaveValue('Yellow');
    expect(screen.getByTestId('nv-size')).toHaveValue(40);
    expect(screen.getByTestId('nv-cultivar')).toHaveValue('X');
  });
});
