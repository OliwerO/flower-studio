import { useRef, useState, useEffect, useCallback } from 'react';
import { uploadBouquetImage, removeBouquetImage } from '../api/uploadImage.js';
import { useToast } from '../context/ToastContext.jsx';

// Bouquet image slot used by florist + dashboard product cards.
//
// Two input methods:
//   1. Click → opens native file picker (camera+library on phones)
//   2. Paste while focused → reads image from clipboard (desktop)
//
// Single-image semantic: upload replaces the existing image. Remove is
// owner-only (controlled via `canRemove`). The component shows an
// optimistic preview during upload and reverts on error.

const PASTE_LABEL_RU = 'Вставьте или выберите фото';
const REMOVE_LABEL_RU = 'Удалить';
const REMOVE_CONFIRM_RU = 'Удалить это фото?';

export default function BouquetImageEditor({
  wixProductId,
  currentUrl,
  canRemove,
  onChange,
}) {
  const fileInputRef = useRef(null);
  const containerRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  let toast;
  try { ({ showToast: toast } = useToast()); } catch { toast = () => {}; }

  useEffect(() => { setPreviewUrl(currentUrl || ''); }, [currentUrl]);

  const handleFile = useCallback(async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      toast?.('JPG, PNG или WebP', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast?.('Максимум 10 МБ (будет сжато до ~500 КБ)', 'error');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPreviewUrl(localUrl);
    setUploading(true);
    setProgress(0);
    try {
      const { imageUrl } = await uploadBouquetImage({
        wixProductId,
        file,
        onProgress: setProgress,
      });
      setPreviewUrl(imageUrl);
      onChange?.(imageUrl);
      toast?.('Фото обновлено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось загрузить';
      toast?.(msg, 'error');
      setPreviewUrl(currentUrl || '');
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localUrl);
    }
  }, [wixProductId, currentUrl, onChange, toast]);

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
      await removeBouquetImage(wixProductId);
      setPreviewUrl('');
      onChange?.('');
      toast?.('Фото удалено', 'success');
    } catch (err) {
      const msg = err?.response?.data?.error || err.message || 'Не удалось удалить';
      toast?.(msg, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className="relative rounded-xl border border-gray-200 overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-400"
      onClick={() => !uploading && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
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
  );
}
