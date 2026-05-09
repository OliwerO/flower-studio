import { useRef, useState, useEffect, useCallback } from 'react';
import { uploadBouquetImage, removeBouquetImage, uploadOrderImage, removeOrderImage } from '../api/uploadImage.js';
import { useToast } from '../context/ToastContext.jsx';

// Bouquet image slot used by florist + dashboard product cards AND by
// order detail screens for per-order overrides.
//
// Two entity modes (mutually exclusive):
//   - wixProductId → POST/DELETE /products/:wixProductId/image
//   - orderId      → POST/DELETE /orders/:orderId/image
//
// Three input methods:
//   1. Click → opens native file picker (camera+library on phones)
//   2. Paste while focused → reads image from clipboard (desktop Ctrl/Cmd+V)
//   3. "Paste from clipboard" button → navigator.clipboard.read() (mobile-friendly)
//
// Single-image semantic: upload replaces the existing image. Remove is
// owner-only (controlled via `canRemove`). The component shows an
// optimistic preview during upload and reverts on error.

const PASTE_LABEL_RU = 'Вставьте или выберите фото';
const CLIPBOARD_LABEL_RU = '📋 Вставить из буфера';
const CLIPBOARD_NO_IMAGE_RU = 'В буфере нет изображения';
const CLIPBOARD_DENIED_RU = 'Нет доступа к буферу обмена';
const REMOVE_LABEL_RU = 'Удалить';
const REMOVE_CONFIRM_RU = 'Удалить это фото?';

export default function BouquetImageEditor({
  wixProductId,
  orderId,
  currentUrl,
  canRemove,
  onChange,
}) {
  const isOrder = Boolean(orderId);
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  // useToast returns a no-op showToast when called outside a ToastProvider
  // (default context value), so this is safe in any tree.
  const { showToast: toast } = useToast();

  useEffect(() => { setPreviewUrl(currentUrl || ''); }, [currentUrl]);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast('JPG, PNG или WebP', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast('Максимум 10 МБ (будет сжато до ~500 КБ)', 'error');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    setProgress(0);
    try {
      const { imageUrl } = isOrder
        ? await uploadOrderImage({ orderId, file, onProgress: setProgress })
        : await uploadBouquetImage({ wixProductId, file, onProgress: setProgress });
      setPreviewUrl(imageUrl);
      onChange?.(imageUrl);
      toast('Фото обновлено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось загрузить';
      toast(msg, 'error');
      setPreviewUrl(currentUrl || '');
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localUrl);
    }
  }, [isOrder, orderId, wixProductId, currentUrl, onChange, toast]);

  const onPaste = useCallback((e) => {
    if (uploading) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        handleFile(item.getAsFile());
        return;
      }
    }
  }, [handleFile, uploading]);

  const onClipboardRead = useCallback(async () => {
    if (uploading) return;
    try {
      const items = await navigator.clipboard.read();
      let found = false;
      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          handleFile(new File([blob], 'clipboard.png', { type: imageType }));
          found = true;
          break;
        }
      }
      if (!found) toast(CLIPBOARD_NO_IMAGE_RU, 'error');
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? CLIPBOARD_DENIED_RU : (err.message || CLIPBOARD_DENIED_RU), 'error');
    }
  }, [uploading, handleFile, toast]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.addEventListener('paste', onPaste);
    return () => node.removeEventListener('paste', onPaste);
  }, [onPaste]);

  const onRemove = async () => {
    const confirmed = window.confirm(REMOVE_CONFIRM_RU);
    if (!confirmed) return;
    setUploading(true);
    try {
      if (isOrder) {
        await removeOrderImage(orderId);
      } else {
        await removeBouquetImage(wixProductId);
      }
      setPreviewUrl('');
      onChange?.('');
      toast('Фото удалено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось удалить';
      toast(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  const supportsClipboardRead = Boolean(navigator.clipboard?.read);

  return (
    <div>
      <div
        ref={containerRef}
        tabIndex={0}
        className="relative rounded-xl border border-gray-200 overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-400"
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        {/*
          No `capture` attr — owner needs the full picker (camera + photo
          library + Files / iCloud Drive). With `capture="environment"`
          mobile browsers jump straight to the camera and never offer the
          library, which is the wrong default for bouquet photos that are
          usually taken in advance and stored on the phone.
          Clipboard paste is wired separately: Ctrl/Cmd+V on the focused
          container (see onPaste), or the button below (onClipboardRead).
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          data-testid="bouquet-image-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Bouquet"
            className="block w-full h-40 object-cover"
          />
        ) : (
          <div className="h-40 flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
            {PASTE_LABEL_RU}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm">
            {progress}%
          </div>
        )}
        {canRemove && previewUrl && !uploading && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute top-2 right-2 px-2 py-1 rounded-full bg-white/90 text-red-600 text-xs font-semibold shadow"
          >
            {REMOVE_LABEL_RU}
          </button>
        )}
      </div>
      {supportsClipboardRead && (
        <button
          type="button"
          data-testid="clipboard-paste-btn"
          onClick={onClipboardRead}
          disabled={uploading}
          className="mt-1.5 w-full text-center text-xs text-gray-400 hover:text-brand-600 py-0.5 disabled:opacity-40 transition-colors"
        >
          {CLIPBOARD_LABEL_RU}
        </button>
      )}
    </div>
  );
}
