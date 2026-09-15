-- One Telegram account should never end up linked to two different phone
-- numbers at once. Without this constraint it was silently possible: link
-- to phone A, then later link the same Telegram account to phone B (e.g.
-- testing the self-service flow on one number and the staff QR flow on
-- another) — both rows end up with the same telegram_chat_id. Any bot
-- command that looks up "where telegram_chat_id = this chat" then matches
-- two rows, .maybeSingle() errors, and the webhook's (unchecked) error
-- path silently falls through to a misleading "you're not linked" reply,
-- even though a link genuinely exists — just ambiguously.
--
-- Partial index (excludes null) since most rows have no Telegram linked at
-- all and nulls shouldn't collide with each other.
create unique index if not exists customers_telegram_chat_id_key
  on customers(telegram_chat_id) where telegram_chat_id is not null;

-- Catches the unique-violation this constraint can now raise and turns it
-- into a specific, matchable message instead of a raw Postgres error —
-- same pattern as this app's other domain-specific exceptions (not_eligible,
-- needs_claim, etc).
create or replace function redeem_telegram_link_code(p_code text, p_chat_id bigint, p_username text default null)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_phone text;
begin
  select phone into v_phone from customers
  where telegram_link_code = p_code and telegram_link_code_expires_at > now();
  if not found then
    return null;
  end if;

  begin
    update customers set
      telegram_chat_id = p_chat_id, telegram_username = p_username,
      telegram_link_code = null, telegram_link_code_expires_at = null
    where phone = v_phone;
  exception when unique_violation then
    raise exception 'already_linked_elsewhere';
  end;

  return v_phone;
end;
$$;
