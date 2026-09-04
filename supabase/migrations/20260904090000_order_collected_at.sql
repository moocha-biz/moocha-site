-- Tracks when an order was actually collected (distinct from `date`,
-- which is when it was placed) — surfaced in the new admin order details
-- view. Walk-ins are collected at creation time; preorders get this set
-- when staff tap "mark collected".
alter table orders add column if not exists collected_at timestamptz;

create or replace function log_walkin_order(
  p_id text, p_name text, p_phone text, p_items jsonb, p_total numeric, p_notes text
) returns void
language plpgsql
as $$
declare
  li jsonb;
  v_item_id text;
  v_qty integer;
  v_limit integer;
  v_sold integer;
begin
  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      select walkin_limit, walkin_sold into v_limit, v_sold from items where id = v_item_id;
      if v_limit is not null and v_sold + v_qty > v_limit then
        raise exception 'Not enough walk-in stock left for %', li->>'name';
      end if;
    end if;
  end loop;

  insert into orders (id, name, phone, date, items, total, notes, status, order_type, collected_at)
    values (p_id, p_name, p_phone, now(), p_items, p_total, p_notes, 'Collected', 'walkin', now());

  for li in select * from jsonb_array_elements(p_items) loop
    v_item_id := li->>'itemId';
    v_qty := coalesce((li->>'qty')::integer, 0);
    if v_item_id is not null then
      update items set walkin_sold = walkin_sold + v_qty where id = v_item_id;
    end if;
  end loop;

  if p_phone is not null and p_phone <> '' then
    if exists (select 1 from customers where phone = p_phone) then
      update customers set stamps = stamps + 1, name = coalesce(nullif(p_name, ''), name), updated_at = now() where phone = p_phone;
    else
      insert into customers (phone, name, stamps) values (p_phone, coalesce(p_name, ''), 1);
    end if;
  end if;
end;
$$;

create or replace function mark_order_collected(p_id text)
returns void
language plpgsql
as $$
declare
  v_phone text;
  v_name text;
  v_status text;
begin
  select phone, name, status into v_phone, v_name, v_status from orders where id = p_id;
  if v_status is distinct from 'Received' then
    return;
  end if;

  update orders set status = 'Collected', collected_at = now() where id = p_id;

  if v_phone is not null and v_phone <> '' then
    if exists (select 1 from customers where phone = v_phone) then
      update customers set stamps = stamps + 1, name = coalesce(nullif(v_name, ''), name), updated_at = now() where phone = v_phone;
    else
      insert into customers (phone, name, stamps) values (v_phone, coalesce(v_name, ''), 1);
    end if;
  end if;
end;
$$;
