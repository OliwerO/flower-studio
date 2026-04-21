// Standard list row — 44 px min touch target, leading/title/subtitle/trailing slots.
// Replaces 20+ hand-rolled `flex items-center gap-3 px-4 py-3 border-b` rows
// so row styling stays consistent across Bouquets, Waste Log, etc.
//
// Props:
//   leading     - ReactNode rendered on the left (icon / thumbnail / avatar)
//   title       - string or ReactNode, primary text
//   subtitle    - optional secondary text beneath title
//   trailing    - ReactNode on the right (chevron, badge, toggle)
//   onPress     - click handler; if present, row is button-like (active-scale)
//   destructive - boolean; red title color (for delete confirmations etc.)
//   className   - extra classes merged onto the row

export default function ListItem({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  destructive = false,
  className = '',
  ...rest
}) {
  const isButton = typeof onPress === 'function';
  const Component = isButton ? 'button' : 'div';
  const titleColor = destructive
    ? 'text-ios-red'
    : 'text-ios-label dark:text-dark-label';
  const interactive = isButton ? 'active:bg-gray-50 dark:active:bg-dark-card/60 active-scale' : '';

  return (
    <Component
      onClick={onPress}
      className={`w-full min-h-[44px] flex items-center gap-3 px-4 py-3 text-left ${interactive} ${className}`}
      {...rest}
    >
      {leading != null && <div className="shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium truncate ${titleColor}`}>{title}</div>
        {subtitle && (
          <div className="text-xs text-ios-tertiary dark:text-dark-tertiary truncate mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
      {trailing != null && <div className="shrink-0">{trailing}</div>}
    </Component>
  );
}
