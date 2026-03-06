// MapView — shows all active deliveries with "Open all stops in Google Maps" button.
// Builds a multi-waypoint URL: Google Maps handles route optimization.
//
// Think of it as a route planning sheet: lists all stops in order,
// then gives the driver one button to open the full route in their Maps app.
//
// Trade-off: No embedded map (would need a Google Maps API key). Instead, we list
// the stops and build a URL that opens Google Maps natively. Simple + no cost.

import { useState, useEffect } from 'react';
import t from '../translations.js';

export default function MapView({ deliveries, onBack }) {
  // Driver's live GPS position — used as the route origin ("You are here")
  const [driverPos, setDriverPos] = useState(null);
  const [geoStatus, setGeoStatus] = useState('loading'); // loading | granted | denied

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoStatus('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDriverPos(`${pos.coords.latitude},${pos.coords.longitude}`);
        setGeoStatus('granted');
      },
      () => setGeoStatus('denied'),
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }, []);

  // Sort by time for the route order
  const sorted = [...deliveries].sort(
    (a, b) => (a['Delivery Time'] || '').localeCompare(b['Delivery Time'] || '')
  );

  // Build Google Maps multi-waypoint URL
  // When we have driver GPS → origin = driver location, all addresses become waypoints + destination
  // Without GPS → first address is origin (fallback)
  function buildMapsUrl() {
    const addresses = sorted
      .map(d => d['Delivery Address'])
      .filter(Boolean);

    if (addresses.length === 0) return null;
    if (addresses.length === 1 && !driverPos) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`;
    }

    // With driver position: origin = GPS, all delivery addresses are stops
    // Without: origin = first address, rest are stops (original behavior)
    const origin = driverPos
      ? encodeURIComponent(driverPos)
      : encodeURIComponent(addresses[0]);
    const stopAddresses = driverPos ? addresses : addresses.slice(1);
    const destination = encodeURIComponent(stopAddresses[stopAddresses.length - 1] || addresses[0]);
    const waypoints = stopAddresses.slice(0, -1).map(encodeURIComponent).join('|');

    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypoints) url += `&waypoints=${waypoints}`;
    return url;
  }

  const mapsUrl = buildMapsUrl();

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="glass-nav sticky top-0 z-30 px-4 py-3">
        <div className="flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-sm text-brand-600 font-medium active:opacity-70"
          >
            ← Back
          </button>
          <h1 className="text-lg font-bold text-ios-label">🗺 {t.viewOnMap}</h1>
          <div className="w-12" /> {/* spacer for centering */}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {sorted.length === 0 ? (
          <p className="text-center text-ios-tertiary py-16">{t.noDeliveries}</p>
        ) : (
          <>
            {/* Stop list */}
            <p className="ios-label">Route stops ({sorted.length})</p>
            <div className="ios-card overflow-hidden divide-y divide-white/40">
              {/* Driver's current location as first stop */}
              {driverPos && (
                <div className="flex items-center gap-3 px-4 py-3 bg-white/20">
                  <div className="w-7 h-7 rounded-full bg-ios-green text-white text-xs font-bold
                                  flex items-center justify-center shrink-0">
                    📍
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ios-label">{t.yourLocation}</p>
                    <p className="text-xs text-ios-tertiary">{t.routeStart}</p>
                  </div>
                </div>
              )}
              {geoStatus === 'loading' && (
                <div className="flex items-center gap-3 px-4 py-3 bg-white/10">
                  <div className="w-7 h-7 rounded-full bg-ios-separator animate-pulse shrink-0" />
                  <p className="text-xs text-ios-tertiary">{t.locating}</p>
                </div>
              )}
              {sorted.map((d, i) => {
                const status = d['Status'] || 'Pending';
                const dotColor = status === 'Out for Delivery' ? 'bg-ios-blue' : 'bg-ios-orange';
                const address = d['Delivery Address'] || 'No address';
                const singleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

                return (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                    {/* Stop number */}
                    <div className={`w-7 h-7 rounded-full ${dotColor} text-white text-xs font-bold
                                    flex items-center justify-center shrink-0`}>
                      {i + 1}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ios-label truncate">
                        {d['Recipient Name'] || 'Unknown'}
                      </p>
                      <a
                        href={singleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-ios-blue active:underline truncate block"
                      >
                        📍 {address}
                      </a>
                    </div>

                    {/* Time badge */}
                    {d['Delivery Time'] && (
                      <span className="text-xs text-ios-tertiary font-medium shrink-0">
                        {d['Delivery Time']}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Open all stops button */}
      {mapsUrl && (
        <div className="fixed bottom-0 left-0 right-0 z-20 p-4 pb-6 bg-gradient-to-t from-[#F2CAD5] to-transparent">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-12 rounded-2xl bg-brand-600 text-white text-sm font-semibold
                       flex items-center justify-center gap-2 active:bg-brand-700 active-scale shadow-lg"
          >
            🗺 {t.openAllStops}
          </a>
        </div>
      )}
    </div>
  );
}
