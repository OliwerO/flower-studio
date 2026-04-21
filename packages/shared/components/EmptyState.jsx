// Shared empty-state placeholder for lists.
// Keeps "no orders / no waste entries / no results" messaging visually consistent.
//
// Props:
//   icon        - ReactNode (lucide icon or emoji element)
//   title       - main line
//   description - optional secondary line
//   action      - optional ReactNode (button / link) below the text

export default function EmptyState({ icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-6 ${className}`}>
      {icon && (
        <div className="mb-4 text-ios-tertiary dark:text-dark-tertiary">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-ios-label dark:text-dark-label">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-ios-tertiary dark:text-dark-tertiary max-w-xs">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
