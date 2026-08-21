/**
 * The foreign keys PostgREST used to read out of the schema cache.
 *
 * Embedding (`documents?select=owner:owner_id(name)`) works because PostgREST
 * knows the FK graph. Nothing here talks to `information_schema` at runtime to
 * rediscover it: a lookup that silently resolves differently after a migration
 * is exactly the kind of drift that turns into a permissions bug, and a table
 * checked into the repo can be read in review.
 *
 * Generated from supabase/migrations — regenerate with `npm run db:relations`
 * whenever a foreign key is added or removed.
 */

/** column -> [referenced table, referenced column] */
export type ForeignKeys = Record<string, Record<string, readonly [string, string]>>;

export const FOREIGN_KEYS: ForeignKeys = {
  announcement_reads: {
    announcement_id: ['announcements', 'id'],
    user_id: ['users', 'id'],
  },
  announcements: {
    department_id: ['departments', 'id'],
    author_id: ['users', 'id'],
  },
  archived_years: {},
  assignment_assignees: {
    assignment_id: ['assignments', 'id'],
    user_id: ['users', 'id'],
  },
  assignments: {
    department_id: ['departments', 'id'],
    created_by: ['users', 'id'],
    approved_by: ['users', 'id'],
    parent_id: ['assignments', 'id'],
  },
  audit_log: {},
  checkins: {
    user_id: ['users', 'id'],
  },
  collab_messages: {
    document_id: ['documents', 'id'],
  },
  comments: {
    user_id: ['users', 'id'],
    resolved_by: ['users', 'id'],
  },
  content_items: {
    designer_id: ['users', 'id'],
    editor_id: ['users', 'id'],
    poster_id: ['users', 'id'],
    asset_file_id: ['files', 'id'],
    department_id: ['departments', 'id'],
  },
  departments: {},
  device_sessions: {
    user_id: ['users', 'id'],
  },
  document_permissions: {
    document_id: ['documents', 'id'],
    user_id: ['users', 'id'],
    granted_by: ['users', 'id'],
  },
  document_versions: {
    document_id: ['documents', 'id'],
    created_by: ['users', 'id'],
  },
  documents: {
    department_id: ['departments', 'id'],
    owner_id: ['users', 'id'],
    folder_id: ['folders', 'id'],
    approved_by: ['users', 'id'],
  },
  event_items: {
    owner_id: ['users', 'id'],
  },
  files: {
    department_id: ['departments', 'id'],
    folder_id: ['folders', 'id'],
    uploaded_by: ['users', 'id'],
  },
  folders: {
    department_id: ['departments', 'id'],
    parent_id: ['folders', 'id'],
  },
  form_responses: {
    form_id: ['forms', 'id'],
    user_id: ['users', 'id'],
    promoted_user_id: ['users', 'id'],
  },
  forms: {
    department_id: ['departments', 'id'],
    owner_id: ['users', 'id'],
  },
  incidents: {
    reported_by: ['users', 'id'],
  },
  invite_keys: {
    department_id: ['departments', 'id'],
    created_by: ['users', 'id'],
  },
  invited_users: {
    department_id: ['departments', 'id'],
    invited_by: ['users', 'id'],
  },
  notifications: {
    user_id: ['users', 'id'],
  },
  quick_reference: {},
  reserve_deployments: {
    user_id: ['users', 'id'],
    assigned_by: ['users', 'id'],
  },
  social_accounts: {
    access_holder_user_id: ['users', 'id'],
  },
  spreadsheet_versions: {
    spreadsheet_id: ['spreadsheets', 'id'],
    created_by: ['users', 'id'],
  },
  spreadsheets: {
    department_id: ['departments', 'id'],
    owner_id: ['users', 'id'],
    folder_id: ['folders', 'id'],
  },
  users: {
    department_id: ['departments', 'id'],
    banned_by: ['users', 'id'],
  },
};

export interface Relationship {
  /** `one` embeds an object (or null); `many` embeds an array. */
  kind: 'one' | 'many';
  /** The table being embedded. */
  table: string;
  /** Column on the parent relation. */
  localColumn: string;
  /** Column on the embedded relation. */
  foreignColumn: string;
}

/** Every table that has a foreign key pointing at `target`. */
function childrenOf(target: string): { table: string; column: string; foreign: string }[] {
  const found: { table: string; column: string; foreign: string }[] = [];
  for (const [table, columns] of Object.entries(FOREIGN_KEYS)) {
    for (const [column, [refTable, refColumn]] of Object.entries(columns)) {
      if (refTable === target) found.push({ table, column, foreign: refColumn });
    }
  }
  return found;
}

/**
 * Resolve `parent ( hint ( ... ) )` the way PostgREST would.
 *
 * The hint is either a foreign key column on the parent, or the name of a
 * related table. An ambiguous table name — two foreign keys between the same
 * pair of tables, as `documents` has to `users` through both `owner_id` and
 * `approved_by` — is an error rather than a guess, because guessing would
 * silently attribute rows to the wrong person.
 */
export function resolveRelationship(parent: string, hint: string): Relationship {
  const parentKeys = FOREIGN_KEYS[parent];
  if (!parentKeys) throw new Error(`Unknown table "${parent}"`);

  // 1. The hint names a foreign key column on the parent.
  const direct = parentKeys[hint];
  if (direct) {
    return { kind: 'one', table: direct[0], localColumn: hint, foreignColumn: direct[1] };
  }

  if (!FOREIGN_KEYS[hint]) {
    throw new Error(
      `Cannot embed "${hint}" in "${parent}": it is neither a foreign key column nor a known table`,
    );
  }

  // 2. The hint names a table the parent points at.
  const outgoing = Object.entries(parentKeys).filter(([, [refTable]]) => refTable === hint);
  if (outgoing.length === 1) {
    const [column, reference] = outgoing[0] as [string, readonly [string, string]];
    return { kind: 'one', table: hint, localColumn: column, foreignColumn: reference[1] };
  }
  if (outgoing.length > 1) {
    throw new Error(
      `Ambiguous embed "${hint}" in "${parent}": ${outgoing.map(([c]) => c).join(', ')} all ` +
        'point there. Name the foreign key, e.g. `owner:owner_id ( ... )`.',
    );
  }

  // 3. The hint names a table that points back at the parent.
  const incoming = childrenOf(parent).filter((c) => c.table === hint);
  const only = incoming[0];
  if (incoming.length === 1 && only) {
    return {
      kind: 'many',
      table: hint,
      localColumn: only.foreign,
      foreignColumn: only.column,
    };
  }
  if (incoming.length > 1) {
    throw new Error(
      `Ambiguous embed "${hint}" in "${parent}": ${hint} points back through ` +
        `${incoming.map((c) => c.column).join(', ')}. Name the foreign key instead.`,
    );
  }

  throw new Error(`No relationship between "${parent}" and "${hint}"`);
}
