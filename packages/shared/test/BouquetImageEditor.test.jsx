// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';

const mockShowToast = vi.fn();
vi.mock('../context/ToastContext.jsx', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('../api/uploadImage.js', () => ({
  uploadBouquetImage: vi.fn().mockResolvedValue({ imageUrl: 'https://static/new.jpg' }),
  removeBouquetImage: vi.fn().mockResolvedValue({ ok: true }),
  uploadOrderImage: vi.fn().mockResolvedValue({ imageUrl: 'https://static/new.jpg' }),
  removeOrderImage: vi.fn().mockResolvedValue({ ok: true }),
}));

import BouquetImageEditor from '../components/BouquetImageEditor.jsx';
import { uploadBouquetImage, removeBouquetImage } from '../api/uploadImage.js';

function stubClipboard(imageBlob = null) {
  const mockRead = imageBlob
    ? vi.fn().mockResolvedValue([{
        types: [imageBlob.type],
        getType: vi.fn().mockResolvedValue(imageBlob),
      }])
    : vi.fn().mockResolvedValue([{ types: ['text/plain'], getType: vi.fn() }]);
  Object.defineProperty(navigator, 'clipboard', {
    value: { read: mockRead },
    writable: true,
    configurable: true,
  });
  return mockRead;
}

function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

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

  describe('clipboard paste button', () => {
    afterEach(() => { removeClipboard(); });

    it('shows clipboard button when navigator.clipboard.read is available', () => {
      stubClipboard();
      render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
      expect(screen.getByTestId('clipboard-paste-btn')).toBeTruthy();
    });

    it('hides clipboard button when navigator.clipboard is unavailable', () => {
      removeClipboard();
      render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
      expect(screen.queryByTestId('clipboard-paste-btn')).toBeNull();
    });

    it('reads image from clipboard and uploads on button click', async () => {
      const onChange = vi.fn();
      const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
      stubClipboard(blob);
      render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={onChange} />);
      fireEvent.click(screen.getByTestId('clipboard-paste-btn'));
      await waitFor(() => expect(uploadBouquetImage).toHaveBeenCalled());
      await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://static/new.jpg'));
    });

    it('shows error toast when clipboard has no image', async () => {
      stubClipboard(null);
      render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
      fireEvent.click(screen.getByTestId('clipboard-paste-btn'));
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/буфере нет/i), 'error'));
    });

    it('shows permission denied toast on NotAllowedError', async () => {
      const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      Object.defineProperty(navigator, 'clipboard', {
        value: { read: vi.fn().mockRejectedValue(err) },
        writable: true, configurable: true,
      });
      render(<BouquetImageEditor wixProductId="p1" currentUrl="" canRemove={false} onChange={() => {}} />);
      fireEvent.click(screen.getByTestId('clipboard-paste-btn'));
      await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.stringMatching(/доступа/i), 'error'));
    });
  });
});
