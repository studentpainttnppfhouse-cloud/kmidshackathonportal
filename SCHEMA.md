# Database schema

Every table in plain language, plus the rule that decides who can see and
change each one. Written for whoever maintains this after the 2027 team
graduates.

The SQL lives in `supabase/migrations/`, in filename order. **Policies are
written in the same file as the table they protect** — never bolted on later.

---

## The rules that apply everywhere

**Nothing is hard-deleted.** Every table has `deleted_at`. A `DELETE` hits a
trigger that stamps `deleted_at` and swallows the delete, so the row survives
even if something bypasses the application. Students delete things by
accident; this is the recycle bin.

**Everything has a year.** Every content table has `year int default 2027`.
Next year's team archives 2027 and starts clean in the same database.

**Everything is audited.** Every create, update, delete, permission change,
sign-in, export and upload writes to `audit_log`.

**Timestamps.** Every table has `created_at` and `updated_at`; `updated_at` is
maintained by a trigger, not by the application.

---

## The helper functions

RLS policies would be unreadable if every one spelled out the tier rules, so
they call these instead. They live in the `app` schema, which is not exposed
over the API.

| Function | Answers |
| --- | --- |
| `app.uid()` | Who is making this request? Reads the JWT. `NULL` when logged out. |
| `app.tier()` | Their tier, read from `users` — **never trusted from the token**. |
| `app.dept()` | Their department. |
| `app.status()` | `active`, `pending`, `requested`, `suspended` or `banned`. |
| `app.is_active()` | Is this a fully active account? Everything else gates on this. |
| `app.is_owner()` | Are they T4? |
| `app.is_advisor()` | Are they T0? Advisors read broadly but never write. |
| `app.tier_at_least('T2')` | Are they at or above that rung? |
| `app.can_read_dept(d)` | Own department, or T3+/T0 anywhere, or the General space. |
| `app.can_write_dept(d)` | T2 in own department, T3+ anywhere. Never an Advisor. |
| `app.can_create_in_dept(d)` | T1+ in own department or General; T3+ anywhere. |
| `app.year_writable(y)` | Has that year been frozen for archive? |

`app.tier()`, `app.dept()` and `app.status()` are `SECURITY DEFINER` so a
policy on `users` can call them without recursing into its own RLS. Their
`search_path` is pinned so the body cannot be hijacked.

A `NULL` department means **the General space**, which every signed-in user
can see.

---

## Identity

### `departments`
The six departments — Sponsorship & Partnerships, Social Media & External
Affairs, Film/Photo & Tech, Documentation, Operations, Mentorship — plus a
colour and sort order used throughout the UI.

- **Read:** everyone signed in. It is the org chart.
- **Write:** T3+ only.

### `users`
One row per staff member. **Minimal personal data only**: name, nickname,
grade, email, phone, LINE ID, shirt size, avatar. Nothing more — Thailand's
PDPA applies to these rows, and adding a field is a decision, not a
convenience.

Also carries `tier`, `department_id`, `role_title`, `status`, the
`is_reserve` / `is_mentor` / `is_alumni` flags, the ban and suspension fields,
and `source_response_id` linking back to the recruitment form response they
came from.

- **Read:** everyone signed in — that is the point of the directory.
- **Update your own profile:** yes.
- **Update someone else's profile:** T3+.
- **Change a tier or status:** **Owner only**, enforced by a trigger.

> **`app.guard_user_privileges()` is the most important trigger in this
> schema.** Without it the "edit your own profile" policy would let any
> student set their own tier to `T4` from devtools. It refuses tier, status
> and ban changes from anyone below T4, refuses department changes from below
> T3, and refuses to demote the last remaining Owner.
>
> A ban is also constrained to always carry a reason and an author.

### `invited_users`
Access path A. An email with a pre-assigned tier, department and role title.
When that person first signs in, their account is created with those already
applied.

- **Read and write:** Owner only.

### `invite_keys`
Access path B. A shareable code carrying a tier, department, expiry and
max-uses counter — useful for onboarding a whole department at once. Revoking
a key does not remove accounts already created with it.

- **Read and write:** Owner only.

### `device_sessions`
One row per signed-in device. Sessions are deliberately long-lived — a year,
rolling forward on use — because event-day staff must not be retyping
anything at 7 AM, and because a redeploy must not sign anyone out.

Stores only the SHA-256 **hash** of the cookie token, so a leaked database
dump does not hand over live sessions.

- **Read:** your own, or the Owner's view of anyone's.
- **Issue and revoke:** server-side only; the privilege is revoked from
  `authenticated` entirely.

---

## Work

### `assignments`
Title, description, department, due date, priority, status, recurrence rule,
optional parent (for recurring instances) and an optional linked document.

Status flows `not_started → in_progress → needs_review → approved → done`.

- **Read:** anyone who can read the department.
- **Create and delete:** T2+ in that department, T3+ anywhere.
- **Update:** the above, **or an assignee updating their own task**.
- **Approve:** T2+ only. Enforced by `app.guard_assignment_approval()`, which
  also stamps `approved_by` and `approved_at` automatically.

The approval gate is a trigger rather than a policy because it depends on the
row's previous status, which a `WITH CHECK` clause cannot see.

### `assignment_assignees`
Join table. Who is on the hook for what.

### `comments`
Polymorphic — attaches to an assignment, document, spreadsheet, file or
content item via `parent_type` + `parent_id`. The `anchor` column holds the
Tiptap text-selection range for inline document comments.

- **Read:** everyone signed in.
- **Create:** everyone signed in **including Advisors** — commenting is the
  one write T0 gets.
- **Edit and delete:** your own, or T2+.

### `announcements` and `announcement_reads`
Announcements are scoped `all` or `department`, and can be pinned.

- **Read:** all-staff ones by everyone; department ones by that department.
- **Publish all-staff:** T3+ only.
- **Publish to a department:** T2+ in that department.

Read receipts: you write your own row; authors and T2+ see the tally.

### `notifications`
The in-app bell. **Your notifications are yours alone — not even the Owner
can read them.** No push notifications, by design.

---

## Content

### `folders`
Per-department folders, of kind `doc`, `sheet` or `file`.

### `documents`
`content` is the Tiptap JSON. `plain_text` is the flattened text that feeds
`search_vector`, a `tsvector` maintained by a trigger for full-text search
over title and body. `yjs_state` is reserved for collaborative editing.

Metadata: title, department, owner, status (`draft` / `in_review` /
`approved` / `published`), tags, `approved_by`, folder.

- **Read:** department access, **or** you own it, **or** you hold a
  per-document grant.
- **Edit:** the owner, a department head, or someone with an `edit` grant.
- **Delete:** the owner or a department head. Never an Advisor.

### `document_permissions`
Per-document overrides. By default a document inherits its department's rules;
this table grants a specific person `view`, `comment` or `edit` on top.

### `document_versions`
Snapshots for the version history. Restoring writes the old content forward as
a new save rather than rewinding, so a restore is itself undoable.

### `spreadsheets` and `spreadsheet_versions`
`data` holds `{ cells, formats, rows, cols }`. Cells are stored **sparsely**
as authored text — `{"A1": "=SUM(B1:B9)"}` — so an empty grid costs nothing.
Formulas are never evaluated in the database; HyperFormula does that in the
browser, which is why there is no formula parser in this codebase.

`source_form_id` links a sheet created from form responses back to its form.

Same permission model as documents, minus the per-item grants.

### `files`
Uploads and external links. A row must have either a `storage_path` or an
`external_url` (a check constraint), and a stored file is capped at 50 MB by
another. Anything larger goes in as a link. `is_brand_asset` marks Brand Kit
items.

- **Read:** department access.
- **Upload:** T1+ in own department or General; T3+ anywhere.
- **Delete:** the uploader or a department head. Soft only — the storage
  object is kept so a mistaken delete is recoverable.

---

## Forms

### `forms`
`schema` holds the ordered field list from the builder, including each field's
conditional logic. `settings` holds open/close dates, one-response-per-user,
allow-edit-after-submit, login-required and the confirmation message.

- **Read (staff):** anyone who can read the department.
- **Read (logged out):** **only** a published, public, currently-open form.
  That is a separate policy granted to the `anon` role.
- **Create and edit:** T2+ in that department, T3+ anywhere.

### `form_responses`
One row per submission. `payload` is the answers keyed by field id.
`promoted_user_id` and `promoted_notes` record that a respondent was turned
into a staff member.

- **Read:** staff who can write the form, plus the respondent reading their
  own submission back.
- **Submit (signed in):** allowed while the form is open.
- **Submit (logged out):** allowed only when the form is published, open
  **and** explicitly public. `app.form_is_open()` and `app.form_is_public()`
  make that decision inside the database, not in the application.

---

## Social and event day

### `content_items`
The content calendar. Date, platform, format, caption, script, status
(`idea → assigned → asset_in_progress → ready → posted`), the assigned
designer, editor and poster, and a linked asset file.

- **Read:** everyone signed in.
- **Edit:** T2+ in the department, **or** anyone named as its designer,
  editor or poster.

### `social_accounts`
Platform, handle, URL, and **which user holds access**. Stores the
access-holder's identity, **never a password**.

### `event_items`
The run sheet for 19–21 March. Day, start and end time, title, location,
owner, notes.

- **Read:** everyone. It is the one thing every single person needs.
- **Edit:** T2+.

### `checkins`
Staff check-in and check-out, one row per person per day.

- **Read:** your own; T2+ see the whole board.
- **Write:** yourself, or T3+ on anyone's behalf.

### `incidents`
The incident log. Note the deliberate asymmetry: **anyone on staff can file
one, only T3+ can read the log.** A reporter can see the report they filed and
nothing else. This is enforced by RLS, not by hiding the tab.

### `reserve_deployments`
Which reserve staff member is covering which station, assigned by T3+.

### `quick_reference`
WiFi credentials, floor map, judge list, emergency contacts, table numbers.
Cached to the device so it still renders when the venue network drops.

### `archived_years`
One row per frozen year. `app.year_frozen()` reads it, and every content
table's write policy calls `app.year_writable()`, so **freezing a year makes
its content read-only at the database level**, not just in the interface.

- **Freeze and unfreeze:** Owner only.

---

## The audit log

### `audit_log`
`actor_id`, `actor_email`, `action`, `target_type`, `target_id`,
`target_label`, a JSON `diff` of before/after, `ip`, `user_agent`,
`created_at`.

**This table is append-only, and that is enforced three ways:**

1. There is no `UPDATE` policy and no `DELETE` policy.
2. `UPDATE`, `DELETE` and `TRUNCATE` are revoked from `authenticated` and
   `anon`, so the API does not offer the verb at all.
3. A trigger raises on any update or delete that gets past both.

**No user can edit it, including the Owner.** The RLS test suite asserts this
explicitly.

- **Read:** Owner only.
- **Insert:** anyone signed in, for their own actions.

---

## Grants

`0090_grants.sql` must run **last**. RLS only filters rows a role is already
allowed to touch — without these grants, every policy is unreachable and the
API returns nothing.

`authenticated` gets `select, insert, update, delete` on everything, and the
policies decide the rest. `anon` gets exactly two things: `select` on `forms`
and `insert` on `form_responses`, for the public submission pages.

---

## Changing the schema

1. Add a **new** numbered migration; never edit one that has already run.
2. Write the RLS policies **in the same file** as the table.
3. Add the table to the export list in `src/app/api/export/route.ts`.
4. Add an assertion to `tests/sql/rls_test.sql` and run it.
5. Document the table here.

If a new table has no policy, RLS denies everything by default — which is the
right way round to fail, but produces a confusing empty screen. Check for
that first when something new returns nothing.

---

## `collab_messages`

In-flight edits for the document editor, not document state.

Live editing merges through Yjs, and the peers need some way to pass update
bytes to each other. Supabase Realtime was that channel; without it, an editor
posts its updates here and polls `/api/collab/[documentId]` for everyone
else's. Rows live for seconds — `app.prune_collab_messages()` clears anything
older than five minutes, and the API route calls it whenever an editor joins.

| Column | Notes |
| --- | --- |
| `id` | `bigserial`. Doubles as the cursor a peer polls from. |
| `document_id` | The document being edited. Cascades on delete. |
| `sender` | The Yjs client id, so a peer never re-applies its own update. |
| `event` | `yjs-update`, `yjs-sync-request`, `yjs-sync-reply` or `awareness`. |
| `payload` | The update, base64 inside JSON. |

The saved copy of a document is still `documents.content`, written by the
editor's autosave. Losing every row in this table costs nothing but a moment's
divergence between two open editors.

**Policies.** Readable when the document is — the policy defers to
`documents_select` through a subquery, so it cannot drift from it. Insertable
only when the document is *editable*, via `app.can_edit_doc()`, which mirrors
`documents_update`: broadcasting an update is an edit, and a viewer with
read-only access must not be able to push changes into someone else's editor.
Updates and deletes are revoked outright.
