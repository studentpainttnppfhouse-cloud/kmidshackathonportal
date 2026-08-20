/**
 * Which column on which table points at which other table.
 *
 * This is the map that lets a select list ask for related rows inline —
 * `users:author_id ( nickname, name )` — without every call site hand-writing
 * a join. It mirrors the `references` clauses in db/migrations; if you add a
 * foreign key there and want to embed through it, add it here too.
 *
 * Kept as data rather than read from `information_schema` at runtime so that
 * the compiler in query.ts stays pure and can be unit-tested without a
 * database.
 */

/** table -> column -> referenced table. */
export const FOREIGN_KEYS: Record<string, Record<string, string>> = {
  users: { department_id: 'departments', banned_by: 'users' },
  invited_users: { department_id: 'departments', invited_by: 'users' },
  invite_keys: { department_id: 'departments', created_by: 'users' },
  device_sessions: { user_id: 'users' },
  assignments: {
    department_id: 'departments',
    created_by: 'users',
    approved_by: 'users',
    parent_id: 'assignments',
  },
  assignment_assignees: { assignment_id: 'assignments', user_id: 'users' },
  comments: { user_id: 'users', resolved_by: 'users' },
  announcements: { department_id: 'departments', author_id: 'users' },
  announcement_reads: { announcement_id: 'announcements', user_id: 'users' },
  notifications: { user_id: 'users' },
  folders: { department_id: 'departments', parent_id: 'folders' },
  documents: {
    department_id: 'departments',
    owner_id: 'users',
    folder_id: 'folders',
    approved_by: 'users',
  },
  document_permissions: { document_id: 'documents', user_id: 'users', granted_by: 'users' },
  document_versions: { document_id: 'documents', created_by: 'users' },
  spreadsheets: { department_id: 'departments', owner_id: 'users', folder_id: 'folders' },
  spreadsheet_versions: { spreadsheet_id: 'spreadsheets', created_by: 'users' },
  files: { department_id: 'departments', folder_id: 'folders', uploaded_by: 'users' },
  forms: { department_id: 'departments', owner_id: 'users' },
  form_responses: { form_id: 'forms', user_id: 'users', promoted_user_id: 'users' },
  content_items: {
    designer_id: 'users',
    editor_id: 'users',
    poster_id: 'users',
    asset_file_id: 'files',
    department_id: 'departments',
  },
  social_accounts: { access_holder_user_id: 'users' },
  event_items: { owner_id: 'users' },
  checkins: { user_id: 'users' },
  incidents: { reported_by: 'users' },
  reserve_deployments: { user_id: 'users', assigned_by: 'users' },
  file_blobs: { file_id: 'files' },
};

/** Every table the schema knows about, including the ones with no foreign keys. */
export const TABLES: readonly string[] = [
  'archived_years', 'announcement_reads', 'announcements', 'assignment_assignees',
  'assignments', 'audit_log', 'checkins', 'comments', 'content_items', 'departments',
  'device_sessions', 'document_permissions', 'document_versions', 'documents',
  'event_items', 'file_blobs', 'files', 'folders', 'form_responses', 'forms',
  'incidents', 'invite_keys', 'invited_users', 'notifications', 'quick_reference',
  'reserve_deployments', 'social_accounts', 'spreadsheet_versions', 'spreadsheets',
  'users',
];

/**
 * The column on `parent` that points at `target`, when there is exactly one.
 *
 * Ambiguity is an error rather than a guess: `documents` points at `users`
 * through both `owner_id` and `approved_by`, so `users ( … )` on documents is
 * genuinely undecidable and the call site has to say which one it means.
 */
export function belongsToColumn(parent: string, target: string): string | 'ambiguous' | null {
  const columns = Object.entries(FOREIGN_KEYS[parent] ?? {})
    .filter(([column, references]) => references === target && column !== 'id')
    .map(([column]) => column);

  if (columns.length === 0) return null;
  if (columns.length > 1) return 'ambiguous';
  return columns[0] ?? null;
}

/** The column on `child` that points back at `parent`, for a one-to-many embed. */
export function hasManyColumn(parent: string, child: string): string | 'ambiguous' | null {
  return belongsToColumn(child, parent);
}
