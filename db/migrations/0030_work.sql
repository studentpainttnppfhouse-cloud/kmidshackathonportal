-- =============================================================================
-- 0030 WORK
-- Assignments, comments, announcements, notifications.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ASSIGNMENTS (§5.5)
-- Status flow: not_started -> in_progress -> needs_review -> approved -> done.
-- Only T2+ may move an item to `approved`; that gate is a trigger, not a
-- policy, because it depends on the previous value of the row.
-- ---------------------------------------------------------------------------
create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  department_id   uuid references public.departments(id),
  created_by      uuid references public.users(id),
  due_date        date,
  priority        app.priority not null default 'medium',
  status          app.assignment_status not null default 'not_started',
  approved_by     uuid references public.users(id),
  approved_at     timestamptz,
  recurrence_rule text,
  parent_id       uuid references public.assignments(id),
  document_id     uuid,
  year            int not null default 2027,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index assignments_dept_idx   on public.assignments (department_id, status)
  where deleted_at is null;
create index assignments_due_idx    on public.assignments (due_date)
  where deleted_at is null;
create index assignments_year_idx   on public.assignments (year);

create trigger assignments_touch before update on public.assignments
  for each row execute function app.touch_updated_at();
create trigger assignments_soft_delete before delete on public.assignments
  for each row execute function app.soft_delete_guard();

create table public.assignment_assignees (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  assigned_at   timestamptz not null default now(),
  primary key (assignment_id, user_id)
);

create index assignment_assignees_user_idx on public.assignment_assignees (user_id);

-- Is the current user on the hook for this assignment? Members may advance
-- their own tasks even though they cannot write department-wide.
create or replace function app.is_assignee(a uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select exists (
      select 1 from public.assignment_assignees
      where assignment_id = a and user_id = app.uid()
    );
  $$;

alter table public.assignments enable row level security;

create policy assignments_select on public.assignments
  for select to authenticated
  using (app.can_read_dept(department_id) and (deleted_at is null or app.tier_at_least('T2')));

create policy assignments_insert on public.assignments
  for insert to authenticated
  with check (app.can_write_dept(department_id) and app.year_writable(year));

-- T2+ in the department, or an assignee updating their own task.
create policy assignments_update on public.assignments
  for update to authenticated
  using (
    app.year_writable(year)
    and (app.can_write_dept(department_id) or (app.is_active() and app.is_assignee(id)))
  )
  with check (
    app.can_write_dept(department_id) or (app.is_active() and app.is_assignee(id))
  );

create policy assignments_delete on public.assignments
  for delete to authenticated
  using (app.can_write_dept(department_id) and app.year_writable(year));

-- The approval gate (§5.5).
create or replace function app.guard_assignment_approval() returns trigger
  language plpgsql security definer set search_path = public, pg_temp
  as $$
    begin
      if current_setting('request.jwt.claims', true) is null then
        return new; -- service role
      end if;
      if new.status in ('approved', 'done')
         and old.status is distinct from new.status
         and not app.can_write_dept(new.department_id) then
        raise exception 'Only a department head or above can approve an assignment';
      end if;
      if new.status = 'approved' and old.status is distinct from 'approved' then
        new.approved_by := app.uid();
        new.approved_at := now();
      end if;
      return new;
    end;
  $$;

create trigger assignments_guard_approval
  before update on public.assignments
  for each row execute function app.guard_assignment_approval();

alter table public.assignment_assignees enable row level security;

create policy assignment_assignees_select on public.assignment_assignees
  for select to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and app.can_read_dept(a.department_id)
  ));

create policy assignment_assignees_write on public.assignment_assignees
  for all to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and app.can_write_dept(a.department_id)
  ))
  with check (exists (
    select 1 from public.assignments a
    where a.id = assignment_id and app.can_write_dept(a.department_id)
  ));

-- ---------------------------------------------------------------------------
-- COMMENTS
-- Polymorphic: assignments, documents, spreadsheets, files, content items.
-- `anchor` carries the Tiptap text-selection range for inline document
-- comments (§5.6).
-- ---------------------------------------------------------------------------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  parent_type text not null,
  parent_id   uuid not null,
  user_id     uuid references public.users(id),
  body        text not null,
  anchor      jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  year        int not null default 2027,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint comments_parent_type_known check (
    parent_type in ('assignment', 'document', 'spreadsheet', 'file', 'content_item')
  )
);

create index comments_parent_idx on public.comments (parent_type, parent_id)
  where deleted_at is null;

create trigger comments_touch before update on public.comments
  for each row execute function app.touch_updated_at();
create trigger comments_soft_delete before delete on public.comments
  for each row execute function app.soft_delete_guard();

alter table public.comments enable row level security;

-- Commenting is the one write every tier gets, Advisors included (§3).
create policy comments_select on public.comments
  for select to authenticated using (app.is_active() or app.is_advisor());

create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    user_id = app.uid()
    and (app.is_active() or app.is_advisor())
    and app.year_writable(year)
  );

create policy comments_update_own on public.comments
  for update to authenticated
  using (user_id = app.uid() or app.tier_at_least('T2'))
  with check (user_id = app.uid() or app.tier_at_least('T2'));

create policy comments_delete_own on public.comments
  for delete to authenticated
  using (user_id = app.uid() or app.tier_at_least('T2'));

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS (§5.10)
-- ---------------------------------------------------------------------------
create table public.announcements (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  body          text not null,
  scope         app.announcement_scope not null default 'department',
  department_id uuid references public.departments(id),
  author_id     uuid references public.users(id),
  pinned        boolean not null default false,
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index announcements_scope_idx on public.announcements (scope, department_id)
  where deleted_at is null;

create trigger announcements_touch before update on public.announcements
  for each row execute function app.touch_updated_at();
create trigger announcements_soft_delete before delete on public.announcements
  for each row execute function app.soft_delete_guard();

alter table public.announcements enable row level security;

create policy announcements_select on public.announcements
  for select to authenticated
  using (
    (app.is_active() or app.is_advisor())
    and (scope = 'all' or app.can_read_dept(department_id))
    and (deleted_at is null or app.tier_at_least('T2'))
  );

-- All-staff announcements are T3+ (§3); department ones are T2+.
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (
    app.year_writable(year)
    and case when scope = 'all'
      then app.tier_at_least('T3') and app.is_active() and not app.is_advisor()
      else app.can_write_dept(department_id) end
  );

create policy announcements_update on public.announcements
  for update to authenticated
  using (
    app.year_writable(year)
    and case when scope = 'all'
      then app.tier_at_least('T3') and app.is_active() and not app.is_advisor()
      else app.can_write_dept(department_id) end
  )
  with check (
    case when scope = 'all'
      then app.tier_at_least('T3') and app.is_active() and not app.is_advisor()
      else app.can_write_dept(department_id) end
  );

create policy announcements_delete on public.announcements
  for delete to authenticated
  using (
    case when scope = 'all'
      then app.tier_at_least('T3') and app.is_active() and not app.is_advisor()
      else app.can_write_dept(department_id) end
  );

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

alter table public.announcement_reads enable row level security;

-- Read receipts: you write your own, authors and T2+ can see the tally.
create policy announcement_reads_select on public.announcement_reads
  for select to authenticated
  using (user_id = app.uid() or app.tier_at_least('T2'));

create policy announcement_reads_insert on public.announcement_reads
  for insert to authenticated with check (user_id = app.uid());

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS (§5.10) — in-app bell. No push notifications, by design.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index notifications_user_idx on public.notifications (user_id, read_at)
  where deleted_at is null;

create trigger notifications_touch before update on public.notifications
  for each row execute function app.touch_updated_at();

alter table public.notifications enable row level security;

-- Your notifications are yours alone. Not even the Owner reads them here.
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = app.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (app.is_active() and not app.is_advisor());
