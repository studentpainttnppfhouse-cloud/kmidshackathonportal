import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { adminClient } from '@/lib/pg/server';
import { audit } from '@/lib/audit';
import { canExportAll } from '@/lib/permissions';
import { listObjects, storageLocation } from '@/lib/storage';

/**
 * Full export (§2.6) — every table as JSON plus a manifest of stored files,
 * so a future team can take their data with them. Owner only, and audited.
 */
const TABLES = [
  'departments', 'users', 'invited_users', 'invite_keys', 'assignments',
  'assignment_assignees', 'comments', 'announcements', 'announcement_reads',
  'notifications', 'folders', 'documents', 'document_versions',
  'document_permissions', 'spreadsheets', 'spreadsheet_versions', 'files',
  'forms', 'form_responses', 'content_items', 'social_accounts', 'event_items',
  'checkins', 'incidents', 'reserve_deployments', 'quick_reference',
  'archived_years', 'audit_log',
] as const;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!canExportAll(user.tier)) {
    return NextResponse.json({ error: 'Owner only' }, { status: 403 });
  }

  const db = adminClient();
  const data: Record<string, unknown> = {};

  for (const table of TABLES) {
    const { data: rows, error } = await db.from(table).select('*');
    // A missing table should not abort the whole export — record it and move on.
    data[table] = error ? { error: error.message } : rows;
  }

  // A storage listing must not sink the whole export — the tables are the part
  // that cannot be reconstructed.
  const bucket = storageLocation();
  let objects: Awaited<ReturnType<typeof listObjects>> = [];
  let objectsError: string | null = null;
  try {
    objects = await listObjects('', 1000);
  } catch (error) {
    objectsError = (error as Error).message;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: user.email,
    schemaVersion: '0090',
    tables: data,
    storage: { bucket, objects, ...(objectsError ? { error: objectsError } : {}) },
  };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'export.run',
    targetType: 'system',
    targetLabel: 'full export',
    diff: { tables: TABLES.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="hackathon-studio-export-${stamp}.json"`,
    },
  });
}
