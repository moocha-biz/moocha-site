-- 20260915130000_reorder_menu_items.sql's get_menu() replacement was based
-- on an older copy of the function and silently dropped the customTags
-- field added in item_custom_tags.sql — save_menu_item() still wrote
-- custom_tags to the row correctly, but get_menu() never read it back out,
-- so a saved tag appeared to just vanish. Re-adds it, keeping the
-- sort_order-based item ordering from the reorder migration.
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
