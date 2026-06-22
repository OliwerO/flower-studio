# Y-model Lab Data Additions — PO/Order/Delivery Lifecycle + Deep History

> COMPANION DATA TRACK to `2026-06-22-ymodel-crs-batch2-plan.md`. Source: workflow `wz30p7gry` (2026-06-22). **Sonnet-generated — VERIFY every column name against `backend/src/db/schema.js` + the existing helpers BEFORE applying** (like the stock-state additions: check insertMany positional-key consistency, NOT-NULL columns, determinism). Lab-only test data → apply via `lab:template:rebuild -- --scenario=y-model-guide && lab:reset`. The helper-widening + new delivery() factory MAY also warrant a real PR (improves the teaching fixture) — decide after verify.

## Summary
5 additions: helper, PO lifecycle(19), deliveries(21-23), payment+cancelled(24-26), deep-history(27)

## Additions

### 0. WIDEN HELPERS (prereq)
**Fills:** seed.js insertMany reads row[0] keys; po/poLine must emit full NOT-NULL set; add delivery(); widen order()

**Helpers needed:** NEW delivery(); widened po/poLine/order

**Expected state:** no UI change; existing POs identical

**Determinism:** faker.seed(612)

```js
po()+supplier_payments,driver_payment; poLine() emit quantity_found,driver_status,5 substitute_*,quantity_accepted,write_off_qty,eval_status,farmer,notes,type/colour/size/cultivar,stock_id nullable; delivery() wraps makeDelivery(date=TODAY,driver=Nikita); order()+extra={}
```

### 19. PO 5 statuses Draft/Shopping/Reviewing/Evaluating/EvalError
**Fills:** 5 PO statuses + driver_status FoundAll/Partial/NotFound + substitute_* + eval_status Processed

**Helpers needed:** widened po/poLine; batch/de/order/line/purchase

**Expected state:** Draft blank-blocks-send; Shopping StockPickupPage; Reviewing AltLineEditor/impacted-warning; Evaluating StockEvaluationPage; EvalError gray-fallback(missing STATUS_COLORS)/skips-Processed/Accepted:18

**Determinism:** PO notes 'PO #<n> L#<id> primary'

```js
PO-DRAFT-1 line30+blank(null,10); PO-SHOP-1 line20 FoundAll+line15 Partial(9); PO-REVIEW-1+DE(NEED_25,-8) line8 FoundAll, line12 Partial(7) sub Peony White 5 c60, line6 NotFound sub Ranunculus 10 c80 4f; PO-EVAL-1 line20 FoundAll+line10 Partial6; PO-ERR-1 purchase18 line18 acc18 Processed+line12 Partial(8) acc0
```

### 21-23. Deliveries Out/Delivered/Pending (TODAY, Nikita)
**Fills:** Out for Delivery order + 3 delivery groups + cascade + ordLisi(#6) has NO linked delivery

**Helpers needed:** delivery+order/line; Rose White#2(no drift)+ordLisi

**Expected state:** Out sky badge, Delivered green+timestamp, ordLisi sub-section; delivery app Pending(Start)/Out(Mark-Delivered)/Delivered TODAY Nikita-first

**Determinism:** date=TODAY; tests skip delivered_at

```js
rwBatch=Rose White 60cm Avalanche(20.Jun.). (21)order(TODAY,Out for Delivery,Delivery)line6;delivery('Out for Delivery',fee30). (22)order(TODAY,Delivered,Delivery)line4;delivery(Delivered,fee25,deliveredAt'2026-06-22T11:30:00Z'). (23)delivery(ordLisi[:213],Pending,fee20,TODAY)
```

### 24-26. Payment Paid+Partial + Order Cancelled
**Fills:** Paid green badge; Partial amber/remaining; Cancelled completedOnly + in-trace (dedicated Marigold; trace join no status filter)

**Helpers needed:** widened order(extra); batch/purchase/order/line/delivery; new Marigold keeps ARC A

**Expected state:** Paid green no-warning 120; Partial orange remaining 80 (P2 UI-only); Cancelled rose+reopen+NOT-in-active-groups+-4 trace tagged Cancelled; Marigold drift 12-4=8

**Determinism:** Batch-direct payments; Marigold 12-4=8=onHand

```js
24 Tulip Yellow order(extra:{payment_status:'Paid',payment_method:'Card',price_override:'120.00'})line5. 25 Carnation Red order(extra:{payment_status:'Partial',payment_1_amount:'50.00',payment_1_method:'Cash',price_override:'130.00'})line6. 26 Marigold Orange 40cm qty8 BATCH_OLD purchase12 'PO #PO-MARI-1 L#1 primary'; order('2026-06-19',Cancelled,Delivery)line4; delivery(Cancelled,fee20)
```

### 27. DEEP-HISTORY Tulip Red 50cm Strong Love (2 batches)
**Fills:** multi-week cycle crosses zero twice + >6 events(tick thinning) + 2 Complete POs distinct poDisplayId(firstPo) + 2 writeoffs + DE-only trough

**Helpers needed:** batch/de/order/line/purchase/loss + widened po/poLine

**Expected state:** ~10 events; +40,28,18,10,1,-8(RED),+12(GREEN),9,3 zero-cross both ways; >6=3 x-ticks; 2 distinct poDisplayId; 2 red writeoffs; drift0

**Determinism:** drift0: 60-37-11=12=onHand

```js
dates 06-01..23. tulipRed1 purchase40 PO-TULRED-1 Complete poLine40 Processed; orders 06-04 line12, 06-08 line10; loss8 06-12; DE(06-15)qty0 order9; tulipRed2 qty12 purchase20 4f PO-TULRED-2 Complete poLine20; loss3 06-21; order(06-23)6
```

## Cannot seed (need migration/infra — skip or defer)
- **Delivery Result labels** — no delivery_result column; route validates but persists nothing
  - infra: add deliveryResult column+migration OR post-seed PATCH
- **Payment 2nd payment + In Progress/In Preparation legacy badges** — no payment_2_* columns (UI-only); legacy badges seedable but excluded as clutter
  - infra: Payment 2nd needs payment_2_* columns+migration; legacy badges none
