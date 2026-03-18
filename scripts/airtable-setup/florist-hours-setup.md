# Florist Hours — Airtable Setup Guide

## 1. Create the table

In your Airtable base (`appM8rLfcE9cbxduZ`), create a new table called **Florist Hours**.

## 2. Import the CSV

Use `docs/florist-hours-template.csv` to set up the columns. In Airtable:
1. Click **+** to add a new table
2. Choose **Import CSV**
3. Select `florist-hours-template.csv`
4. Delete the sample row after import

## 3. Set field types

After import, adjust the field types:

| Field | Type | Notes |
|-------|------|-------|
| **Name** | Single select | Options: add each florist's name (e.g., Anya, Daria). Single select prevents typos. |
| **Date** | Date | Format: YYYY-MM-DD |
| **Hours** | Number (1 decimal) | e.g., 8.0, 6.5 |
| **Hourly Rate** | Number (2 decimals) | zl per hour, e.g., 28.50 |
| **Rate Type** | Single line text | Rate category name (e.g., Standard, Wedding, Holidays). Set by florist when logging hours. |
| **Bonus** | Number (2 decimals) | Extra pay for that day (e.g., holiday bonus). Default: 0 |
| **Deduction** | Number (2 decimals) | Deductions (e.g., advance taken). Default: 0 |
| **Total Pay** | Formula | `{Hours} * {Hourly Rate} + {Bonus} - {Deduction}` |
| **Notes** | Long text | Free text for context |
| **Delivery Count** | Number | Florist deliveries that day (for after-hours payout tracking) |

## 4. Add the table ID to environment variables

After creating the table, get its ID:
1. Open the table in Airtable
2. The URL looks like: `airtable.com/appM8rLfcE9cbxduZ/tblXXXXXXXXXXXXXXX/...`
3. Copy the `tblXXXXXXXXXXXXXXX` part

Add to Railway env vars:
```
AIRTABLE_FLORIST_HOURS_TABLE=tblXXXXXXXXXXXXXXX
```

Add to `backend/.env.dev`:
```
AIRTABLE_FLORIST_HOURS_TABLE=tblXXXXXXXXXXXXXXX
```

## 5. Create the formula field

In Airtable, change the `Total Pay` column type to **Formula** and enter:
```
{Hours} * {Hourly Rate} + {Bonus} - {Deduction}
```

## 6. Useful views

Create these views for the owner:

- **This Month** — filter: Date is within this month, group by Name
- **Payroll Summary** — group by Name, show totals for Hours + Total Pay
- **By Date** — sort by Date descending, for daily entry
