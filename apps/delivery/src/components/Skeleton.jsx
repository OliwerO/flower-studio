// Skeleton — shimmer placeholders for loading states.

export function DeliveryCardSkeleton() {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-5 w-20 rounded-full bg-gray-200" />
        <div className="ml-auto h-5 w-14 rounded bg-gray-200" />
      </div>
      <div className="h-4 w-48 rounded bg-gray-200" />
      <div className="h-4 w-36 rounded bg-gray-100" />
      <div className="h-10 w-full rounded-xl bg-gray-100" />
    </div>
  );
}

export function DeliveryListSkeleton({ count = 3 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <DeliveryCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function StockPickupSkeleton({ count = 4 }) {
  return (
    <div className="space-y-4 animate-pulse">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-white rounded-2xl shadow-sm px-4 py-4 space-y-2">
          <div className="h-4 w-32 rounded bg-gray-200" />
          <div className="h-3 w-48 rounded bg-gray-100" />
          <div className="flex gap-2 mt-2">
            <div className="h-9 w-24 rounded-lg bg-gray-100" />
            <div className="h-9 w-24 rounded-lg bg-gray-100" />
            <div className="h-9 w-24 rounded-lg bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
