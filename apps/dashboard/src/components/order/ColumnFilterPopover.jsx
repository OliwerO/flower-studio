// Moved to packages/shared so the Y-model Stock Flat table can reuse the same
// per-column filter shell as the Orders table (one source of truth). This file
// stays as a re-export so existing `./order/ColumnFilterPopover` imports keep
// working.
export { ColumnFilterPopover as default } from '@flower-studio/shared';
