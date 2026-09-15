-- Local dev seed data, applied by `supabase db reset` / fresh `supabase start`.
-- Prod has this settings row created out-of-band (not via migration), so a
-- fresh local DB built from migrations alone starts with an empty table.
insert into public.settings (id, payment_enabled, stall_phone, stall_name)
values ('main', true, '+6596586775', 'Moocha')
on conflict (id) do nothing;

-- A small realistic catalog so local admin/menu/checkout testing has more
-- than one item to work with. `on conflict do nothing` so re-seeding never
-- clobbers anything an admin edited locally under these same ids.
insert into public.categories (id, name, sort_order) values
  ('cat_seed_matcha', 'Matcha', 0),
  ('cat_seed_milk_tea', 'Milk Tea', 1),
  ('cat_seed_specials', 'Specials', 2)
on conflict (id) do nothing;

insert into public.items (id, category_id, name, "desc", price, iced, soldout, icon, sort_order) values
  ('item_seed_matcha_latte', 'cat_seed_matcha', 'Classic Matcha Latte', 'Stone-ground ceremonial matcha, steamed milk', 5.20, true, false, '🍵', 0),
  ('item_seed_hojicha_latte', 'cat_seed_matcha', 'Hojicha Latte', 'Roasted green tea, toasty and low-caffeine', 5.00, true, false, '🍂', 1),
  ('item_seed_matcha_espresso', 'cat_seed_matcha', 'Matcha Espresso Fusion', 'Matcha meets a shot of espresso', 5.80, true, false, '☕', 2),
  ('item_seed_classic_milk_tea', 'cat_seed_milk_tea', 'Classic Milk Tea', 'Black tea, milk, classic and simple', 4.80, true, false, '🧋', 0),
  ('item_seed_brown_sugar_boba', 'cat_seed_milk_tea', 'Brown Sugar Boba Milk', 'Fresh milk, hand-cooked brown sugar pearls', 5.50, true, false, '🍯', 1),
  ('item_seed_strawberry_matcha', 'cat_seed_specials', 'Strawberry Matcha', 'Layered strawberry puree and matcha latte', 5.90, true, false, '🍓', 0)
on conflict (id) do nothing;

insert into public.item_sugar_levels (item_id, level, sort_order)
  select i.id, lvl, ord - 1
  from public.items i
  cross join lateral (
    values ('0%', 1), ('25%', 2), ('50%', 3), ('75%', 4), ('100%', 5)
  ) as t(lvl, ord)
  where i.id like 'item_seed_%'
on conflict (item_id, sort_order) do nothing;
