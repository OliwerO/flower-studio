/**
 * OrderTerminationConfirm — inline-card confirm UI for order cancellation
 * (and, in slice 4, deletion).
 *
 * Render when flow.confirmOpen is true. Consumes the hook return value
 * directly so markup wires to hook methods without any intermediate state.
 *
 * Visual delta from the pre-migration inline confirm in OrderCard.jsx: zero.
 * Tailwind classes are verbatim from lines 854-874 of OrderCard.jsx.
 *
 * Props:
 *   flow       — useOrderTerminationFlow() return value
 *   t          — host translations object (cancelConfirm, cancelAndReturn,
 *                cancelNoReturn, cancel required)
 *   allowDelete — boolean (default false). Slice 4 will use this to render
 *                 a delete-mode copy variant when pendingKind === 'delete'.
 */
export default function OrderTerminationConfirm({ flow, t, allowDelete = false }) {
  const { cancelWithReturn, cancelOnly, dismiss, saving } = flow;

  return (
    <div className="mt-2 ios-card p-3 space-y-2">
      <p className="text-xs font-semibold text-ios-red">{t.cancelConfirm}</p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={cancelWithReturn}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-40"
        >
          {t.cancelAndReturn}
        </button>
        <button
          onClick={cancelOnly}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-ios-red text-white text-xs font-semibold disabled:opacity-40"
        >
          {t.cancelNoReturn}
        </button>
        <button
          onClick={dismiss}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg bg-gray-100 text-xs disabled:opacity-40"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}
