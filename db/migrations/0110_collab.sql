-- =============================================================================
-- 0100 COLLABORATION RELAY
-- Supabase Realtime carried Yjs updates between editors over a websocket. On
-- Aurora there is no broadcast channel, so peers hand updates to each other
-- through a table and read back what they have not seen yet.
--
-- Nothing here is document state: `documents.content` is still the saved copy,
-- written by the existing autosave. These rows are in-flight edits with a
-- lifetime of seconds, kept only long enough for the other editors to apply
-- them.
-- =============================================================================

create table public.collab_messages (
  id           bigserial primary key,
  document_id  uuid not null references public.documents(id) on delete cascade,
  -- The Yjs client id that sent it, so a peer never re-applies its own update.
  sender       text not null,
  event        text not null,
  payload      jsonb not null,
  created_at   timestamptz not null default now()
);

-- Every read is "what is new for this document since id N".
create index collab_messages_document_idx on public.collab_messages (document_id, id);
create index collab_messages_created_idx on public.collab_messages (created_at);

/**
 * May the current user edit this document?
 *
 * The same condition as `documents_update` in 0040. Broadcasting an update is
 * an edit — a viewer who may only read must not be able to push changes into
 * someone else's editor.
 */
create or replace function app.can_edit_doc(d uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$
    select exists (
      select 1 from public.documents doc
      where doc.id = d
        and doc.deleted_at is null
        and app.year_writable(doc.year)
        and (
          doc.owner_id = app.uid() and app.is_active() and not app.is_advisor()
          or app.can_write_dept(doc.department_id)
          or (app.doc_grant(doc.id, 'edit') and app.is_active() and not app.is_advisor())
        )
    );
  $$;

comment on function app.can_edit_doc(uuid) is
  'Mirrors the documents_update policy, for the collaboration relay.';

alter table public.collab_messages enable row level security;

-- Readable when the document is. The subquery is itself subject to
-- documents_select, so this stays correct if that policy ever changes.
create policy collab_messages_select on public.collab_messages
  for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id));

create policy collab_messages_insert on public.collab_messages
  for insert to authenticated
  with check (app.can_edit_doc(document_id));

-- Relay traffic is never edited or removed by a user; it ages out (below).
revoke update, delete on public.collab_messages from authenticated, anon;

/**
 * Drop relay rows nobody can still need.
 *
 * A joining editor asks for a snapshot from a peer rather than replaying
 * history, so anything older than a few minutes is dead weight. Called
 * opportunistically on write rather than on a schedule, because there is no
 * scheduler here and the table is small enough that it costs nothing.
 */
create or replace function app.prune_collab_messages() returns void
  language sql security definer set search_path = public, pg_temp
  as $$
    delete from public.collab_messages where created_at < now() - interval '5 minutes';
  $$;

grant execute on function app.prune_collab_messages() to authenticated;
grant select, insert on public.collab_messages to authenticated;
grant usage, select on sequence public.collab_messages_id_seq to authenticated;
