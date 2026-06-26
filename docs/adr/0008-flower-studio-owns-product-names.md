---
status: accepted
---

# flower-studio owns Product names (all locales); Wix is downstream

Reverses the prior "Wix owns: product names" convention (comment in `wixProductSync.js`). flower-studio's `product_config.translations` becomes the source of truth for a Product's name in every language: English is the canonical name, with PL/RU/UK translations. The Owner edits names + translations in the Dashboard Products tab (and, as of 2026-06-26, the Florist app — see `docs/superpowers/plans/2026-06-26-florist-products-parity.md`); **Push** writes the English name to the Wix Stores product and the PL/RU/UK names to the Wix Multilingual Translation Content API. Pull no longer imports names for Products that already have local translations.

## Why

Diagnosis (2026-06-26, memory `project_wix_name_translation_gap_2026_06_26`): renaming a Product's English name in Wix does not cascade to its secondary-language names, which live as independent Wix Multilingual `product-name` entries. Nothing maintained those entries — `product_config.translations` was empty for all 341 rows, Pull never imported them, and Push no-op'd on names. Result: the live storefront showed correct English names but stale PL/RU/UK names (e.g. EN "Mix of the Day 1 - XL" vs live PL/RU/UK "…3 - M").

The Owner needs one place to rename a Product and have all four languages update on the live site. Splitting ownership (Wix owns EN, flower-studio owns translations) was considered but rejected: it keeps two editing surfaces and still requires a Pull→re-translate→Push dance after every Wix rename. A single owner of the whole name — the Dashboard — is simpler to operate and to reason about.

## Considered alternatives

- **Model A — Wix owns EN, flower-studio owns PL/RU/UK.** Lower code churn, but leaves renaming split across two systems and needs a Pull-then-translate step after each Wix rename. Rejected for operational friction.
- **One-time Wix cleanup, no code.** Fixes the current stale entries but the gap recurs on the next rename. Rejected — Owner wants a durable fix.

## Consequences

- **Behavior change for the Owner:** rename Products in the Dashboard, then Push. Renaming directly in Wix is no longer the path — a subsequent Push overwrites a Wix-side name edit (Wix is downstream for names).
- **Pull guard:** ongoing Pull must not overwrite `product_name` / `translations` for a Product that already has local translations (`wixProductSync.js` line ~698 is the clobber point). New Products still seed their name from Wix once.
- **One-time seed:** a backfill imports current Wix names (EN Stores name + existing PL/RU/UK Multilingual entries) into `product_config.translations` so existing good translations (roses, vases) are preserved and stale ones (Mix of the day) are surfaced for re-translation. Writes prod `product_config` — run once with Owner approval.
- **Name management is available in both the Dashboard and the Florist app.** The Dashboard Products tab was the original surface; as of 2026-06-26 the Florist app's BouquetsPage reached parity via the shared `ProductTranslationEditor` component (see `docs/superpowers/plans/2026-06-26-florist-products-parity.md`, Task 3). The owner can edit Product names and translations from either surface.
- `product_name` is kept equal to `translations.en.title` (one English name, mirrored for internal grouping/display); grouping remains keyed by `wix_product_id`, so the mirror is safe.
- The Wix order webhook's fuzzy stock match (`wix.js`) keys off the incoming line-item name; pushing the canonical EN name keeps future Wix orders matching as before.
