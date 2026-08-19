-- =============================================================================
-- RLS PERMISSION TESTS
--
-- These are the tests that matter most (§9). They connect as the same
-- `authenticated` role PostgREST uses and impersonate real users by setting
-- request.jwt.claims, exactly as a student with devtools and an API token
-- would be seen by the database.
--
-- Run with:  psql -d hackathon_studio -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
-- Any failure raises an exception and aborts.
-- =============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------------
create or replace function pg_temp.act_as(u uuid) returns void
  language plpgsql as $$
  begin
    -- Session-level, not transaction-local: psql autocommits each statement,
    -- so a `set local` would evaporate before the next line runs and the test
    -- would silently pass as superuser with RLS bypassed.
    perform set_config('request.jwt.claims',
      json_build_object('sub', u, 'role', 'authenticated')::text, false);
    execute 'set role authenticated';
  end $$;

create or replace function pg_temp.act_as_anon() returns void
  language plpgsql as $$
  begin
    perform set_config('request.jwt.claims',
      json_build_object('role', 'anon')::text, false);
    execute 'set role anon';
  end $$;

create or replace function pg_temp.reset_role() returns void
  language plpgsql as $$
  begin
    execute 'reset role';
    perform set_config('request.jwt.claims', '', false);
  end $$;

create or replace function pg_temp.ok(cond boolean, label text) returns void
  language plpgsql as $$
  begin
    if cond then raise notice 'PASS  %', label;
    else raise exception 'FAIL  %', label; end if;
  end $$;

-- Assert that a statement does not take effect.
--
-- RLS blocks the two verbs differently and both count as "denied":
--   INSERT  -> raises "new row violates row-level security policy"
--   UPDATE/DELETE -> the row is simply invisible, so it silently affects
--                    zero rows with no error at all.
-- A trigger (the approval gate, the escalation guard) raises instead. This
-- helper accepts any of those and fails only if a row actually changed.
create or replace function pg_temp.denies(stmt text, label text) returns void
  language plpgsql as $$
  declare n int;
  begin
    begin
      execute stmt;
      get diagnostics n = row_count;
    exception when others then
      raise notice 'PASS  % (rejected: %)', label, left(sqlerrm, 60);
      return;
    end;
    if n = 0 then
      raise notice 'PASS  % (no rows matched)', label;
    else
      raise exception 'FAIL  % — % row(s) changed but none should have', label, n;
    end if;
  end $$;

create or replace function pg_temp.allows(stmt text, label text) returns void
  language plpgsql as $$
  begin
    execute stmt;
    raise notice 'PASS  %', label;
  exception when others then
    raise exception 'FAIL  % — statement was rejected: %', label, sqlerrm;
  end $$;

-- Assert a query yields nothing. A missing GRANT raises "permission denied"
-- while a policy simply returns no rows — both are a successful denial.
create or replace function pg_temp.reads_nothing(q text, label text) returns void
  language plpgsql as $$
  declare n int;
  begin
    begin
      execute 'select count(*) from (' || q || ') _s' into n;
    exception when others then
      raise notice 'PASS  % (rejected: %)', label, left(sqlerrm, 60);
      return;
    end;
    if n = 0 then
      raise notice 'PASS  %', label;
    else
      raise exception 'FAIL  % — % row(s) visible', label, n;
    end if;
  end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (as superuser, bypassing RLS)
-- ---------------------------------------------------------------------------
select pg_temp.reset_role();

-- Purge any leftovers from a previous run. The soft-delete triggers have to
-- come off first, otherwise DELETE only stamps deleted_at and the foreign keys
-- from assignments back to users still hold.
alter table public.comments    disable trigger comments_soft_delete;
alter table public.assignments disable trigger assignments_soft_delete;
alter table public.incidents   disable trigger incidents_soft_delete;

delete from public.comments
  where parent_id in (select id from public.assignments where title like 'RLSTEST%')
     or user_id  in (select id from public.users where email like '%@rlstest.local');
delete from public.incidents where description like 'RLSTEST%';
delete from public.assignments where title like 'RLSTEST%';
delete from public.archived_years where year = 2026;
delete from public.device_sessions
  where user_id in (select id from public.users where email like '%@rlstest.local');
delete from public.users where email like '%@rlstest.local';

alter table public.comments    enable trigger comments_soft_delete;
alter table public.assignments enable trigger assignments_soft_delete;
alter table public.incidents   enable trigger incidents_soft_delete;

create temp table t_ids (k text primary key, v uuid);

with d as (select id from public.departments where slug = 'sponsorship'),
     o as (select id from public.departments where slug = 'operations')
insert into t_ids (k, v)
select 'dept_sponsor', id from d
union all select 'dept_ops', id from o;

insert into public.users (email, name, tier, status, department_id)
select 'owner@rlstest.local', 'Owner', 'T4', 'active', null
returning id \gset owner_
insert into t_ids values ('owner', :'owner_id');

insert into public.users (email, name, tier, status, department_id)
select 'admin@rlstest.local', 'Admin', 'T3', 'active', null
returning id \gset admin_
insert into t_ids values ('admin', :'admin_id');

insert into public.users (email, name, tier, status, department_id)
select 'head@rlstest.local', 'Head', 'T2', 'active', v from t_ids where k='dept_sponsor'
returning id \gset head_
insert into t_ids values ('head', :'head_id');

insert into public.users (email, name, tier, status, department_id)
select 'member@rlstest.local', 'Member', 'T1', 'active', v from t_ids where k='dept_sponsor'
returning id \gset member_
insert into t_ids values ('member', :'member_id');

insert into public.users (email, name, tier, status, department_id)
select 'outsider@rlstest.local', 'Outsider', 'T1', 'active', v from t_ids where k='dept_ops'
returning id \gset outsider_
insert into t_ids values ('outsider', :'outsider_id');

insert into public.users (email, name, tier, status, department_id)
select 'advisor@rlstest.local', 'Advisor', 'T0', 'active', null
returning id \gset advisor_
insert into t_ids values ('advisor', :'advisor_id');

insert into public.users (email, name, tier, status, department_id)
select 'suspended@rlstest.local', 'Suspended', 'T1', 'suspended', v from t_ids where k='dept_sponsor'
returning id \gset susp_
insert into t_ids values ('suspended', :'susp_id');

select v as sponsor_dept from t_ids where k = 'dept_sponsor' \gset
select v as ops_dept     from t_ids where k = 'dept_ops'     \gset

insert into public.assignments (title, department_id, created_by, status)
values ('RLSTEST sponsor task', :'sponsor_dept', :'head_id', 'needs_review')
returning id \gset task_

insert into public.assignments (title, department_id, created_by, status)
values ('RLSTEST ops task', :'ops_dept', :'admin_id', 'not_started')
returning id \gset opstask_

\set QUIET off
\echo ''
\echo '=== TIER LADDER ==============================================='

-- ---------------------------------------------------------------------------
-- 1. Department read isolation
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:'member_id');
select pg_temp.ok(
  (select count(*) from public.assignments where id = :'task_id') = 1,
  'T1 member reads an assignment in their own department');
select pg_temp.ok(
  (select count(*) from public.assignments where id = :'opstask_id') = 0,
  'T1 member cannot read another department''s assignment');
select pg_temp.reset_role();

select pg_temp.act_as(:'admin_id');
select pg_temp.ok(
  (select count(*) from public.assignments where id = :'opstask_id') = 1,
  'T3 admin reads across all departments');
select pg_temp.reset_role();

select pg_temp.act_as(:'advisor_id');
select pg_temp.ok(
  (select count(*) from public.assignments where id = :'opstask_id') = 1,
  'T0 advisor reads everything');
select pg_temp.reset_role();

\echo ''
\echo '=== WRITE BOUNDARIES =========================================='

-- ---------------------------------------------------------------------------
-- 2. Advisors are read-only
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:'advisor_id');
select pg_temp.denies(
  format('insert into public.assignments (title, department_id) values (''RLSTEST advisor'', %L)', :'sponsor_dept'),
  'T0 advisor cannot create an assignment');
select pg_temp.allows(
  format('insert into public.comments (parent_type, parent_id, user_id, body) values (''assignment'', %L, %L, ''advisor note'')', :'task_id', :'advisor_id'),
  'T0 advisor CAN comment');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 3. Members cannot write department-wide
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:'member_id');
select pg_temp.denies(
  format('insert into public.assignments (title, department_id) values (''RLSTEST member'', %L)', :'sponsor_dept'),
  'T1 member cannot create an assignment');
select pg_temp.reset_role();

select pg_temp.act_as(:'head_id');
select pg_temp.allows(
  format('insert into public.assignments (title, department_id, created_by) values (''RLSTEST head made this'', %L, %L)', :'sponsor_dept', :'head_id'),
  'T2 head creates an assignment in their own department');
select pg_temp.denies(
  format('insert into public.assignments (title, department_id, created_by) values (''RLSTEST head cross-dept'', %L, %L)', :'ops_dept', :'head_id'),
  'T2 head cannot create in another department');
select pg_temp.reset_role();

\echo ''
\echo '=== APPROVAL GATE ============================================='

-- ---------------------------------------------------------------------------
-- 4. Only T2+ may approve
-- ---------------------------------------------------------------------------
select pg_temp.reset_role();
insert into public.assignment_assignees (assignment_id, user_id)
values (:'task_id', :'member_id');

select pg_temp.act_as(:'member_id');
select pg_temp.allows(
  format('update public.assignments set status = ''in_progress'' where id = %L', :'task_id'),
  'assignee moves their own task to In progress');
select pg_temp.denies(
  format('update public.assignments set status = ''approved'' where id = %L', :'task_id'),
  'assignee CANNOT move their task to Approved');
select pg_temp.reset_role();

select pg_temp.act_as(:'head_id');
select pg_temp.allows(
  format('update public.assignments set status = ''approved'' where id = %L', :'task_id'),
  'T2 head approves');
select pg_temp.reset_role();
select pg_temp.ok(
  (select approved_by from public.assignments where id = :'task_id') = :'head_id',
  'approved_by is stamped automatically by the trigger');

\echo ''
\echo '=== PRIVILEGE ESCALATION ======================================'

-- ---------------------------------------------------------------------------
-- 5. The attack the whole schema exists to stop
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:'member_id');
select pg_temp.denies(
  format('update public.users set tier = ''T4'' where id = %L', :'member_id'),
  'a student CANNOT promote themselves to Owner');
select pg_temp.denies(
  format('update public.users set status = ''active'' where id = %L', :'susp_id'),
  'a student CANNOT reactivate a suspended account');
select pg_temp.allows(
  format('update public.users set nickname = ''Prae'' where id = %L', :'member_id'),
  'a student CAN edit their own nickname');
select pg_temp.reset_role();

select pg_temp.act_as(:'admin_id');
select pg_temp.denies(
  format('update public.users set tier = ''T4'' where id = %L', :'admin_id'),
  'even T3 admin CANNOT change tiers');
select pg_temp.reset_role();

\echo ''
\echo '=== SUSPENDED ACCOUNTS ========================================'

select pg_temp.act_as(:'susp_id');
select pg_temp.ok(
  (select count(*) from public.assignments where id = :'task_id') = 0,
  'suspended user reads nothing');
select pg_temp.denies(
  format('insert into public.comments (parent_type, parent_id, user_id, body) values (''assignment'', %L, %L, ''hi'')', :'task_id', :'susp_id'),
  'suspended user cannot comment');
select pg_temp.reset_role();

\echo ''
\echo '=== AUDIT LOG IS APPEND-ONLY =================================='

select pg_temp.reset_role();
insert into public.audit_log (actor_id, action, target_type)
values (:'owner_id', 'test.event', 'assignment');

select pg_temp.act_as(:'member_id');
select pg_temp.ok(
  (select count(*) from public.audit_log) = 0,
  'a member cannot read the audit log at all');
select pg_temp.reset_role();

select pg_temp.act_as(:'owner_id');
select pg_temp.ok(
  (select count(*) from public.audit_log) >= 1,
  'the Owner can read the audit log');
select pg_temp.denies(
  'update public.audit_log set action = ''tampered''',
  'even the OWNER cannot edit the audit log');
select pg_temp.denies(
  'delete from public.audit_log',
  'even the OWNER cannot delete from the audit log');
select pg_temp.reset_role();

\echo ''
\echo '=== INCIDENTS: WRITE-OPEN, READ-RESTRICTED ===================='

select pg_temp.act_as(:'member_id');
select pg_temp.allows(
  format('insert into public.incidents (reported_by, description, severity) values (%L, ''RLSTEST spill'', ''low'')', :'member_id'),
  'any active staff member can file an incident');
select pg_temp.reset_role();

select pg_temp.act_as(:'outsider_id');
select pg_temp.ok(
  (select count(*) from public.incidents where description = 'RLSTEST spill') = 0,
  'a T1 in another department cannot read incidents');
select pg_temp.reset_role();

select pg_temp.act_as(:'admin_id');
select pg_temp.ok(
  (select count(*) from public.incidents where description = 'RLSTEST spill') = 1,
  'T3 admin can read incidents');
select pg_temp.reset_role();

\echo ''
\echo '=== NOTHING IS HARD-DELETED ==================================='

select pg_temp.act_as(:'head_id');
select pg_temp.allows(
  format('delete from public.assignments where id = %L', :'task_id'),
  'head issues a DELETE');
select pg_temp.reset_role();
select pg_temp.ok(
  (select deleted_at is not null from public.assignments where id = :'task_id'),
  'the row still exists and is only soft-deleted');

\echo ''
\echo '=== ARCHIVE FREEZE ============================================'

select pg_temp.reset_role();
insert into public.archived_years (year, frozen_by) values (2026, :'owner_id')
on conflict do nothing;
insert into public.assignments (title, department_id, created_by, year)
values ('RLSTEST archived', :'sponsor_dept', :'head_id', 2026)
returning id \gset arch_

select pg_temp.act_as(:'head_id');
select pg_temp.denies(
  format('update public.assignments set title = ''RLSTEST changed'' where id = %L', :'arch_id'),
  'a frozen year is read-only even for a department head');
select pg_temp.reset_role();

\echo ''
\echo '=== ANONYMOUS ACCESS =========================================='

select pg_temp.act_as_anon();
select pg_temp.reads_nothing('select 1 from public.users',
  'a logged-out visitor cannot read the staff directory');
select pg_temp.reads_nothing('select 1 from public.assignments',
  'a logged-out visitor cannot read assignments');
select pg_temp.reads_nothing('select 1 from public.audit_log',
  'a logged-out visitor cannot read the audit log');
select pg_temp.reset_role();

\echo ''
\echo '################################################################'
\echo '#  ALL RLS TESTS PASSED                                        #'
\echo '################################################################'
