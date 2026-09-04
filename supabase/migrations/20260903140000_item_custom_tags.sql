-- Free-form admin-defined tags per item (e.g. "New!", "Bestseller",
-- "Chef's pick") with a custom color each — shown as pills next to the
-- built-in soldout/low-stock tags, same visual treatment.
alter table items add column if not exists custom_tags jsonb not null default '[]'::jsonb;

drop function if exists save_menu_item(text, text, text, text, numeric, boolean, text, jsonb, integer, integer);

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
            'preorderLimit', it.preorder_limit, 'preorderSold', it.preorder_sold,
            'walkinLimit', it.walkin_limit, 'walkinSold', it.walkin_sold,
            'customTags', coalesce(it.custom_tags, '[]'::jsonb),
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
  p_iced boolean, p_photo text, p_sugar_levels jsonb,
  p_preorder_limit integer, p_walkin_limit integer, p_custom_tags jsonb
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
      iced = p_iced, photo = p_photo, preorder_limit = p_preorder_limit, walkin_limit = p_walkin_limit,
      custom_tags = coalesce(p_custom_tags, '[]'::jsonb)
      where id = p_id;
  else
    insert into items (id, category_id, name, "desc", price, iced, soldout, photo, is_hidden, preorder_limit, walkin_limit, custom_tags)
      values (p_id, v_category_id, p_name, p_desc, p_price, p_iced, false, p_photo, false, p_preorder_limit, p_walkin_limit, coalesce(p_custom_tags, '[]'::jsonb));
  end if;

  delete from item_sugar_levels where item_id = p_id;
  insert into item_sugar_levels (item_id, level, sort_order)
    select p_id, sg #>> '{}', ord - 1
    from jsonb_array_elements(p_sugar_levels) with ordinality as t(sg, ord);
end;
$$;

grant execute on function get_menu() to anon;
grant execute on function save_menu_item(text, text, text, text, numeric, boolean, text, jsonb, integer, integer, jsonb) to anon;
