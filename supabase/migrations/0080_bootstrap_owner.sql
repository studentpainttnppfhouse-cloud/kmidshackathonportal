-- =============================================================================
-- 0080 OWNER BOOTSTRAP
-- Two Owners must always exist (§4) so that one graduating student is never a
-- single point of failure. The application calls this on first sign-in with
-- OWNER_EMAIL or OWNER_BACKUP_EMAIL; it is idempotent.
-- =============================================================================

create or replace function app.ensure_owner(owner_email text)
  returns uuid
  language plpgsql security definer set search_path = public, pg_temp
  as $$
    declare
      uid uuid;
    begin
      if owner_email is null or owner_email = '' then
        return null;
      end if;

      insert into public.users (email, tier, status, name, onboarded_at)
      values (lower(owner_email), 'T4', 'active', null, null)
      on conflict (email) do update
        set tier = 'T4',
            status = case
              when public.users.status in ('banned', 'suspended') then public.users.status
              else 'active' end
      returning id into uid;

      return uid;
    end;
  $$;

revoke all on function app.ensure_owner(text) from public, anon, authenticated;
