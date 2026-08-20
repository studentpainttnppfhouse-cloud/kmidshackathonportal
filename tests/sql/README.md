# Database permission tests

`rls_test.sql` is the most important test file in this repository. It connects
as the same `authenticated` Postgres role the app switches into, and
impersonates real users by setting `request.jwt.claims` — which is exactly what
the database sees on every request the portal makes.

## Running it

```bash
# against a local Postgres — db:setup creates the roles and applies the schema
createdb hackathon_studio
DATABASE_URL=postgresql://localhost:5432/hackathon_studio npm run db:setup
psql -v ON_ERROR_STOP=1 -d hackathon_studio -f tests/sql/rls_test.sql

# or against whichever database DATABASE_URL points at
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
```

The script raises an exception on the first failure, so a non-zero exit status
means something in the permission model regressed.

`npm run db:setup` creates the three roles the policies are written against.
By hand, that is:

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
