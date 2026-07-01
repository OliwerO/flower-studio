// backend/src/services/assistantTools/discoveryPack.js
//
// Discovery tool — enumerates the real stored values (with counts) for a
// known free-text-ish dimension, so the model can resolve a name/value the
// user gave it instead of guessing spelling or misrouting it to the wrong
// entity (e.g. "Stefan" as a supplier vs a driver vs a customer name, or
// "Stripe" not matching any real Payment Method string).
//
// Thin adapter — each field delegates to a repo-level distinct-value+count
// helper. Never inlines SQL here.
import * as stockPurchasesRepo from '../../repos/stockPurchasesRepo.js';
import * as orderRepo from '../../repos/orderRepo.js';
import * as stockLossRepo from '../../repos/stockLossRepo.js';

// field -> zero-arg async fn returning [{ value, count }]
const FIELD_HANDLERS = {
  suppliers:      () => stockPurchasesRepo.distinctSuppliers(),
  paymentMethods: () => orderRepo.distinctPaymentMethods(),
  sources:        () => orderRepo.distinctSources(),
  lossReasons:    () => stockLossRepo.distinctReasons(),
  drivers:        () => orderRepo.distinctAssignedDrivers(),
};

/**
 * Look up the distinct stored values (+ counts) for one allow-listed field.
 *
 * @param {{ field: string }} input
 * @returns {Promise<{field:string, values:{value:string,count:number}[]} | {error:string}>}
 */
export async function listValuesHandler({ field } = {}) {
  const fn = FIELD_HANDLERS[field];
  if (!fn) {
    return { error: `Unknown field "${field}". Allowed: ${Object.keys(FIELD_HANDLERS).join(', ')}` };
  }
  try {
    const values = await fn();
    return { field, values };
  } catch (err) {
    return { error: err.message };
  }
}
