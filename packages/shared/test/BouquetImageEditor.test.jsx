// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('../api/uploadImage.js', () => ({
  uploadBouquetImage: vi.fn().mockResolvedValue({ imageUrl: 'https://static/new.jpg' }),
  removeBouquetImage: vi.fn().mockResolvedValue({ ok: true }),
}));

import BouquetImageEditor from '../components/BouquetImageEditor.jsx';
import { uploadBouquetImage, removeBouquetImage } from '../api/uploadImage.js';

beforeEach(() => { vi.clearAllMocks(); });
// Vitest doesn't auto-cleanup testing-library renders unless `globals: true`,
// so each test would otherwise mount on top of the previous DOM and break
// `getByTestId` with "multiple elements found".
afterEach(() => { cleanup(); });

describe('BouquetImageEditor', () => {
  it('renders empty state with paste/pick prompt when no currentUrl', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
    expect(screen.getByText(/paste|вставьте/i)).toBeTruthy();
  });

  it('shows current image when currentUrl set', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={false} onChange={() => {}} />);
    expect(screen.getByRole('img').getAttribute('src')).toBe('https://static/a.jpg');
  });

  it('uploads on file pick and calls onChange with new URL', async () => {
    const onChange = vi.fn();
    render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={onChange} />);
    const file = new File([new Uint8Array([1])], 'b.png', { type: 'image/png' });
    const input = screen.getByTestId('bouquet-image-file-input');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadBouquetImage).toHaveBeenCalled());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://static/new.jpg'));
  });

  it('hides remove control when canRemove=false', () => {
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={false} onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /remove|удалить/i })).toBeNull();
  });

  it('shows remove control when canRemove=true and triggers DELETE on confirm', async () => {
    const onChange = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<BouquetImageEditor wixProductId="p1" currentUrl="https://static/a.jpg" canRemove={true} onChange={onChange} />);
    const btn = screen.getByRole('button', { name: /remove|удалить/i });
    fireEvent.click(btn);
    await waitFor(() => expect(removeBouquetImage).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });
});
