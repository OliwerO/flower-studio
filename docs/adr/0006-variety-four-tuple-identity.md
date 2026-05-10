# Variety identity is a four-tuple of (Type, Colour, Size, Cultivar) stored inline on Stock Item

The grouping unit for Stock Items is the **Variety**: a four-tuple of (Type, Colour?, Size?, Cultivar?) where Type is required and the other three are optional. Two Stock Items belong to the same Variety when all four fields match exactly, including matching null values (strict identity — empty Colour and Colour="Green" are different Varieties). The four attributes are stored as inline columns on the `stock_items` table, not as a foreign-key reference to a separate `varieties` table.

The Stock list collapses by Variety; the order-line picker returns one row per Variety; aggregation buckets (`onHand`, `planned`, `reservedForPremades`, `net`) are computed per Variety. Stock Items remain the unit of dated identity (one Variety on one date).

## Why

The previous model used free-text Display Names like "Pink Peonies (06.May.)" as the only identifier. Florists could not tell two cultivars apart from the name alone; the Owner mentally held the cultivar mapping. Splitting the identity into structured attributes makes Florist understanding direct, makes traceability across cultivars / sizes possible, and makes per-attribute autocomplete (typing "Pink" returns all pink Varieties) trivial.

The four chosen attributes — Type, Colour, Size, Cultivar — are what Florists and the Owner actually use to describe a flower in conversation. Type and Colour are how the Florist names a flower. Size (stem length in cm) is what differentiates a 50cm Rose from a 70cm Rose for bouquet construction. Cultivar is what the Owner buys at the market and is sometimes what the customer ordered specifically (e.g. "White O'Hara" Rose).

## Considered alternatives

- **Cultivar dictionary in a separate `cultivars` table** — Stock Item references a cultivar row by FK; Type/Colour/Size live on the cultivar row. Rejected for the current PRD scope: it adds a JOIN to every aggregation, requires Owner to register every cultivar before creating a Stock Item, and carries little payoff at the current scale (~30-50 Varieties). The B → C migration is a known refactor (group by cultivar, extract to table, swap FK) and can be done later if cultivar evaluation/substitution UX becomes a pain.
- **Variety registry table** (`flower_varieties` with FK from Stock Item) — same trade-offs as above one level higher; aggregation needs JOINs, every new Variety requires a registry row first. Rejected for symmetry with the inline-cultivar choice.
- **Coalesce empty values to a Type-level default** ("Eucalyptus" with empty Colour treated as Colour="Green" because Eucalyptus's default Colour is Green) — would tolerate inconsistent Owner entry. Rejected because it requires a `flower_type_defaults` config and a coalescing rule that ripples through every aggregation; strict identity is simpler and Owner consistency is encouraged via autocomplete.

## Consequences

- `stock_items` gains four columns: `type_name` (text NOT NULL after backfill), `colour` (text NULL), `size_cm` (integer NULL), `cultivar` (text NULL). Pre-existing rows are backfilled before NOT NULL is applied to `type_name`.
- Display name remains a single string for backwards compatibility but is computed from the attributes when the new code path is on. Render order: `<Type> <Colour> <Size>cm <Cultivar?> (<Date?>)` for the full form; under a Type header, the row drops Type and shows `<Colour> <Size>cm <Cultivar?> (<Date?>)`.
- Aggregation: `getFlowerTypeTotals` (defined in ADR-0005) groups by `(type_name, colour, size_cm, cultivar)` with NULL-aware equality.
- Two distinct Varieties for empty-Colour vs filled-Colour (Eucalyptus null vs Eucalyptus "Green") is a known footgun mitigated by autocomplete suggestions and a future "merge two Varieties" admin tool if drift is observed.
- Cultivar visibility to the Florist is `cultivar IS NOT NULL`. Owner fills cultivar when it matters; leaves empty when it doesn't. Autocomplete prefills Type/Colour/Size when an existing cultivar is selected, making the dataset converge to consistent attributes per cultivar even without DB enforcement.
- Variety creation is Owner-only — the "+ Create new Variety" path in the order-line picker is gated on the Owner role. Florists picking from existing stock never need to create new Varieties.
- A future PRD will add non-flower stock (vases, ribbons, packaging — see BACKLOG line 290). The schema chosen here accommodates non-flowers without rework: Type=`Vase`, Colour=`Clear`, Size=`null`, Cultivar=`null` is a valid Variety. The cultivar column is unused for non-flowers but does not need to be removed.
