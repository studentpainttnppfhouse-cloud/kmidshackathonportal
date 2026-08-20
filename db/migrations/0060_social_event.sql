-- =============================================================================
-- 0060 SOCIAL & EVENT DAY
-- Content calendar, social accounts, run sheet, check-ins, incidents.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SOCIAL MEDIA COMMAND CENTER (§5.11)
-- ---------------------------------------------------------------------------
create table public.content_items (
  id             uuid primary key default gen_random_uuid(),
  scheduled_date date not null,
  platform       text not null,
  format         text,
  caption        text,
  script         text,
  status         app.content_status not null default 'idea',
  designer_id    uuid references public.users(id),
  editor_id      uuid references public.users(id),
  poster_id      uuid references public.users(id),
  asset_file_id  uuid references public.files(id) on delete set null,
  department_id  uuid references public.departments(id),
  year           int not null default 2027,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index content_items_date_idx on public.content_items (scheduled_date)
  where deleted_at is null;

create trigger content_items_touch before update on public.content_items
  for each row execute function app.touch_updated_at();
create trigger content_items_soft_delete before delete on public.content_items
  for each row execute function app.soft_delete_guard();

alter table public.content_items enable row level security;

-- The calendar is visible to all staff; only Social (and T3+) edit it.
create policy content_items_select on public.content_items
  for select to authenticated
  using ((app.is_active() or app.is_advisor()) and (deleted_at is null or app.tier_at_least('T2')));

create policy content_items_insert on public.content_items
  for insert to authenticated
  with check (app.can_create_in_dept(department_id) and app.year_writable(year));

create policy content_items_update on public.content_items
  for update to authenticated
  using (
    app.year_writable(year)
    and (app.can_write_dept(department_id)
         or (app.is_active() and not app.is_advisor()
             and app.uid() in (designer_id, editor_id, poster_id)))
  )
  with check (
    app.can_write_dept(department_id)
    or (app.is_active() and not app.is_advisor()
        and app.uid() in (designer_id, editor_id, poster_id))
  );

create policy content_items_delete on public.content_items
  for delete to authenticated
  using (app.can_write_dept(department_id) and app.year_writable(year));

-- Accounts panel. Stores WHO holds access, never a password (§5.11).
create table public.social_accounts (
  id                    uuid primary key default gen_random_uuid(),
  platform              text not null,
  handle                text not null,
  url                   text,
  access_holder_user_id uuid references public.users(id),
  notes                 text,
  year                  int not null default 2027,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);

create trigger social_accounts_touch before update on public.social_accounts
  for each row execute function app.touch_updated_at();

alter table public.social_accounts enable row level security;

create policy social_accounts_select on public.social_accounts
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy social_accounts_write on public.social_accounts
  for all to authenticated
  using (app.tier_at_least('T2') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T2') and app.is_active() and not app.is_advisor());

-- ---------------------------------------------------------------------------
-- EVENT-DAY MODE (§5.12)
-- ---------------------------------------------------------------------------
create table public.event_items (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,
  start_time time not null,
  end_time   time,
  title      text not null,
  location   text,
  owner_id   uuid references public.users(id),
  notes      text,
  sort_order int not null default 0,
  year       int not null default 2027,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index event_items_day_idx on public.event_items (day, start_time)
  where deleted_at is null;

create trigger event_items_touch before update on public.event_items
  for each row execute function app.touch_updated_at();
create trigger event_items_soft_delete before delete on public.event_items
  for each row execute function app.soft_delete_guard();

alter table public.event_items enable row level security;

-- The run sheet is the one thing every single person needs on event day.
create policy event_items_select on public.event_items
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy event_items_write on public.event_items
  for all to authenticated
  using (app.tier_at_least('T2') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T2') and app.is_active() and not app.is_advisor());

-- Staff check-in / check-out.
create table public.checkins (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  day            date not null,
  checked_in_at  timestamptz,
  checked_out_at timestamptz,
  station        text,
  year           int not null default 2027,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (user_id, day)
);

create trigger checkins_touch before update on public.checkins
  for each row execute function app.touch_updated_at();

alter table public.checkins enable row level security;

-- You check yourself in; heads and above see the whole board.
create policy checkins_select on public.checkins
  for select to authenticated
  using (user_id = app.uid() or app.tier_at_least('T2') or app.is_advisor());

create policy checkins_insert on public.checkins
  for insert to authenticated
  with check ((user_id = app.uid() or app.tier_at_least('T3')) and app.is_active());

create policy checkins_update on public.checkins
  for update to authenticated
  using ((user_id = app.uid() or app.tier_at_least('T3')) and app.is_active())
  with check (user_id = app.uid() or app.tier_at_least('T3'));

-- Incidents: any staff member may file one, only T3+ may read them (§5.12).
create table public.incidents (
  id          uuid primary key default gen_random_uuid(),
  reported_by uuid references public.users(id),
  occurred_at timestamptz not null default now(),
  severity    app.incident_severity not null default 'low',
  description text not null,
  location    text,
  resolution  text,
  resolved_at timestamptz,
  year        int not null default 2027,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger incidents_touch before update on public.incidents
  for each row execute function app.touch_updated_at();
create trigger incidents_soft_delete before delete on public.incidents
  for each row execute function app.soft_delete_guard();

alter table public.incidents enable row level security;

-- Note the asymmetry: create is open to all active staff, read is T3+ only.
-- A reporter can see the report they just filed, and nothing else.
create policy incidents_select on public.incidents
  for select to authenticated
  using (app.tier_at_least('T3') or reported_by = app.uid());

create policy incidents_insert on public.incidents
  for insert to authenticated
  with check (reported_by = app.uid() and app.is_active());

create policy incidents_update on public.incidents
  for update to authenticated
  using (app.tier_at_least('T3') and app.is_active())
  with check (app.tier_at_least('T3') and app.is_active());

-- Reserve staff deployment board (§5.12).
create table public.reserve_deployments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users(id) on delete cascade,
  day         date not null,
  station     text not null,
  start_time  time,
  end_time    time,
  assigned_by uuid references public.users(id),
  note        text,
  year        int not null default 2027,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create trigger reserve_deployments_touch before update on public.reserve_deployments
  for each row execute function app.touch_updated_at();

alter table public.reserve_deployments enable row level security;

create policy reserve_deployments_select on public.reserve_deployments
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy reserve_deployments_write on public.reserve_deployments
  for all to authenticated
  using (app.tier_at_least('T3') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T3') and app.is_active() and not app.is_advisor());

-- Quick reference: WiFi, floor map, judges, emergency contacts, table numbers.
-- Cached client-side so it still renders when the database is unreachable.
create table public.quick_reference (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,
  label      text not null,
  value      text not null,
  sort_order int not null default 0,
  year       int not null default 2027,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger quick_reference_touch before update on public.quick_reference
  for each row execute function app.touch_updated_at();

alter table public.quick_reference enable row level security;

create policy quick_reference_select on public.quick_reference
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy quick_reference_write on public.quick_reference
  for all to authenticated
  using (app.tier_at_least('T3') and app.is_active() and not app.is_advisor())
  with check (app.tier_at_least('T3') and app.is_active() and not app.is_advisor());

-- Archive freeze table from 0010 — only the Owner may flip the switch (§5.13).
alter table public.archived_years enable row level security;

create policy archived_years_select on public.archived_years
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy archived_years_write on public.archived_years
  for all to authenticated using (app.is_owner()) with check (app.is_owner());

alter table public.archived_years
  add constraint archived_years_frozen_by_fk
  foreign key (frozen_by) references public.users(id);
