import { googleMapsUrl, wazeUrl, appleMapsUrl } from '../utils/navigation.js';

// Three-up nav strip: Google Maps, Waze, Apple Maps.
// Renders nothing when the address is empty so the driver card
// doesn't show dead buttons for pickup-only orders.
//
// Colors match each app's brand (blue / cyan / near-black) with white
// text — high contrast so a driver glancing at the phone in bright
// daylight still sees three clear, distinct tap targets.
export default function NavButtons({ address, className = '' }) {
  if (!address) return null;
  const stop = e => e.stopPropagation();
  const base = 'flex-1 text-center px-3 py-2.5 rounded-xl text-sm font-semibold active-scale shadow-sm';

  return (
    <div className={`flex gap-2 ${className}`}>
      <a
        onClick={stop}
        href={googleMapsUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-blue-600 text-white`}
      >
        Google
      </a>
      <a
        onClick={stop}
        href={wazeUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-cyan-500 text-white`}
      >
        Waze
      </a>
      <a
        onClick={stop}
        href={appleMapsUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} bg-gray-900 text-white`}
      >
        Apple
      </a>
    </div>
  );
}
