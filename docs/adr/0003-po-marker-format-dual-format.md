# Stock purchase notes embed the human-readable PO number (not the record ID)

Purchase records created by the Stock Order evaluation flow carry a notes marker used for idempotency and the stock usage trace:

```
PO #<po-number> L#<line-id> primary|alt
```

Before Phase 7 (Airtable era), both IDs were Airtable record IDs (`recXXX`):

```
PO #recABC123 L#recDEF456 primary
```

After Phase 7 (Postgres era), the PO reference is the human-readable PO number; the line reference is the Postgres UUID:

```
PO #PO-20260508-1 L#550e8400-e29b-41d4-a716-446655440000 primary
```

These two formats coexist permanently in `stock_purchases.notes`. Historical records (created before Phase 7) retain the `recXXX` format; they are never rewritten.

## Why the format changed

The pre-Phase-7 format required a separate Airtable lookup to resolve the `recXXX` PO ID to a display name for the stock usage trace. Once Airtable is retired, that lookup path dies — the usage trace would fall back to showing a raw `recXXX` string with no context. Embedding the human-readable PO number makes the marker self-describing and eliminates the lookup entirely.

## Considered alternatives

**Keep `recXXX` format, resolve via Postgres.** Lookup by `airtable_id` would work for backfilled POs. Rejected because new POs have no `recXXX` — they only have UUIDs, which are meaningless to a human reading the trace.

**Embed UUID.** Same problem — unreadable in the usage trace without a join.

## Consequences

- Code that parses `stock_purchases.notes` must handle both formats. The regex `PO #([A-Za-z0-9_-]+)\s+L#([A-Za-z0-9_-]+)\s+(primary|alt)` matches both. Historical records with `recXXX` will produce an empty `poDisplayId` after Airtable retirement (the Airtable lookup silently fails); the trace falls back to the raw `notes` string.
- `stockPurchasesRepo.noteMarkerExists()` and `findDateByPoMarker()` use a `LIKE` prefix search — both formats match correctly since both start with `PO #`.
- The idempotency marker must remain stable across retries. The PO number and line UUID are both stable once created, so retries produce the same marker.

## Extended to write-offs (2026-07-07)

The receive side (`stock_purchases`) had marker-gated idempotency from day one; the write-off side (`stock_loss_log`) did not — write-off logging in the PO evaluate flow was a fire-and-forget promise with no marker, so an Eval Error retry re-ran it and duplicated loss rows (tracked in BACKLOG, closed by this change, landed alongside the `stockOrderService.js` extraction — W2).

Write-off markers follow the same dual-format convention, embedded in `stock_loss_log.notes`:

```
PO #<po-number> L#<line-uuid> primary|alt writeoff
```

e.g. `PO #PO-20260707-1 L#550e8400-e29b-41d4-a716-446655440000 primary writeoff`. The human-readable prefix (`PO evaluation write-off (primary)` / `(substitute)`) stays in front of the marker for the waste-log UI, which displays `Notes` as-is.

- Matched the same way as purchase markers: `stockLossRepo.noteMarkerExists(marker)` does a `LIKE '%marker%'` contains-style match (not a prefix match, since the human-readable prefix varies) — same call shape as `stockPurchasesRepo.noteMarkerExists`.
- `deletedAt` is **deliberately ignored** by `noteMarkerExists` — the idempotency question is "was this write-off ever recorded," not "does an active row currently represent it." A florist manually deleting a mistaken loss-log row must not cause the next PO evaluate retry to silently re-create it.
- Both write-off blocks (primary and alt/substitute) are now **awaited** and placed **inside** the per-line try/catch, before the line is marked `Eval Status: PROCESSED`. A write-off failure now surfaces as a line error → PO → Eval Error → retry, instead of being swallowed by a detached `.catch(console.error)`.
