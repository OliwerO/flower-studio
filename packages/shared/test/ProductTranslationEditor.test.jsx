import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductTranslationEditor from '../components/ProductTranslationEditor.jsx';

// Mock the shared client so no network call fires.
vi.mock('../api/client.js', () => ({
  default: { post: vi.fn(() => Promise.resolve({ data: { en: 'Rose', pl: 'Róża', ru: 'Роза', uk: 'Троянда' } })) },
}));
import apiClient from '../api/client.js';

const t = {
  prodDescription: 'Description', prodHasTranslations: 'Translated', edit: 'Edit',
  prodTranslate: 'Translate', prodTranslating: 'Translating...', save: 'Save',
  prodNamePlaceholder: 'Product name (English)', prodDescriptionHint: 'Hint',
};

function makeGroup(overrides = {}) {
  return {
    name: 'Old Name',
    variants: [{ id: 'v1', Description: '', Translations: {}, ...overrides }],
  };
}

describe('ProductTranslationEditor', () => {
  beforeEach(() => { apiClient.post.mockClear(); });

  it('collapsed view shows description and an edit button', () => {
    render(<ProductTranslationEditor group={makeGroup({ Description: 'A red rose' })} onUpdateAll={vi.fn()} t={t} />);
    expect(screen.getByText('A red rose')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('save commits Product Name, Description and Translations via onUpdateAll', () => {
    const onUpdateAll = vi.fn();
    render(<ProductTranslationEditor group={makeGroup()} onUpdateAll={onUpdateAll} t={t} />);
    fireEvent.click(screen.getByText('Edit'));
    const nameInput = screen.getByPlaceholderText('Product name (English)');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText('Save'));
    const fields = onUpdateAll.mock.calls.map(c => c[1]);
    expect(fields).toContain('Product Name');
    expect(fields).toContain('Description');
    expect(fields).toContain('Translations');
    const nameCall = onUpdateAll.mock.calls.find(c => c[1] === 'Product Name');
    expect(nameCall[2]).toBe('New Name');
  });

  it('translate calls /products/translate with the edited EN title', async () => {
    const onUpdateAll = vi.fn();
    render(<ProductTranslationEditor group={makeGroup()} onUpdateAll={onUpdateAll} t={t} />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByPlaceholderText('Product name (English)'), { target: { value: 'Rose' } });
    fireEvent.click(screen.getByText('Translate'));
    expect(apiClient.post).toHaveBeenCalledWith('/products/translate', { text: 'Rose', type: 'title' });
  });
});
