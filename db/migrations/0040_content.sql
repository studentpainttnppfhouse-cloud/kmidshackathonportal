-- =============================================================================
-- 0040 CONTENT
-- Folders, documents (+ versions, + per-document permissions), spreadsheets,
-- and the file library.
-- =============================================================================

create table public.folders (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  department_id uuid references public.departments(id),
  parent_id     uuid references public.folders(id),
  kind          app.folder_kind not null default 'doc',
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create trigger folders_touch before update on public.folders
  for each row execute function app.touch_updated_at();
create trigger folders_soft_delete before delete on public.folders
  for each row execute function app.soft_delete_guard();

alter table public.folders enable row level security;

create policy folders_select on public.folders
  for select to authenticated using (app.can_read_dept(department_id));
create policy folders_write on public.folders
  for all to authenticated
  using (app.can_create_in_dept(department_id) and app.year_writable(year))
  with check (app.can_create_in_dept(department_id) and app.year_writable(year));

-- ---------------------------------------------------------------------------
-- DOCUMENTS (§5.6)
-- `content` is the Tiptap JSON document. `yjs_state` holds the CRDT update
-- log for collaborative editing. `search_vector` powers full-text search.
-- ---------------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default 'Untitled',
  department_id uuid references public.departments(id),
  owner_id      uuid references public.users(id),
  folder_id     uuid references public.folders(id),
  content       jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  plain_text    text not null default '',
  yjs_state     bytea,
  status        app.doc_status not null default 'draft',
  approved_by   uuid references public.users(id),
  approved_at   timestamptz,
  tags          text[] not null default '{}',
  search_vector tsvector,
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index documents_dept_idx   on public.documents (department_id)
  where deleted_at is null;
create index documents_search_idx on public.documents using gin (search_vector);
create index documents_tags_idx   on public.documents using gin (tags);

create or replace function app.documents_search_vector() returns trigger
  language plpgsql
  as $$
    begin
      new.search_vector :=
        setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(new.plain_text, '')), 'B');
      return new;
    end;
  $$;

create trigger documents_search before insert or update of title, plain_text
  on public.documents for each row execute function app.documents_search_vector();
create trigger documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();
create trigger documents_soft_delete before delete on public.documents
  for each row execute function app.soft_delete_guard();

-- Per-document overrides (§5.6). Default is inherit-from-department.
create table public.document_permissions (
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  level       app.permission_level not null default 'view',
  granted_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);

create or replace function app.doc_grant(d uuid, min app.permission_level)
  returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select exists (
      select 1 from public.document_permissions p
      where p.document_id = d and p.user_id = app.uid()
        and case min
          when 'view'    then true
          when 'comment' then p.level in ('comment', 'edit')
          when 'edit'    then p.level = 'edit'
        end
    );
  $$;

alter table public.documents enable row level security;

-- Readable if the department allows it, you own it, or you hold a grant.
create policy documents_select on public.documents
  for select to authenticated
  using (
    (
      app.can_read_dept(department_id)
      or owner_id = app.uid()
      or app.doc_grant(id, 'view')
    )
    and (deleted_at is null or app.tier_at_least('T2') or owner_id = app.uid())
  );

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    app.can_create_in_dept(department_id)
    and owner_id = app.uid()
    and app.year_writable(year)
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    app.year_writable(year)
    and (
      owner_id = app.uid() and app.is_active() and not app.is_advisor()
      or app.can_write_dept(department_id)
      or (app.doc_grant(id, 'edit') and app.is_active() and not app.is_advisor())
    )
  )
  with check (
    owner_id = app.uid() and app.is_active() and not app.is_advisor()
    or app.can_write_dept(department_id)
    or (app.doc_grant(id, 'edit') and app.is_active() and not app.is_advisor())
  );

create policy documents_delete on public.documents
  for delete to authenticated
  using (
    app.year_writable(year)
    and (owner_id = app.uid() or app.can_write_dept(department_id))
    and not app.is_advisor()
  );

alter table public.document_permissions enable row level security;

create policy document_permissions_select on public.document_permissions
  for select to authenticated
  using (user_id = app.uid() or exists (
    select 1 from public.documents d
    where d.id = document_id and (d.owner_id = app.uid() or app.can_write_dept(d.department_id))
  ));

create policy document_permissions_write on public.document_permissions
  for all to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id and (d.owner_id = app.uid() or app.can_write_dept(d.department_id))
  ))
  with check (exists (
    select 1 from public.documents d
    where d.id = document_id and (d.owner_id = app.uid() or app.can_write_dept(d.department_id))
  ));

-- Version history (§5.6). Snapshots are written on a debounce and can be
-- named; restoring writes a fresh snapshot rather than rewinding history.
create table public.document_versions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  content     jsonb not null,
  plain_text  text not null default '',
  label       text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);

create index document_versions_doc_idx
  on public.document_versions (document_id, created_at desc);

alter table public.document_versions enable row level security;

create policy document_versions_select on public.document_versions
  for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.id = document_id
      and (app.can_read_dept(d.department_id) or d.owner_id = app.uid()
           or app.doc_grant(d.id, 'view'))
  ));

create policy document_versions_insert on public.document_versions
  for insert to authenticated
  with check (exists (
    select 1 from public.documents d
    where d.id = document_id
      and (d.owner_id = app.uid() or app.can_write_dept(d.department_id)
           or app.doc_grant(d.id, 'edit'))
  ));

-- ---------------------------------------------------------------------------
-- SPREADSHEETS (§5.7)
-- `data` holds { cells, formats, colWidths, rowHeights, frozen } as JSON.
-- Formulas are stored as authored text; HyperFormula evaluates them client
-- side, so the database never needs a formula parser.
-- ---------------------------------------------------------------------------
create table public.spreadsheets (
  id            uuid primary key default gen_random_uuid(),
  title         text not null default 'Untitled sheet',
  department_id uuid references public.departments(id),
  owner_id      uuid references public.users(id),
  folder_id     uuid references public.folders(id),
  data          jsonb not null default '{"cells":{},"formats":{}}'::jsonb,
  yjs_state     bytea,
  status        app.doc_status not null default 'draft',
  tags          text[] not null default '{}',
  source_form_id uuid,
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index spreadsheets_dept_idx on public.spreadsheets (department_id)
  where deleted_at is null;

create trigger spreadsheets_touch before update on public.spreadsheets
  for each row execute function app.touch_updated_at();
create trigger spreadsheets_soft_delete before delete on public.spreadsheets
  for each row execute function app.soft_delete_guard();

alter table public.spreadsheets enable row level security;

create policy spreadsheets_select on public.spreadsheets
  for select to authenticated
  using (
    (app.can_read_dept(department_id) or owner_id = app.uid())
    and (deleted_at is null or app.tier_at_least('T2') or owner_id = app.uid())
  );

create policy spreadsheets_insert on public.spreadsheets
  for insert to authenticated
  with check (
    app.can_create_in_dept(department_id)
    and owner_id = app.uid()
    and app.year_writable(year)
  );

create policy spreadsheets_update on public.spreadsheets
  for update to authenticated
  using (
    app.year_writable(year)
    and ((owner_id = app.uid() and app.is_active() and not app.is_advisor())
         or app.can_write_dept(department_id))
  )
  with check (
    (owner_id = app.uid() and app.is_active() and not app.is_advisor())
    or app.can_write_dept(department_id)
  );

create policy spreadsheets_delete on public.spreadsheets
  for delete to authenticated
  using (
    app.year_writable(year)
    and (owner_id = app.uid() or app.can_write_dept(department_id))
    and not app.is_advisor()
  );

create table public.spreadsheet_versions (
  id             uuid primary key default gen_random_uuid(),
  spreadsheet_id uuid not null references public.spreadsheets(id) on delete cascade,
  data           jsonb not null,
  label          text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create index spreadsheet_versions_sheet_idx
  on public.spreadsheet_versions (spreadsheet_id, created_at desc);

alter table public.spreadsheet_versions enable row level security;

create policy spreadsheet_versions_select on public.spreadsheet_versions
  for select to authenticated
  using (exists (
    select 1 from public.spreadsheets s
    where s.id = spreadsheet_id
      and (app.can_read_dept(s.department_id) or s.owner_id = app.uid())
  ));

create policy spreadsheet_versions_insert on public.spreadsheet_versions
  for insert to authenticated
  with check (exists (
    select 1 from public.spreadsheets s
    where s.id = spreadsheet_id
      and (s.owner_id = app.uid() or app.can_write_dept(s.department_id))
  ));

-- ---------------------------------------------------------------------------
-- FILES (§5.9)
-- 50 MB cap enforced here as well as in the upload action; anything larger is
-- stored as an external link instead.
-- ---------------------------------------------------------------------------
create table public.files (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  storage_path  text,
  external_url  text,
  mime          text,
  size          bigint,
  department_id uuid references public.departments(id),
  folder_id     uuid references public.folders(id),
  uploaded_by   uuid references public.users(id),
  tags          text[] not null default '{}',
  is_brand_asset boolean not null default false,
  year          int not null default 2027,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  constraint files_have_a_source check (storage_path is not null or external_url is not null),
  constraint files_size_cap check (size is null or size <= 52428800)
);

create index files_dept_idx on public.files (department_id) where deleted_at is null;
create index files_tags_idx on public.files using gin (tags);

create trigger files_touch before update on public.files
  for each row execute function app.touch_updated_at();
create trigger files_soft_delete before delete on public.files
  for each row execute function app.soft_delete_guard();

alter table public.files enable row level security;

create policy files_select on public.files
  for select to authenticated
  using (
    app.can_read_dept(department_id)
    and (deleted_at is null or app.tier_at_least('T2') or uploaded_by = app.uid())
  );

create policy files_insert on public.files
  for insert to authenticated
  with check (
    app.can_create_in_dept(department_id)
    and uploaded_by = app.uid()
    and app.year_writable(year)
  );

create policy files_update on public.files
  for update to authenticated
  using (
    app.year_writable(year)
    and ((uploaded_by = app.uid() and app.is_active() and not app.is_advisor())
         or app.can_write_dept(department_id))
  )
  with check (
    (uploaded_by = app.uid() and app.is_active() and not app.is_advisor())
    or app.can_write_dept(department_id)
  );

create policy files_delete on public.files
  for delete to authenticated
  using (
    app.year_writable(year)
    and (uploaded_by = app.uid() or app.can_write_dept(department_id))
    and not app.is_advisor()
  );

alter table public.assignments
  add constraint assignments_document_fk
  foreign key (document_id) references public.documents(id) on delete set null;
