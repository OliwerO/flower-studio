// 44×44 px tap target wrapping a single icon (lucide or emoji).
// Used in page headers for back / refresh / menu actions where touch targets
// were previously ~24 px (below iOS HIG recommendation).
//
// Props:
//   children    - icon node (e.g. <ArrowLeft size={22} />)
//   onClick     - handler
//   ariaLabel   - accessibility label (required when icon has no visible text)
//   size        - button dimension in pixels (default 44)
//   variant     - 'plain' | 'tinted' | 'filled' — visual style

export default function IconButton({
  children,
  onClick,
  ariaLabel,
  size = 44,
  variant = 'plain',
  className = '',
  disabled = false,
  ...rest
}) {
  const base = 'inline-flex items-center justify-center rounded-full transition-colors active-scale';
  const variants = {
    plain: 'text-ios-label dark:text-dark-label active:bg-gray-100 dark:active:bg-dark-card',
    tinted: 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 active:bg-brand-100',
    filled: 'bg-brand-600 text-white active:bg-brand-700 shadow-md',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`${base} ${variants[variant] || variants.plain} ${disabled ? 'opacity-50' : ''} ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}
