// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import VarietyIdentity from '../components/VarietyIdentity.jsx';

const variety = { type_name: 'Rose', colour: 'Pink', size_cm: 60, cultivar: 'Mondial' };

describe('VarietyIdentity', () => {
  it('renders Type + Colour + Size + Cultivar when showType=true', () => {
    render(<VarietyIdentity variety={variety} showType />);
    expect(screen.getByText('Rose')).toBeInTheDocument();
    expect(screen.getByText('Pink')).toBeInTheDocument();
    expect(screen.getByText('60cm')).toBeInTheDocument();
    expect(screen.getByText('Mondial')).toBeInTheDocument();
  });

  it('hides Type when showType=false (default) — no DOM leak', () => {
    render(<VarietyIdentity variety={variety} />);
    expect(screen.queryByText('Rose')).not.toBeInTheDocument();
    expect(screen.queryByText(/Rose Pink/)).not.toBeInTheDocument();
    expect(screen.getByText('Pink')).toBeInTheDocument();
    expect(screen.getByText('60cm')).toBeInTheDocument();
    expect(screen.getByText('Mondial')).toBeInTheDocument();
  });

  it('adds the concatenated display name in an sr-only span when srOnlyFullName=true', () => {
    render(<VarietyIdentity variety={variety} showType srOnlyFullName />);
    // Single text node carrying the full combined name — picker test regex relies on this.
    expect(screen.getByText(/Rose Pink 60cm Mondial/)).toBeInTheDocument();
  });

  it('omits the sr-only span by default (Stock list contract)', () => {
    render(<VarietyIdentity variety={variety} />);
    expect(screen.queryByText(/Rose Pink 60cm Mondial/)).not.toBeInTheDocument();
  });

  it('omits cultivar when null', () => {
    render(<VarietyIdentity variety={{ ...variety, cultivar: null }} showType />);
    expect(screen.queryByText('Mondial')).not.toBeInTheDocument();
  });

  it('omits size when null', () => {
    render(<VarietyIdentity variety={{ ...variety, size_cm: null }} showType />);
    expect(screen.queryByText('60cm')).not.toBeInTheDocument();
  });

  it('renders em-dash placeholder when no identity attrs', () => {
    render(<VarietyIdentity variety={{ type_name: null, colour: null, size_cm: null, cultivar: null }} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
