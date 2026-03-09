// Skeleton — shimmer placeholder shown while data loads.
// Like a shadow board in lean manufacturing: shows where things go before they arrive.

export function SkeletonLine({ width = 'w-full', height = 'h-4' }) {
  return (
    <div className={`${width} ${height} rounded-lg bg-gray-200 animate-pulse`} />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-4 space-y-3 animate-pulse">
      <div className="h-3 w-24 rounded bg-gray-200" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="rounded-xl bg-gray-50 px-3 py-4 space-y-2">
            <div className="h-6 w-16 rounded bg-gray-200" />
            <div className="h-3 w-12 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm px-4 py-4 space-y-2 animate-pulse">
      <div className="h-3 w-32 rounded bg-gray-200 mb-4" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-4 py-2">
          {Array.from({ length: cols }, (_, j) => (
            <div key={j} className={`h-4 rounded bg-gray-100 ${j === 0 ? 'w-32' : 'w-16'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Full dashboard skeleton — 4 summary cards + 2 sections
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonTable />
    </div>
  );
}
