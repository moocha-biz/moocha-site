// Mirrors store.jsx's `ordersOpen` (payment_enabled AND, if set, now is
// before preorder_close_at) — but that client-side version only disables
// the Checkout button. Nothing ever re-checked it server-side, so a direct
// call to create-checkout-session/redeem-order could place an order while
// the stall shows "Orders paused" or after the scheduled cutoff. Both
// edge functions call this before doing anything else.
// deno-lint-ignore no-explicit-any
export async function ordersAreOpen(supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from("settings")
    .select("payment_enabled, preorder_close_at")
    .eq("id", "main")
    .maybeSingle();
  if (!data || !data.payment_enabled) return false;
  if (data.preorder_close_at && new Date(data.preorder_close_at).getTime() <= Date.now()) return false;
  return true;
}
