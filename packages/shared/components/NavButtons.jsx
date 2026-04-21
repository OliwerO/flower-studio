import { googleMapsUrl, wazeUrl, appleMapsUrl } from '../utils/navigation.js';

// Three-up nav strip: Google Maps, Waze, Apple Maps.
// Renders nothing when the address is empty so the driver card
// doesn't show dead buttons for pickup-only orders.
export default function NavButtons({ address, className = '' }) {
  if (!address) return null;
  const stop = e => e.stopPropagation();
  const base = 'flex-1 text-center px-3 py-2 rounded-xl text-xs font-semibold active-scale';

  return (
    <div className={`flex gap-2 ${className}`}>
      <a
        onClick={stop}
        href={googleMapsUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-blue-50 text-blue-700`}
      >
        Google
      </a>
      <a
        onClick={stop}
        href={wazeUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-cyan-50 text-cyan-700`}
      >
        Waze
      </a>
      <a
        onClick={stop}
        href={appleMapsUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-gray-100 text-gray-800`}
      >
        Apple
      </a>
    </div>
  );
}
