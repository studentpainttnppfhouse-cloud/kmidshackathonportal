-- =============================================================================
-- 0100 FILE BLOBS
-- Uploaded file contents.
--
-- The bytes live in the database rather than in an object store. That is an
-- unusual choice and a deliberate one: the portal now runs as a single service
-- against a single database, its uploads are brand assets and paperwork rather
-- than video, and §5.9 already caps a stored file at 50 MB and pushes anything
-- larger out to an external link. Keeping the bytes here means a backup of the
-- database is a complete backup of the portal, there is no second set of
-- credentials to rotate, and a file cannot outlive — or go missing from — the
-- row that describes it.
--
-- The table is separate from `files` so that listing a folder never drags the
-- contents of every file in it across the wire.
-- =============================================================================

create table if not exists public.file_blobs (
  file_id    uuid primary key references public.files (id) on delete cascade,
  bytes      bytea not null,
  created_at timestamptz not null default now()
);

comment on table public.file_blobs is
  'Contents of an uploaded file. One row per files.id; absent for link-only entries.';

alter table public.file_blobs enable row level security;

-- Whoever may see the `files` row may fetch its contents, and nobody else.
-- The policy defers to that table rather than restating the department rules,
-- so the two can never disagree.
create policy file_blobs_read on public.file_blobs
  for select using (
    exists (
      select 1 from public.files f
      where f.id = file_blobs.file_id and f.deleted_at is null
    )
  );

create policy file_blobs_write on public.file_blobs
  for insert with check (
    exists (
      select 1 from public.files f
      where f.id = file_blobs.file_id and f.deleted_at is null
    )
  );

-- A hard delete of the `files` row cascades. Soft deletes leave the bytes in
-- place, which is what makes the recycle bin recoverable.
create policy file_blobs_delete on public.file_blobs
  for delete using (app.tier_at_least('T3'));

grant select, insert, delete on public.file_blobs to authenticated;
