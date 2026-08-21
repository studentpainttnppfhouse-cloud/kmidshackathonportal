# Database permission tests

`rls_test.sql` is the most important test file in this repository. It connects
as the same `authenticated` Postgres role that PostgREST uses and impersonates
real users by setting `request.jwt.claims` — which is exactly what the database
sees when a student opens devtools and calls the API directly.

## Running it

```bash
# against a local Postgres
createdb hackathon_studio
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d hackathon_studio -f "$f"; done
psql -v ON_ERROR_STOP=1 -d hackathon_studio -f tests/sql/rls_test.sql

# or against the real cluster
psql "$AURORA_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
```

The script raises an exception on the first failure, so a non-zero exit status
means something in the permission model regressed.

Locally you also need the three roles the policies grant to (`npm run
db:aurora` creates these for you on a real cluster):

```sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
```

## What it proves

- department read isolation, and that T3+ and T0 see across departments
- Advisors (T0) can comment but cannot create, edit or delete
- Members cannot create assignments; heads cannot create outside their department
- the approval gate: an assignee can advance their own task but cannot approve it
- **privilege escalation is impossible** — no student can set their own tier to
  T4, reactivate a suspended account, or have a T3 change tiers
- suspended accounts read and write nothing
- the audit log is append-only *including for the Owner*
- incidents are write-open to all staff but read-restricted to T3+
- DELETE only ever soft-deletes
- a frozen archive year rejects writes
- logged-out visitors reach nothing
