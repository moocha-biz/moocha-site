-- item_milks, item_toppings, items.icon and items.sort_order were dropped
-- directly on the live DB (outside migration control), and items.is_hidden
-- was added. This brings get_menu()/save_menu_item() back in line with
-- that schema: no more milk/topping selection, items order by id instead
-- of a persisted sort_order, and is_hidden lets an item be pulled off the
-- customer-facing menu without deleting it (still visible/manageable in
-- the admin editor).

drop table if exists item_milks;
drop table if exists item_toppings;

drop function if exists save_menu_item(text, text, text, text, numeric, boolean, text, text, jsonb, jsonb, jsonb);

create or replace function get_menu()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('categories', coalesce(jsonb_object_agg(cat.name, cat.items order by cat.sort_order), '{}'::jsonb))
  from (
    select c.id, c.name, c.sort_order,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', it.id, 'name', it.name, 'desc', it."desc", 'price', it.price,
            'iced', it.iced, 'soldout', it.soldout, 'photo', it.photo,
            'isHidden', coalesce(it.is_hidden, false),
            'sugarLevels', coalesce(sg.levels, '[]'::jsonb)
          ) order by it.id
        ) filter (where it.id is not null),
        '[]'::jsonb
      ) as items
    from categories c
    left join items it on it.category_id = c.id
    left join lateral (
      select jsonb_agg(s.level order by s.sort_order) as levels
      from item_sugar_levels s where s.item_id = it.id
    ) sg on true
    group by c.id, c.name, c.sort_order
  ) cat;
$$;

create or replace function save_menu_item(
  p_id text, p_category text, p_name text, p_desc text, p_price numeric,
  p_iced boolean, p_photo text, p_sugar_levels jsonb
) returns void
language plpgsql
as $$
declare
  v_category_id text;
  v_next_sort integer;
begin
  select id into v_category_id from categories where name = p_category;
  if v_category_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_next_sort from categories;
    v_category_id := 'cat_' || md5(p_category || clock_timestamp()::text);
    insert into categories (id, name, sort_order) values (v_category_id, p_category, v_next_sort);
  end if;

  if exists (select 1 from items where id = p_id) then
    update items set category_id = v_category_id, name = p_name, "desc" = p_desc, price = p_price,
      iced = p_iced, photo = p_photo
      where id = p_id;
  else
    insert into items (id, category_id, name, "desc", price, iced, soldout, photo, is_hidden)
      values (p_id, v_category_id, p_name, p_desc, p_price, p_iced, false, p_photo, false);
  end if;

  delete from item_sugar_levels where item_id = p_id;
  insert into item_sugar_levels (item_id, level, sort_order)
    select p_id, sg #>> '{}', ord - 1
    from jsonb_array_elements(p_sugar_levels) with ordinality as t(sg, ord);
end;
$$;

grant execute on function get_menu() to anon;
grant execute on function save_menu_item(text, text, text, text, numeric, boolean, text, jsonb) to anon;
