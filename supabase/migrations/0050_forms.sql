-- =============================================================================
-- 0050 FORMS (§5.8)
-- `schema` holds the ordered field list built in the drag-and-drop builder,
-- including per-field conditional logic. `settings` holds open/close dates,
-- one-response-per-user, login-required and the confirmation message.
-- =============================================================================

create table public.forms (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default 'Untitled form',
  description   text,
  department_id uuid references public.departments(id),
  owner_id      uuid references public.users(id),
  schema        jsonb not null default '{"fields":[]}'::jsonb,
  settings      jsonb not null default '{}'::jsonb,
  status        app.form_status not null default 'draft',
  banner_url    text,
  opens_at      timestamptz,
  closes_at     timestamptz,
  public_slug   text unique,
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index forms_dept_idx on public.forms (department_id) where deleted_at is null;

create trigger forms_touch before update on public.forms
  for each row execute function app.touch_updated_at();
create trigger forms_soft_delete before delete on public.forms
  for each row execute function app.soft_delete_guard();

-- Is this form currently accepting responses? Used by the anonymous policy
-- below so a logged-out respondent cannot submit to a closed or draft form.
create or replace function app.form_is_open(f uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select exists (
      select 1 from public.forms
      where id = f
        and deleted_at is null
        and status = 'published'
        and (opens_at is null or opens_at <= now())
        and (closes_at is null or closes_at >= now())
    );
  $$;

create or replace function app.form_is_public(f uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select exists (
      select 1 from public.forms
      where id = f and deleted_at is null and public_slug is not null
        and coalesce((settings ->> 'loginRequired')::boolean, false) = false
    );
  $$;

alter table public.forms enable row level security;

-- Staff read forms in departments they can see.
create policy forms_select on public.forms
  for select to authenticated
  using (
    (app.can_read_dept(department_id) or owner_id = app.uid())
    and (deleted_at is null or app.tier_at_least('T2'))
  );

-- The public submission page needs to read the form definition while logged
-- out — but only a published, public, currently-open form.
create policy forms_select_anon on public.forms
  for select to anon
  using (
    deleted_at is null
    and status = 'published'
    and public_slug is not null
    and coalesce((settings ->> 'loginRequired')::boolean, false) = false
    and (opens_at is null or opens_at <= now())
    and (closes_at is null or closes_at >= now())
  );

-- T2+ can create in their department, T3+ anywhere (§5.8).
create policy forms_insert on public.forms
  for insert to authenticated
  with check (app.can_write_dept(department_id) and app.year_writable(year));

create policy forms_update on public.forms
  for update to authenticated
  using (app.can_write_dept(department_id) and app.year_writable(year))
  with check (app.can_write_dept(department_id));

create policy forms_delete on public.forms
  for delete to authenticated
  using (app.can_write_dept(department_id) and app.year_writable(year));

-- ---------------------------------------------------------------------------
-- FORM RESPONSES
-- ---------------------------------------------------------------------------
create table public.form_responses (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid not null references public.forms(id) on delete cascade,
  user_id          uuid references public.users(id),
  respondent_email text,
  payload          jsonb not null default '{}'::jsonb,
  is_draft         boolean not null default false,
  submitted_at     timestamptz,
  -- Set when a response has been promoted to a staff account (§4).
  promoted_user_id uuid references public.users(id),
  promoted_notes   text,
  year             int not null default 2027,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index form_responses_form_idx on public.form_responses (form_id, submitted_at desc)
  where deleted_at is null;

create trigger form_responses_touch before update on public.form_responses
  for each row execute function app.touch_updated_at();
create trigger form_responses_soft_delete before delete on public.form_responses
  for each row execute function app.soft_delete_guard();

alter table public.form_responses enable row level security;

-- Staff who can write the form can read its responses. Respondents can always
-- read their own submission back.
create policy form_responses_select on public.form_responses
  for select to authenticated
  using (
    user_id = app.uid()
    or exists (
      select 1 from public.forms f
      where f.id = form_id and app.can_write_dept(f.department_id)
    )
  );

create policy form_responses_insert on public.form_responses
  for insert to authenticated
  with check (app.form_is_open(form_id));

-- Logged-out submission, only to a form that explicitly allows it.
create policy form_responses_insert_anon on public.form_responses
  for insert to anon
  with check (app.form_is_open(form_id) and app.form_is_public(form_id));

-- Editing after submit, when the form allows it.
create policy form_responses_update_own on public.form_responses
  for update to authenticated
  using (user_id = app.uid() and app.form_is_open(form_id))
  with check (user_id = app.uid());

create policy form_responses_update_staff on public.form_responses
  for update to authenticated
  using (exists (
    select 1 from public.forms f
    where f.id = form_id and app.can_write_dept(f.department_id)
  ))
  with check (exists (
    select 1 from public.forms f
    where f.id = form_id and app.can_write_dept(f.department_id)
  ));

create policy form_responses_delete_staff on public.form_responses
  for delete to authenticated
  using (exists (
    select 1 from public.forms f
    where f.id = form_id and app.can_write_dept(f.department_id)
  ));

-- Link a promoted staff member back to the application they came from (§4).
alter table public.users
  add constraint users_source_response_fk
  foreign key (source_response_id) references public.form_responses(id) on delete set null;

alter table public.spreadsheets
  add constraint spreadsheets_source_form_fk
  foreign key (source_form_id) references public.forms(id) on delete set null;
