# Hackathon Studio

Internal staff portal for **KMIDS Hackathon 2027** — MedTech & Digital Health,
20–21 March 2027, KMIDS Building 7th floor, Bangkok.

Built for 25–40 high-school student staff and 6 teachers across six
departments, with heavy phone usage on the event days themselves.

> **If you are the student maintaining this next year, start here.** The
> sections below cover local setup, the environment variables, how permissions
> work, and how to deploy. `SCHEMA.md` explains every database table in plain
> language.

---

## Quick start

### See it running in two minutes, with no accounts

If you have Postgres on your machine, this needs nothing else:

```bash
git clone <this repo>
cd kmidshackathonportal
npm install
npm run dev:local              # http://localhost:3000
```

That creates the database, applies the migrations, loads demo content, and
starts the app. Sign in as **june@kmids.ac.th** — no password, no setup.

`dev:local` needs no cloud account at all: the app talks to your local
Postgres directly, uploads go to a `.storage/` directory, and the same RLS
policies apply as in production — so what you build against is what ships.
Live collaboration works locally too.

### Going live on Aurora

```bash
cp .env.example .env.local     # fill in the values below
npm run db:aurora -- --seed    # roles, migrations, demo data
npm run dev
```

`db:aurora` is resumable and safe to re-run: it records which migrations have
already applied and skips them. Setting up the AWS side takes about twenty
minutes the first time — see *Aurora PostgreSQL on AWS* below for the full
walkthrough.

### 1. Create the database

An Aurora PostgreSQL cluster (Serverless v2 is fine), with **IAM database
authentication** turned on. Any PostgreSQL 14+ works — Neon, RDS, or a server
of your own — the app only needs a connection and the ability to create roles.

### 2. Run the migrations

```bash
npm run db:aurora
```

That creates the three roles the policies grant to, then applies every file in
`supabase/migrations/` in filename order:

```
0010_foundation.sql      extensions, enums, RLS helpers, the audit log
0020_identity.sql        departments, users, invites, invite keys, sessions
0030_work.sql            assignments, comments, announcements, notifications
0040_content.sql         folders, documents, spreadsheets, files
0050_forms.sql           forms and responses
0060_social_event.sql    content calendar, run sheet, check-ins, incidents
0070_seed.sql            the six departments and the event-day reference data
0080_bootstrap_owner.sql the owner bootstrap helper
0090_grants.sql          table privileges — must be last
0100_collab.sql          the relay live document editing runs over
```

Order matters. `0090_grants.sql` applies to every table created before it, so
running it early silently leaves earlier tables unreachable.

### 3. Create the bucket

An S3 bucket in the same account, named in `FILES_BUCKET`. It holds uploaded
images, PDFs and design exports, and should stay **private** — the app hands
out pre-signed links that expire rather than public URLs. The 50 MB per-file
cap is enforced in the upload action, in the database constraint, and in the
UI.

For development, set `FILES_DIR` instead and uploads go to a local directory.

### 4. Set the Owner emails

`OWNER_EMAIL` and `OWNER_BACKUP_EMAIL` become Owner (T4) accounts the first
time they sign in. **Two Owners always exist** so that one graduating student
is never a single point of failure.

If Owner access is ever lost, changing `OWNER_EMAIL` and signing in with that
address restores it — the app repairs the account back to T4 on sign-in.

---

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `RDS_HOSTNAME` | yes | The cluster's writer endpoint |
| `RDS_DATABASE` | yes | Database name |
| `RDS_USERNAME` | yes | The login the app connects as |
| `AWS_REGION` | yes | Region of the cluster and the bucket |
| `AWS_ROLE_ARN` | yes\* | IAM role to assume. \*Or `RDS_PASSWORD` instead |
| `FILES_BUCKET` | yes\* | S3 bucket for uploads. \*Or `FILES_DIR` for local disk |
| `OWNER_EMAIL` | yes | First Owner, created at T4 on first sign-in |
| `OWNER_BACKUP_EMAIL` | recommended | Second Owner |
| `RDS_PORT` | no | Defaults to 5432 |
| `SCHOOL_EMAIL_DOMAIN` | no | Defaults to `kmids.ac.th` |

`.env.local` is gitignored. Never commit real credentials.

**Alternate names.** The AWS and Postgres integrations each inject their own
variable names, so every value is also read from the names below — set
whichever you have. The whole connection can be given as one URI instead:
`AURORA_DATABASE_URL` (or `RDS_DATABASE_URL`).

| Canonical | Also read from |
| --- | --- |
| `RDS_HOSTNAME` | `RDS_HOST`, `AURORA_HOST`, `PGHOST`, `POSTGRES_HOST` |
| `RDS_PORT` | `PGPORT`, `POSTGRES_PORT` |
| `RDS_DATABASE` | `RDS_DB_NAME`, `PGDATABASE`, `POSTGRES_DATABASE` |
| `RDS_USERNAME` | `RDS_USER`, `PGUSER`, `POSTGRES_USER` |
| `RDS_PASSWORD` | `PGPASSWORD`, `POSTGRES_PASSWORD` |
| `AWS_REGION` | `AWS_DEFAULT_REGION`, `RDS_REGION` |
| `AWS_ROLE_ARN` | `RDS_ROLE_ARN` |
| `FILES_BUCKET` | `S3_BUCKET`, `AWS_S3_BUCKET`, `STORAGE_BUCKET` |

---

## Aurora PostgreSQL on AWS

Aurora is the portal's only database. The app connects to it directly with
`pg` — there is no PostgREST, no Supabase project, and no service in between.

| Piece | Where |
| --- | --- |
| Connection pool, IAM auth, TLS | `src/lib/aws/pool.ts` |
| Where the settings come from | `src/lib/aws/config.ts` |
| The query builder the app writes against | `src/lib/pg/` |
| Per-user, anonymous and admin clients | `src/lib/pg/server.ts` |
| File uploads (S3, or local disk) | `src/lib/storage/` |
| Health check | `GET /api/health/db` |
| Schema + roles + demo data | `npm run db:aurora` |
| AWS's public CA bundle | `certs/rds-global-bundle.pem` |

### There is no database password

Following [Vercel's Aurora guide](https://vercel.com/docs/storage/aurora), the
deployment authenticates with **RDS IAM auth over Vercel OIDC**:

```
Vercel deployment  ──OIDC token──▶  AWS STS  ──credentials──▶  IAM role
                                                                   │
Aurora  ◀──15-minute signed token──  @aws-sdk/rds-signer  ◀────────┘
```

Nothing long-lived is stored in the Vercel dashboard, so there is no database
secret to leak, rotate or hand over at the end of the year. `pg` is given a
*function* for its password, not a string, so an expired token is replaced on
the next connection without recycling the pool.

`RDS_PASSWORD` is accepted as a fallback, because a laptop has no OIDC token to
exchange.

TLS is verified against `certs/rds-global-bundle.pem`, AWS's published trust
store. The usual shortcut — `rejectUnauthorized: false` — encrypts the
connection but accepts *any* certificate, so it defends against nothing. The
bundle is a public list of CAs, not a key; it is the one `*.pem` file
`.gitignore` deliberately lets through. Re-download it if it ever expires:

```bash
curl -o certs/rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```

### Setting it up

**On AWS, once:**

1. Create the Aurora PostgreSQL cluster (Serverless v2 is fine).
2. Turn on **IAM database authentication** — cluster → Modify → Database
   authentication. Without it, every IAM token is rejected at the door.
3. Create the login the app will use, and let it authenticate by token:
   ```sql
   create user portal;
   grant rds_iam to portal;
   ```
4. Allow Vercel in: the cluster's security group needs inbound TCP 5432, and
   the cluster needs to be publicly accessible unless you are routing through a
   VPC connector.

**On Vercel, once:** install the AWS integration and link it to an IAM role
whose trust policy accepts Vercel's OIDC issuer for this project. That is what
provides `AWS_ROLE_ARN`.

**Then, locally:**

```bash
vercel env pull            # brings down RDS_HOSTNAME, AWS_ROLE_ARN, and the rest
npm run db:aurora -- --check    # connect and report, change nothing
npm run db:aurora               # roles + all 9 migrations
npm run db:aurora -- --seed     # ...and the demo data, if the database is empty
```

`db:aurora` is resumable: it records what it has applied in `public._migrations`
and skips those, so re-running it after a failure picks up where it stopped.

Then open **`/api/health/db`** on the deployment. It answers with the server
version and the round-trip time, or names the variable that is missing and the
console page that fixes it.

### The three roles Aurora does not have

Every policy in `supabase/migrations` is written `to authenticated`, and
`0090_grants.sql` grants privileges to `anon`, `authenticated` and
`service_role`. A bare Aurora cluster has none of them, and the first migration fails on the first policy
without them. `db:aurora` creates them, and grants all three to your login user
so the app can switch between them per request.

One thing needs a privileged user: `0010_foundation.sql` creates the `pgcrypto`
and `pg_trgm` extensions, which on Aurora only `rds_superuser` may do. Run
`db:aurora` once as the cluster's master user, or have an admin run the two
`create extension` statements first.

### Permissions survive the move

This is the part that mattered most, and it works. PostgREST authorises a
request by switching to the `authenticated` role and putting the JWT claims in
`request.jwt.claims`; every policy reads them back through `app.uid()`.
`withRls()` in `src/lib/aws/pool.ts` does exactly those two statements, so the
same policies — not the Node process — keep deciding what each person sees.

Verified against the real schema and the demo data: an Owner sees 3 documents
and 16 assignments, a T1 member sees 0 and 2, and an anonymous connection is
refused the user directory but can still load a published form. Both settings
are transaction-local, so a connection handed back to the pool carries no trace
of who it just served.

### How the queries still look like PostgREST

The app was written against the Supabase query builder — 153 call sites of
`db.from('assignments').select(...).eq(...)`. Rather than hand-rewrite every
one of them into SQL, `src/lib/pg/` implements that same interface on top of
`pg`. A dropped filter in a hand rewrite looks exactly like a working query,
and there were 153 chances to make that mistake.

| File | What it does |
| --- | --- |
| `select.ts` | Parses the `select=` grammar, embeds and all |
| `relationships.ts` | The foreign-key graph, generated from the migrations |
| `sql.ts` | Turns a parsed select into SQL, embeds as JSON subqueries |
| `builder.ts` | The chainable builder; resolves to `{ data, error }` |
| `server.ts` | The three clients — per-user, anonymous, admin |

Embedding works the way it did: `owner:owner_id ( nickname )` becomes a
correlated subquery returning JSON, so a nested read is still one round trip
*and* the embedded table is filtered by its own policies. Because the FK graph
decides how an embed resolves, it is generated and committed rather than read
from the live database at runtime — run `npm run db:relations` after changing
a foreign key, and `npm run db:relations -- --check` fails if it is stale.

**Live document editing** moved from Supabase Realtime to a relay table
(`0100_collab.sql`) that peers poll through `/api/collab/[documentId]`.
Polling is chattier than a websocket, but it works on any host — including
serverless ones that will not hold a connection open — and it needs no service
beyond the database. The editor still falls back to solo autosave when the
relay is unreachable.

**File uploads** moved to S3, behind `src/lib/storage/`. A local-disk driver
is selected by `FILES_DIR` so development needs no AWS account.

---

## How sign-in works

**Email only. No password, no OAuth.** You type your school address and you
are in, and the device stays signed in for a year.

That is a deliberate trade for an internal, invite-only staff portal: the cost
of a forgotten password at 7 AM on event morning is higher than the cost of
someone typing a colleague's address. **Anyone who knows a staff email can
sign in as them**, so the tier system — not the login — is what actually
protects anything, and every action is attributed in the audit log.

### The four ways in

Nobody gets in unless the Owner has let them in.

1. **Owner bootstrap** — an address in `OWNER_EMAIL` or `OWNER_BACKUP_EMAIL`
   becomes T4 automatically.
2. **Direct invite** — the Owner adds addresses in the Owner Console with a
   pre-set tier and department. Signing in creates the account with those
   already applied. Bulk paste of comma, space or newline separated addresses
   is supported.
3. **Invite key** — a shareable code carrying a tier, department, expiry and
   max-uses counter. Good for onboarding a whole department at once. Revoking
   a key does not remove accounts already created with it.
4. **Access request** — a school address with no invite gets an account with
   status `requested` and **access to nothing**. They see a waiting screen; the
   Owner approves or rejects them from the queue.

Anything that is not a school address and has no invite is refused, and the
attempt is recorded.

### Staying signed in across deploys

The session lives in two places that both survive a redeploy: a one-year
`httpOnly` cookie on the device, and a row in `device_sessions`. Nothing is
held in server memory, so **shipping a new build does not sign anyone out**.
The expiry rolls forward whenever a device is used, so an active phone never
gets logged out.

The cookie holds a 32-byte random token; only its SHA-256 hash is stored, so a
leaked database dump does not hand over live sessions. Suspending or banning
someone revokes all their sessions immediately.

Manage your own devices under **Settings → Signed-in devices**.

---

## How permissions work

**Permissions are enforced in the database, not the UI.** Hiding a button is
not security — assume a student will open devtools and call the API directly.

Every table has Row-Level Security policies, written in the same migration as
the table itself. The app talks to PostgREST as the signed-in user, so the
rows that come back are already filtered. There is no "and also check the tier
in JavaScript" step, because that would be a second source of truth that could
drift.

### The tiers

| Tier | Name | Scope |
| --- | --- | --- |
| `T0` | Advisor | Reads everything except the Owner Console and interview/performance data. Can comment. Cannot create, edit or delete. |
| `T1` | Member | Reads own department + General. Creates and edits own documents, sheets and files. Updates assignments assigned to them. Comments. |
| `T2` | Department Head | Full read/write in own department. Creates and assigns assignments. Approves deliverables. Read-only elsewhere. |
| `T3` | Administration | Full read/write across all departments. Publishes all-staff announcements. All analytics. **Cannot** manage users or read the audit log. |
| `T4` | Owner | Everything in T3, plus the Owner Console: users, tiers, invites, suspensions, bans, audit log, exports, ownership transfer. |

Since sign-in is email-only, there is no auth token to borrow. Instead every
statement runs inside a transaction that switches to the `authenticated` role
and publishes the signed-in user's id as `request.jwt.claims` — the two
statements PostgREST used to run, now in `withRls()` in `src/lib/aws/pool.ts`.
**The claims carry an id and nothing else that matters** — tier, status and
department are read from the `users` table by the policy helpers on every
call, so nothing the process passes in can widen anyone's access.

### The escalation guard

The single most important trigger in the schema is
`app.guard_user_privileges()` in `0020_identity.sql`. Without it, the
"edit your own profile" policy would let any student `PATCH` their own row to
tier `T4` straight from devtools. It refuses tier, status and ban changes from
any non-Owner token, and refuses to demote the last remaining Owner.

The Owner Console works around it deliberately, using the service role after
establishing the Owner's authority in the application layer. Every one of
those actions writes to the audit log.

---

## Testing

```bash
npm test          # unit tests — permissions, forms, spreadsheet, export, collab, SQL builder
npm run typecheck # TypeScript, strict mode
npm run build     # production build
npm run smoke     # drives the real app in a browser (needs it running)
```

### The query builder tests

`tests/pg-builder.test.ts` pins the generated SQL, which is worth doing but
only proves it *looks* right. `tests/pg-integration.test.ts` runs the app's
real queries against a real PostgreSQL with the real migrations — embeds,
counts, upserts, timestamp decoding, and that RLS still filters what comes
back. It skips itself unless a scratch database is set up:

```bash
npm run db:testdb                 # create it, migrate it, seed it
TEST_DATABASE_URL="postgresql://postgres@localhost:5432/hackathon_test" npm test
```

Run these after touching anything in `src/lib/pg/`.

### The browser smoke tests

`npm run smoke` signs in and exercises the flows that matter: creating a task,
commenting, the approval gate, view-as being read-only while keeping console
access, the logged-out public form and its conditional branching, phone
check-in, and the document editor's autosave and version history. It exits
non-zero on failure.

Start the app first (`npm run dev:local` in another terminal). These found
three bugs that the type checker and unit tests had both passed over —
including autosave silently never firing — so it is worth running before a
release.

### The database permission tests

These matter most. `tests/sql/rls_test.sql` connects as the same
`authenticated` Postgres role PostgREST uses and impersonates real users by
setting `request.jwt.claims` — which is exactly what the database sees when a
student calls the API from devtools.

```bash
psql "$AURORA_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_test.sql
```

Or against a throwaway local Postgres:

```bash
createdb hackathon_studio
psql -d hackathon_studio -c "create role anon nologin; create role authenticated nologin; create role service_role nologin;"
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -d hackathon_studio -f "$f"; done
psql -v ON_ERROR_STOP=1 -d hackathon_studio -f tests/sql/rls_test.sql
```

It proves, among other things, that a student cannot promote themselves to
Owner, that suspended accounts read nothing, that the audit log cannot be
edited *even by the Owner*, and that `DELETE` only ever soft-deletes. See
`tests/sql/README.md` for the full list.

**If you change a policy, run this before you deploy.**

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new).
2. Provision the database. Any PostgreSQL 14+ the deployment can reach will
   do — the app needs a connection and RLS, nothing more. See *Aurora
   PostgreSQL on AWS* above for the cluster, the IAM role and the bucket.
3. Install the **AWS integration** on the Vercel project and link it to the
   IAM role. That provides `AWS_ROLE_ARN` and `AWS_REGION`, which is what lets
   the deployment reach both Aurora and S3 without a stored password.
4. Fill the gaps under **Settings → Environment Variables**, for Production
   *and* Preview: the cluster endpoint, database, user, `FILES_BUCKET`,
   `OWNER_EMAIL` and `OWNER_BACKUP_EMAIL` are not provisioned for you.
5. Run the schema once from a machine that can reach the cluster:
   `vercel env pull .env.local && npm run db:aurora`.
6. Deploy. The build command is the default `next build`.

Because sessions live in the database and on the device, a deploy does not
sign anyone out.

**If the deployed site shows "Finish setting up":** one or more variables from
the table above are missing or malformed on that deployment. The screen names
each one and where its value comes from. Set them, then **redeploy** — saving
a variable in the Vercel dashboard does not change a deployment that already
exists.

`/api/health/db` is the quickest way to tell a configuration problem from a
connectivity one: it answers with the server version and round-trip time, or
names the variable that is missing and the console page that fixes it.

Preview deployments have their own environment. A variable added only to
Production leaves every `-git-<branch>` preview URL on that screen.

**Custom domain:** add it under **Settings → Domains**. Public form links use
the request's own host, so they pick up the new domain automatically.

---

## Project layout

```
src/
  app/
    (app)/            signed-in screens; layout.tsx checks account status
    signin/           email-only sign-in
    onboarding/       first-run profile setup
    blocked/[status]  pending / requested / suspended / banned screens
    f/[slug]/         public form submission, no session needed
    api/              document export, full data export, collab relay,
                      local file serving, database health check
  components/         shared UI — shell, ECG motif, avatar, tier badge
  features/           one folder per feature, components + server actions
  lib/
    permissions.ts    tier logic, mirrored from the RLS policies
    audit.ts          the audit-log writer used by every mutation
    auth/             session and sign-in
    pg/               the query builder, and the per-user/anon/admin clients
    aws/              Aurora connection pool and its settings
    storage/          uploaded files — S3, or a local directory
    collab/           Yjs provider and the polling relay transport
supabase/migrations/  schema and RLS, in filename order (the directory keeps
                      its name; nothing in it is Supabase-specific)
certs/                AWS's public RDS trust store, for verifying Aurora's TLS
tests/                unit tests; tests/sql holds the RLS suite
```

Components are colocated by feature, not by type. A server action lives next
to the screen that calls it.

### Conventions worth keeping

- Every mutation is a Server Action that validates with Zod, writes through
  the **user's** client (`userClient()`, which applies RLS), and records an
  audit entry. `adminClient()` bypasses RLS and is for three things only —
  see the comment on it in `src/lib/pg/server.ts`.
- RLS filters an `UPDATE` to zero rows rather than raising, so actions check
  for a missing row and return a readable message instead of failing silently.
- Nothing is hard-deleted. Every table has `deleted_at` and a trigger that
  turns a `DELETE` into a soft delete even if something bypasses the app.
- Every content table has `year int default 2027` so next year's team can
  archive and start clean without a second database.

---

## Known trade-offs

Called out honestly so nobody rediscovers them the hard way.

- **PDF export** renders a print-ready HTML page and opens the browser's print
  dialogue, rather than generating a PDF server-side. A real PDF would mean
  shipping a headless browser to a serverless function — a lot of weight for a
  feature used a handful of times a term. DOCX export is a genuine `.docx`.
- **Live collaboration works on documents, not spreadsheets.** Documents merge
  through Yjs over the relay table, with live cursors and presence. When the
  relay is unreachable the editor falls back to single-user autosave and says
  so, rather than refusing to open. Spreadsheets are still last-write-wins —
  the schema carries `yjs_state` for them but the grid is not wired up.
- **Collaboration polls rather than pushes.** Every open editor asks the relay
  for new updates — roughly four times a second while someone is typing,
  dropping to once every two seconds when idle. That is fine for the handful
  of people who edit one document at once, and it works on hosts that will not
  hold a websocket open. If a document ever has dozens of simultaneous editors,
  this is the thing to replace.
- **The collaboration path is tested by unit tests, not against a live
  cluster.** `tests/collab.test.ts` runs two providers against an in-memory
  channel and `tests/http-transport.test.ts` runs them against a stand-in for
  the relay route, asserting they converge and that a late joiner does not
  double the content. Worth a two-browser sanity check on a real deployment.
- **Email delivery** is not connected. Invites appear in the Owner Console and
  work the moment the person signs in, but no email is actually sent — tell
  people directly, or paste them an invite key. The daily digest in §5.10 of
  the brief needs an email provider first.
- **Login has no password by design.** See *How sign-in works*.

---

## Where things are in the brief

| Brief section | Where it lives |
| --- | --- |
| §4 Owner Key & access control | `src/features/owner/`, `src/lib/auth/signin.ts` |
| §5.2 Dashboard | `src/app/(app)/dashboard/`, `src/features/dashboard/` |
| §5.5 Assignments | `src/features/assignments/` |
| §5.6 Documents | `src/features/documents/`, `src/lib/export/` |
| §5.7 Spreadsheets | `src/features/spreadsheets/`, `src/lib/sheet.ts` |
| §5.8 Forms | `src/features/forms/`, `src/lib/forms.ts` |
| §5.12 Event-Day Mode | `src/features/event/` |
| §7 Design system | `tailwind.config.ts`, `src/app/globals.css`, `/kit` |
