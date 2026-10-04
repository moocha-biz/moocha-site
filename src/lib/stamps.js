// Mirrors the stamps_on_hold() SQL function: stamps already promised to a
// free drink in an order that hasn't been collected yet. They only come
// off the customer's balance at collection, so until then they're still
// in customers.stamps but can't be spent on another free drink.
// A $0 preorder is excluded — place_redeemed_order deducted it up front.
const OPEN_STATUSES = ['Received', 'Preparing', 'Ready'];

export function stampsOnHold(orders, phone) {
  if (!phone) return 0;
  let freeQty = 0;
  for (const o of orders || []) {
    if (o.phone !== phone || !OPEN_STATUSES.includes(o.status)) continue;
    if (o.orderType === 'preorder' && Number(o.total) === 0) continue;
    for (const li of o.items || []) {
      if (li.redeemed) freeQty += li.freeQty ?? 1;
    }
  }
  return 7 * freeQty;
}
