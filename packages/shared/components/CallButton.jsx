import { telHref } from '../utils/phone.js';

// A click-to-call pill. Renders nothing if no phone is provided so
// consumers can always mount it conditionally-free.
// stopPropagation() keeps the parent card (which is often the expand
// target) from also toggling when the user taps the button.
export default function CallButton({
  phone,
  label,
  icon = '📞',
  className = '',
  variant = 'solid',
}) {
  const href = telHref(phone);
  if (!href) return null;

  const base = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold active-scale whitespace-nowrap';
  const styles = variant === 'subtle'
    ? 'bg-ios-green/10 text-ios-green'
    : 'bg-ios-green text-white';

  return (
    <a
      href={href}
      onClick={e => e.stopPropagation()}
      className={`${base} ${styles} ${className}`}
    >
      <span>{icon}</span>
      <span className="truncate">{label || phone}</span>
    </a>
  );
}
