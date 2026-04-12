# Airtable Setup: Premade Bouquets

## Step 1 — Create the tables via CSV import

1. Open your Airtable base
2. Click **"+ Add a table"** → **"Import CSV"**
3. Import `seed-premade-bouquets.csv` → name the table **"Premade Bouquets"**
4. Import `seed-premade-bouquet-lines.csv` → name the table **"Premade Bouquet Lines"**
5. Delete the seed rows after import (they're just for field-type detection)

## Step 2 — Fix field types (CSV import can't create these)

### In "Premade Bouquets" table:

| Field | CSV creates as | Change to | Notes |
|-------|---------------|-----------|-------|
| Name | Single line text | Single line text | ✅ Already correct |
| Price Override | Number | Number (decimal, 2 places) | Set format to "1.00" |
| Notes | Single line text | Long text | Click field header → Customize → Long text |
| Created By | Single line text | Single line text | ✅ Already correct |

**Add manually:**
- **Created At** → Field type: "Created time" (auto-populated by Airtable)
- **Lines** → Field type: "Link to another record" → link to **"Premade Bouquet Lines"** table

### In "Premade Bouquet Lines" table:

| Field | CSV creates as | Change to | Notes |
|-------|---------------|-----------|-------|
| Flower Name | Single line text | Single line text | ✅ Already correct |
| Quantity | Number | Number (integer) | Set format to "1" |
| Cost Price Per Unit | Number | Number (decimal, 2 places) | Set format to "1.00" |
| Sell Price Per Unit | Number | Number (decimal, 2 places) | Set format to "1.00" |

**Add manually:**
- **Premade Bouquet** → Should auto-appear when you created the "Lines" link in the parent table. If not: "Link to another record" → link to **"Premade Bouquets"**
- **Stock Item** → Field type: "Link to another record" → link to your existing **"Stock"** table

## Step 3 — Get table IDs and set env vars

1. Click each new table tab → look at the URL: `airtable.com/appXXX/tblYYYYY/...`
2. Copy the `tblYYYYY` part
3. Add to your `.env` (dev and production):

```
AIRTABLE_PREMADE_BOUQUETS_TABLE=tblYYYYY
AIRTABLE_PREMADE_BOUQUET_LINES_TABLE=tblZZZZZ
```

4. Restart the backend server

## Step 4 — Verify

After backend deploys with the new code, hit:
```
GET /api/premade-bouquets
```
Should return `[]` (empty array, no errors).

## Field name reference (case-sensitive — must match exactly)

**Premade Bouquets:**
`Name`, `Price Override`, `Notes`, `Created By`, `Created At`, `Lines`

**Premade Bouquet Lines:**
`Premade Bouquet`, `Stock Item`, `Flower Name`, `Quantity`, `Cost Price Per Unit`, `Sell Price Per Unit`
