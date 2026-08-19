-- =============================================================================
-- 0020 IDENTITY
-- Departments, users, the three access paths from §4, and device sessions.
-- Policies are defined immediately after each table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- DEPARTMENTS
-- ---------------------------------------------------------------------------
create table public.departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  description  text,
  head_user_id uuid,
  color        text not null default '#EC4899',
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create trigger departments_touch before update on public.departments
  for each row execute function app.touch_updated_at();

alter table public.departments enable row level security;

-- Every signed-in user can see the department list — it is the org chart.
create policy departments_select on public.departments
  for select to authenticated using (app.is_active() or app.is_advisor());

-- Only T3+ restructure the org.
create policy departments_insert on public.departments
  for insert to authenticated
  with check (app.tier_at_least('T3') and app.is_active() and not app.is_advisor());

create policy departments_update on public.departments
  for update to authenticated
  using (app.tier_at_least('T3') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T3') and app.is_active() and not app.is_advisor());

-- ---------------------------------------------------------------------------
-- USERS
-- Minimal personal data only (§2.5) — Thailand's PDPA applies to these rows.
-- Name, nickname, grade, email, phone, LINE ID, shirt size. Nothing more.
-- ---------------------------------------------------------------------------
create table public.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique,
  name               text,
  nickname           text,
  grade              text,
  phone              text,
  line_id            text,
  avatar_url         text,
  shirt_size         text,
  tier               app.tier not null default 'T1',
  department_id      uuid references public.departments(id),
  role_title         text,
  status             app.account_status not null default 'requested',
  is_reserve         boolean not null default false,
  is_mentor          boolean not null default false,
  is_alumni          boolean not null default false,
  banned_by          uuid references public.users(id),
  banned_at          timestamptz,
  ban_reason         text,
  suspended_until    timestamptz,
  suspend_reason     text,
  last_active_at     timestamptz,
  source_response_id uuid,
  onboarded_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  -- A ban must always carry a reason and an author (§3).
  constraint users_ban_reason_required
    check (status <> 'banned' or (ban_reason is not null and banned_by is not null))
);

create index users_dept_idx   on public.users (department_id) where deleted_at is null;
create index users_status_idx on public.users (status)        where deleted_at is null;
create index users_email_idx  on public.users (lower(email));

alter table public.departments
  add constraint departments_head_fk
  foreign key (head_user_id) references public.users(id) on delete set null;

create trigger users_touch before update on public.users
  for each row execute function app.touch_updated_at();

alter table public.users enable row level security;

-- Directory is visible to everyone on staff; that is the point of §5.3.
create policy users_select on public.users
  for select to authenticated
  using (app.is_active() or app.is_advisor() or id = app.uid());

-- You may edit your own profile. You may NOT edit your own tier, status,
-- department or ban fields — that check lives in the trigger below, because a
-- WITH CHECK clause cannot compare against the pre-update row.
create policy users_update_self on public.users
  for update to authenticated
  using (id = app.uid() and app.is_active())
  with check (id = app.uid());

-- T3 may edit profiles (§5.3) but only the Owner may change tier or status.
create policy users_update_staff on public.users
  for update to authenticated
  using (app.tier_at_least('T3') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T3') and app.is_active() and not app.is_advisor());

create policy users_insert_owner on public.users
  for insert to authenticated with check (app.is_owner());

-- Privilege escalation guard. This is the single most important trigger in the
-- schema: without it, `users_update_self` would let any student PATCH their own
-- row to tier T4 straight from devtools.
create or replace function app.guard_user_privileges() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
  as $$
    declare
      actor_tier app.tier := app.tier();
    begin
      -- The service role (server-side admin client) bypasses this entirely; it
      -- is the only path that provisions accounts and applies Owner decisions.
      if current_setting('request.jwt.claims', true) is null then
        return new;
      end if;

      if actor_tier is distinct from 'T4' then
        if new.tier is distinct from old.tier then
          raise exception 'Only the Owner can change a tier';
        end if;
        if new.status is distinct from old.status then
          raise exception 'Only the Owner can change an account status';
        end if;
        if new.banned_by   is distinct from old.banned_by
        or new.banned_at   is distinct from old.banned_at
        or new.ban_reason  is distinct from old.ban_reason
        or new.suspended_until is distinct from old.suspended_until then
          raise exception 'Only the Owner can change ban or suspension state';
        end if;
        -- T3 may move people between departments; nobody below may.
        if new.department_id is distinct from old.department_id
           and app.rank(actor_tier) < app.rank('T3') then
          raise exception 'Only Administration can change a department';
        end if;
      end if;

      -- Nobody may demote the last remaining Owner (§4, ownership transfer).
      if old.tier = 'T4' and new.tier is distinct from 'T4' then
        if (select count(*) from public.users
            where tier = 'T4' and deleted_at is null and status = 'active') <= 1 then
          raise exception 'Cannot remove the last Owner';
        end if;
      end if;

      return new;
    end;
  $$;

create trigger users_guard_privileges
  before update on public.users
  for each row execute function app.guard_user_privileges();

-- ---------------------------------------------------------------------------
-- INVITED USERS — access path A (direct invite)
-- ---------------------------------------------------------------------------
create table public.invited_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  tier          app.tier not null default 'T1',
  department_id uuid references public.departments(id),
  role_title    text,
  invited_by    uuid references public.users(id),
  status        app.invite_status not null default 'pending',
  expires_at    timestamptz,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create unique index invited_users_email_pending_idx
  on public.invited_users (lower(email))
  where status = 'pending' and deleted_at is null;

create trigger invited_users_touch before update on public.invited_users
  for each row execute function app.touch_updated_at();

alter table public.invited_users enable row level security;

create policy invited_users_owner_all on public.invited_users
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

-- ---------------------------------------------------------------------------
-- INVITE KEYS — access path B (shareable code)
-- ---------------------------------------------------------------------------
create table public.invite_keys (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  label         text,
  tier          app.tier not null default 'T1',
  department_id uuid references public.departments(id),
  role_title    text,
  max_uses      int not null default 1,
  uses          int not null default 0,
  expires_at    timestamptz,
  created_by    uuid references public.users(id),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint invite_keys_uses_sane check (uses >= 0 and max_uses >= 1)
);

create trigger invite_keys_touch before update on public.invite_keys
  for each row execute function app.touch_updated_at();

alter table public.invite_keys enable row level security;

create policy invite_keys_owner_all on public.invite_keys
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

-- ---------------------------------------------------------------------------
-- DEVICE SESSIONS
-- Sign-in is email-only and sessions are deliberately long-lived: event-day
-- staff must not be retyping anything at 7 AM (§5.1), and the session has to
-- survive a redeploy. The cookie carries a random token; only its SHA-256 hash
-- is stored here, so a leaked database dump does not hand over live sessions.
-- ---------------------------------------------------------------------------
create table public.device_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token_hash    text not null unique,
  device_label  text,
  user_agent    text,
  ip            inet,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '365 days'),
  revoked_at    timestamptz
);

create index device_sessions_user_idx on public.device_sessions (user_id)
  where revoked_at is null;

alter table public.device_sessions enable row level security;

-- Users may see and revoke their own devices; the Owner may revoke anyone's
-- (that is what makes a suspension take effect immediately).
create policy device_sessions_select on public.device_sessions
  for select to authenticated using (user_id = app.uid() or app.is_owner());

create policy device_sessions_delete on public.device_sessions
  for update to authenticated
  using (user_id = app.uid() or app.is_owner())
  with check (user_id = app.uid() or app.is_owner());
