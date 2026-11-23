-- swap_order_item() picked the line by index alone. The staff order sheet
-- is a snapshot from when it was opened, and a change drops/appends lines,
-- so a second device with the same order open could change the wrong drink
-- (and price the top-up off the wrong one). The caller now also says which
-- drink and sugar it expects at that index, and a mismatch is refused.
--
-- The old 4-argument version is left in place so the frontend that's live
-- right now keeps working until this one is deployed; drop it after that.

create function swap_order_item(p_id text, p_line_index integer, p_expected_item_id text, p_expected_sugar text, p_new_item_id text, p_new_sugar text)
returns jsonb
language plpgsql
as $$
declare
  v_row orders%rowtype;
  v_items jsonb;
  v_line jsonb;
  v_qty integer;
  v_free integer;
  v_paid integer;
  v_old_unit numeric;
  v_old_pool text;
  v_new_pool text := 'walkin';
  v_new record;
  v_diff numeric;
  v_out jsonb := '[]'::jsonb;
  v_merged boolean := false;
  v_sugar text := nullif(trim(coalesce(p_new_sugar, '')), '');
  li jsonb;
  i integer := 0;
begin
  select * into v_row from orders where id = p_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if v_row.status not in ('Received', 'Preparing', 'Ready') then
    raise exception 'Only an order that hasn''t been collected yet can be changed';
  end if;

  v_items := coalesce(v_row.items, '[]'::jsonb);
  if p_line_index is null or p_line_index < 0 or p_line_index >= jsonb_array_length(v_items) then
    raise exception 'That item is no longer on this order';
  end if;
  v_line := v_items->p_line_index;
  -- The staff sheet can be stale (someone else changed this order since
  -- it was opened), and a change reorders the lines — so make sure the
  -- line at this index is still the drink staff actually tapped.
  if coalesce(v_line->>'itemId', '') <> coalesce(p_expected_item_id, '')
    or coalesce(v_line->>'sugar', '') <> coalesce(nullif(trim(coalesce(p_expected_sugar, '')), ''), '') then
    raise exception 'This order was changed on another device - close it and open it again';
  end if;
  v_qty := coalesce((v_line->>'qty')::integer, 0);
  v_free := case when coalesce((v_line->>'redeemed')::boolean, false)
    then coalesce((v_line->>'freeQty')::integer, 1) else 0 end;
  v_paid := v_qty - v_free;
  if v_paid < 1 then
    raise exception 'A free (stamp) drink can''t be changed';
  end if;
  v_old_unit := round(coalesce((v_line->>'lineTotal')::numeric, 0) / v_paid, 2);
  v_old_pool := coalesce(v_line->>'stockPool', v_row.order_type);

  select id, name, price, soldout, walkin_limit, walkin_sold into v_new
  from items where id = p_new_item_id for update;
  if not found then
    raise exception 'That drink is no longer on the menu';
  end if;
  if v_new.soldout then
    raise exception '% is sold out', v_new.name;
  end if;
  if v_new.id = v_line->>'itemId' and coalesce(v_sugar, '') = coalesce(v_line->>'sugar', '') then
    raise exception 'Pick a different drink or sugar level';
  end if;

  -- Same drink, different sugar only: no stock moves at all.
  if v_new.id <> coalesce(v_line->>'itemId', '') then
    if v_new.walkin_limit is not null and v_new.walkin_sold + 1 > v_new.walkin_limit then
      raise exception 'No walk-in stock left for %', v_new.name;
    end if;
    update items set walkin_sold = walkin_sold + 1 where id = v_new.id;
    if v_line->>'itemId' is not null then
      if v_old_pool = 'walkin' then
        update items set walkin_sold = greatest(walkin_sold - 1, 0) where id = v_line->>'itemId';
      else
        update items set preorder_sold = greatest(preorder_sold - 1, 0) where id = v_line->>'itemId';
      end if;
    end if;
  else
    v_new_pool := v_old_pool;
  end if;

  v_diff := v_new.price - v_old_unit;
  -- A $0 preorder means "paid with stamps up front" everywhere else
  -- (mark_order_collected, order_stamp_delta), so a paid order mustn't
  -- land on exactly $0.
  if v_row.total + v_diff <= 0 then
    raise exception 'This change would leave the order at $0 - refund it instead';
  end if;

  -- Rebuild the item list: the old line loses one paid unit (dropped if
  -- that was its last), and the new drink merges into a matching paid-for
  -- line from the same stock pool if there is one, else goes on the end.
  for li in select value from jsonb_array_elements(v_items) as t(value) loop
    if i = p_line_index then
      if v_qty > 1 then
        v_out := v_out || jsonb_build_array(li || jsonb_build_object(
          'qty', v_qty - 1,
          'lineTotal', round(coalesce((li->>'lineTotal')::numeric, 0) - v_old_unit, 2)));
      end if;
    elsif not v_merged
      and li->>'itemId' = v_new.id
      and coalesce(li->>'sugar', '') = coalesce(v_sugar, '')
      and coalesce(li->>'stockPool', v_row.order_type) = v_new_pool
      and not coalesce((li->>'redeemed')::boolean, false) then
      v_out := v_out || jsonb_build_array(li || jsonb_build_object(
        'qty', coalesce((li->>'qty')::integer, 0) + 1,
        'lineTotal', round(coalesce((li->>'lineTotal')::numeric, 0) + v_new.price, 2)));
      v_merged := true;
    else
      v_out := v_out || jsonb_build_array(li);
    end if;
    i := i + 1;
  end loop;

  if not v_merged then
    v_out := v_out || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'itemId', v_new.id, 'name', v_new.name, 'sugar', v_sugar, 'qty', 1, 'lineTotal', v_new.price,
        'stockPool', case when v_new_pool <> v_row.order_type then v_new_pool end)));
  end if;

  update orders set
    items = v_out,
    total = round(total + v_diff, 2),
    item_changes = item_changes || jsonb_build_object(
      'from', concat_ws(' · ', v_line->>'name', v_line->>'sugar'),
      'to', concat_ws(' · ', v_new.name, v_sugar),
      'amount', v_diff,
      'changedBy', auth.email(),
      'changedAt', now())
  where id = p_id;

  return jsonb_build_object('amount', v_diff);
end;
$$;

revoke execute on function swap_order_item(text, integer, text, text, text, text) from public, anon;
grant execute on function swap_order_item(text, integer, text, text, text, text) to authenticated;
