-- Local dev seed data, applied by `supabase db reset` / fresh `supabase start`.
-- Prod has this settings row created out-of-band (not via migration), so a
-- fresh local DB built from migrations alone starts with an empty table.
insert into public.settings (id, payment_enabled, stall_phone, stall_name)
values ('main', true, '+6596586775', 'Moocha')
on conflict (id) do nothing;
