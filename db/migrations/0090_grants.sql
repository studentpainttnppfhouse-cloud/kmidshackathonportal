-- =============================================================================
-- 0090 GRANTS
-- RLS only filters rows a role is already allowed to touch. Without these
-- grants every policy above is unreachable and the API returns nothing.
-- Keep this file last: it applies to every table created before it.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Signed-in staff. What they can actually see and change is decided entirely
-- by the policies in the migrations above, never by these grants.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Logged-out visitors reach exactly two things: a published public form, and
-- the ability to submit one response to it.
grant select on public.forms to anon;
grant insert on public.form_responses to anon;

-- The audit log is append-only for everyone (§2.3). The trigger in 0010 also
-- refuses these at runtime; this removes the privilege as well, so the API
-- never even offers the verb.
revoke update, delete, truncate on public.audit_log from authenticated, anon;

-- Device sessions are issued and revoked server-side only.
revoke insert, delete on public.device_sessions from authenticated, anon;

-- Freezing a year is an Owner action routed through a Server Action.
revoke truncate on all tables in schema public from authenticated, anon;

-- Anything added later inherits the same baseline.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
