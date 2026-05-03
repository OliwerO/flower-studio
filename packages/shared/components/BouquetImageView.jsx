import { useState } from 'react';

// Read-only bouquet image surface for the driver delivery card.
// Tap → fullscreen modal so the driver can zoom in.

export default function BouquetImageView({ imageUrl, label = 'Букет' }) {
  const [zoomed, setZoomed] = useState(false);
  if (!imageUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setZoomed(true); }}
        className="flex items-center gap-2 w-full text-left active-scale"
      >
        <img
          src={imageUrl}
          alt={label}
          className="w-16 h-16 rounded-lg object-cover border border-gray-200"
        />
        <span className="text-sm text-ios-tertiary">{label}</span>
      </button>
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); setZoomed(false); }}
        >
          <img src={imageUrl} alt={label} className="max-w-full max-h-full" />
        </div>
      )}
    </>
  );
}
