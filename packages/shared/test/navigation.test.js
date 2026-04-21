import { describe, it, expect } from 'vitest';
import { googleMapsUrl, wazeUrl, appleMapsUrl } from '../utils/navigation.js';

const ADDRESS = 'ul. Floriańska 5, 31-019 Kraków';
const ENCODED = encodeURIComponent(ADDRESS);

describe('googleMapsUrl', () => {
  it('URL-encodes Polish diacritics', () => {
    expect(googleMapsUrl(ADDRESS))
      .toBe(`https://www.google.com/maps/search/?api=1&query=${ENCODED}`);
  });

  it('returns null for empty input', () => {
    expect(googleMapsUrl('')).toBeNull();
    expect(googleMapsUrl(null)).toBeNull();
    expect(googleMapsUrl(undefined)).toBeNull();
  });
});

describe('wazeUrl', () => {
  it('builds a text-search navigate link', () => {
    expect(wazeUrl(ADDRESS))
      .toBe(`https://waze.com/ul?q=${ENCODED}&navigate=yes`);
  });

  it('returns null for empty input', () => {
    expect(wazeUrl('')).toBeNull();
  });
});

describe('appleMapsUrl', () => {
  it('builds an Apple Maps query URL', () => {
    expect(appleMapsUrl(ADDRESS))
      .toBe(`https://maps.apple.com/?q=${ENCODED}`);
  });

  it('returns null for empty input', () => {
    expect(appleMapsUrl('')).toBeNull();
  });
});
