-- Re-adds a persisted sort order for items (dropped in
-- drop_milk_topping_customization.sql, when items ordered by id instead)
-- so staff can actually control drink display order, not just add/hide/
-- delete them. Defaulting every row to 0 is deliberately safe: combined
-- with get_menu()'s "sort_order, then id" tie-break below, it reproduces
-- today's exact by-id order for every existing item — nothing visibly
-- changes until someone actually reorders.
alter table items add column if not exists sort_order integer not null default 0;

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
            'sugarLevels', coalesce(sg.levels, '[]'::jsonb)
          ) order by it.sort_order, it.id
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

-- Moves one item up/down within its own category. Renumbers the whole
-- category to a clean 0..n-1 sequence first (using the exact same
-- "sort_order, then id" order get_menu() displays) — that's what makes
-- the swap meaningful even the very first time a category's items still
-- all share the default sort_order of 0, and keeps sort_order values
-- gap-free/tie-free going forward. Staff-only via the existing
-- "staff write items" RLS policy (this is invoker-rights, no grant to
-- anon needed).
create or replace function move_menu_item(p_item_id text, p_direction text)
returns void
language plpgsql
as $$
declare
  v_cat_id text;
  v_pos integer;
  v_other_id text;
  v_other_pos integer;
begin
  select category_id into v_cat_id from items where id = p_item_id;
  if not found then
    raise exception 'Item not found';
  end if;

  with ranked as (
    select id, row_number() over (order by sort_order, id) - 1 as rn
    from items where category_id = v_cat_id
  )
  update items set sort_order = ranked.rn
  from ranked where items.id = ranked.id;

  select sort_order into v_pos from items where id = p_item_id;

  if p_direction = 'up' then
    select id, sort_order into v_other_id, v_other_pos from items
      where category_id = v_cat_id and sort_order < v_pos
      order by sort_order desc limit 1;
  else
    select id, sort_order into v_other_id, v_other_pos from items
      where category_id = v_cat_id and sort_order > v_pos
      order by sort_order asc limit 1;
  end if;

  if v_other_id is null then
    return;
  end if;

  update items set sort_order = v_other_pos where id = p_item_id;
  update items set sort_order = v_pos where id = v_other_id;
end;
$$;

grant execute on function move_menu_item(text, text) to authenticated;
