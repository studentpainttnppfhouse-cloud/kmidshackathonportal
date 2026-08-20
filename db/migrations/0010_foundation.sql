-- =============================================================================
-- 0010 FOUNDATION
-- Extensions, enums, the `app` helper schema, the append-only audit log, and
-- the shared triggers every other table depends on.
--
-- Read SCHEMA.md alongside this file — it explains every table in plain
-- language for whoever maintains this after the 2027 team graduates.
-- =============================================================================

-- The RLS helper functions below are defined before the tables they read, so
-- that every later migration can rely on them. Postgres would normally reject
-- a SQL-language body referencing a table that does not exist yet.
set check_function_bodies = off;

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- `app` holds helper functions used by RLS policies. Keeping them out of
-- `public` means they are not exposed over PostgREST as callable endpoints.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app.tier as enum ('T0', 'T1', 'T2', 'T3', 'T4');
create type app.account_status as enum
  ('active', 'pending', 'requested', 'suspended', 'banned');
create type app.assignment_status as enum
  ('not_started', 'in_progress', 'needs_review', 'approved', 'done');
create type app.priority as enum ('low', 'medium', 'high', 'urgent');
create type app.doc_status as enum ('draft', 'in_review', 'approved', 'published');
create type app.permission_level as enum ('view', 'comment', 'edit');
create type app.content_status as enum
  ('idea', 'assigned', 'asset_in_progress', 'ready', 'posted');
create type app.folder_kind as enum ('doc', 'sheet', 'file');
create type app.announcement_scope as enum ('all', 'department');
create type app.form_status as enum ('draft', 'published', 'closed');
create type app.invite_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type app.incident_severity as enum ('low', 'medium', 'high', 'critical');

-- ---------------------------------------------------------------------------
-- Identity helpers
--
-- Sign-in is email-only (no password, no OAuth) — see src/lib/auth. Once the
-- server knows who is asking, it opens a transaction, writes the user id into
-- `request.jwt.claims` and switches to the `authenticated` role, so every
-- policy below reads the caller through app.uid(). Both settings are
-- transaction-local, so a pooled connection never carries a user into the next
-- request. See asUser() in src/lib/db/client.ts.
--
-- Nothing about a request can widen access on its own: tier and status are
-- read from the `users` table on every call, never taken from the claim.
-- ---------------------------------------------------------------------------

create or replace function app.uid() returns uuid
  language sql stable
  as $$
    select nullif(
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub', ''
    )::uuid;
  $$;

comment on function app.uid() is
  'The signed-in user id, read from the request JWT. Null when anonymous.';

-- SECURITY DEFINER so policies on `users` can call these without recursing
-- into their own RLS. search_path is pinned so the body cannot be hijacked.
create or replace function app.tier() returns app.tier
  language sql stable security definer set search_path = public, pg_temp
  as $$ select tier from public.users where id = app.uid() and deleted_at is null; $$;

create or replace function app.dept() returns uuid
  language sql stable security definer set search_path = public, pg_temp
  as $$ select department_id from public.users where id = app.uid() and deleted_at is null; $$;

create or replace function app.status() returns app.account_status
  language sql stable security definer set search_path = public, pg_temp
  as $$ select status from public.users where id = app.uid() and deleted_at is null; $$;

-- Rank the tiers so policies can express "T2 and above" directly.
create or replace function app.rank(t app.tier) returns int
  language sql immutable
  as $$
    select case t
      when 'T0' then 0 when 'T1' then 1 when 'T2' then 2
      when 'T3' then 3 when 'T4' then 4 end;
  $$;

create or replace function app.tier_at_least(min app.tier) returns boolean
  language sql stable
  as $$ select app.rank(app.tier()) >= app.rank(min); $$;

-- Only fully active accounts may touch anything. Suspended and banned users
-- are blocked in middleware too, but this is the boundary that actually holds.
create or replace function app.is_active() returns boolean
  language sql stable
  as $$ select app.status() = 'active'; $$;

create or replace function app.is_owner() returns boolean
  language sql stable
  as $$ select app.tier() = 'T4' and app.is_active(); $$;

-- T0 Advisors read broadly but may never create, edit or delete — only comment.
create or replace function app.is_advisor() returns boolean
  language sql stable
  as $$ select app.tier() = 'T0'; $$;

-- Read access to a department's content. NULL department = the General space,
-- which everyone signed in can see.
create or replace function app.can_read_dept(d uuid) returns boolean
  language sql stable
  as $$
    select app.is_active() and (
      d is null
      or app.tier_at_least('T3')
      or app.is_advisor()
      or app.dept() = d
    );
  $$;

-- Write access: T2 inside their own department, T3+ anywhere. Advisors never.
create or replace function app.can_write_dept(d uuid) returns boolean
  language sql stable
  as $$
    select app.is_active() and not app.is_advisor() and (
      app.tier_at_least('T3')
      or (app.tier() = 'T2' and app.dept() is not distinct from d)
    );
  $$;

-- T1 Members may create their own content in their own department or General.
create or replace function app.can_create_in_dept(d uuid) returns boolean
  language sql stable
  as $$
    select app.is_active() and not app.is_advisor() and (
      app.tier_at_least('T3')
      or d is null
      or app.dept() is not distinct from d
    );
  $$;

-- ---------------------------------------------------------------------------
-- Archive freeze (§5.13)
-- When the Owner freezes a year, every content row for that year becomes
-- read-only at the database level, not just in the UI.
-- ---------------------------------------------------------------------------
create table public.archived_years (
  year        int primary key,
  frozen_at   timestamptz not null default now(),
  frozen_by   uuid,
  note        text
);

create or replace function app.year_frozen(y int) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select exists (select 1 from public.archived_years where year = y); $$;

create or replace function app.year_writable(y int) returns boolean
  language sql stable
  as $$ select not app.year_frozen(coalesce(y, 2027)); $$;

-- ---------------------------------------------------------------------------
-- Shared triggers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger
  language plpgsql
  as $$
    begin
      new.updated_at = now();
      return new;
    end;
  $$;

-- Nothing is hard-deleted (§2.2). This makes a DELETE behave as a soft delete
-- even if something bypasses the application layer.
create or replace function app.soft_delete_guard() returns trigger
  language plpgsql
  as $$
    begin
      if old.deleted_at is null then
        execute format(
          'update %I.%I set deleted_at = now() where id = $1',
          tg_table_schema, tg_table_name
        ) using old.id;
      end if;
      return null; -- swallow the DELETE
    end;
  $$;

-- ---------------------------------------------------------------------------
-- AUDIT LOG — append only (§2.3)
--
-- There is deliberately no UPDATE and no DELETE policy on this table, and the
-- privileges are revoked as well. No user, including the Owner, can rewrite
-- history. The Owner can read it; nobody else can.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  actor_email  text,
  action       text not null,
  target_type  text,
  target_id    uuid,
  target_label text,
  diff         jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id, created_at desc);
create index audit_log_action_idx  on public.audit_log (action, created_at desc);
create index audit_log_target_idx  on public.audit_log (target_type, target_id);

alter table public.audit_log enable row level security;

-- Anyone signed in may append (their actions are recorded on their behalf).
create policy audit_insert on public.audit_log
  for insert to authenticated
  with check (actor_id = app.uid() or actor_id is null);

-- Only the Owner may read it.
create policy audit_select_owner on public.audit_log
  for select to authenticated
  using (app.is_owner());

-- Belt and braces: no grant exists for rewriting history.
revoke update, delete, truncate on public.audit_log from authenticated, anon;

create or replace function app.block_audit_mutation() returns trigger
  language plpgsql
  as $$
    begin
      raise exception 'audit_log is append-only';
    end;
  $$;

create trigger audit_log_no_update
  before update or delete on public.audit_log
  for each row execute function app.block_audit_mutation();
