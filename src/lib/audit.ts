import 'server-only';
import { headers } from 'next/headers';
import { adminClient } from '@/lib/supabase/admin';
import { clientIp } from '@/lib/auth/session';

/**
 * The audit trail (§2.3). Every create, update, delete, permission change,
 * sign-in, export and upload lands here.
 *
 * Writes go through the admin client because the table is append-only for
 * everyone — including the Owner — and we never want an audit write to be the
 * thing that fails a user's action.
 */
export type AuditAction =
  | 'auth.signin'
  | 'auth.signout'
  | 'auth.denied'
  | 'auth.account_created'
  | 'auth.access_requested'
  | 'user.tier_changed'
  | 'user.department_changed'
  | 'user.role_changed'
  | 'user.profile_updated'
  | 'user.suspended'
  | 'user.banned'
  | 'user.reinstated'
  | 'user.removed'
  | 'user.approved'
  | 'user.rejected'
  | 'invite.sent'
  | 'invite.revoked'
  | 'invite.resent'
  | 'invite_key.created'
  | 'invite_key.revoked'
  | 'invite_key.used'
  | 'document.created'
  | 'document.edited'
  | 'document.deleted'
  | 'document.restored'
  | 'document.exported'
  | 'spreadsheet.created'
  | 'spreadsheet.edited'
  | 'spreadsheet.deleted'
  | 'file.uploaded'
  | 'file.deleted'
  | 'file.downloaded'
  | 'assignment.created'
  | 'assignment.reassigned'
  | 'assignment.status_changed'
  | 'assignment.approved'
  | 'assignment.deleted'
  | 'form.created'
  | 'form.published'
  | 'form.closed'
  | 'form.response_submitted'
  | 'form.response_deleted'
  | 'form.response_promoted'
  | 'announcement.published'
  | 'announcement.deleted'
  | 'incident.filed'
  | 'checkin.recorded'
  | 'export.run'
  | 'archive.frozen'
  | 'archive.unfrozen'
  | 'impersonation.started'
  | 'impersonation.stopped'
  | 'ownership.transferred';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  /** Before/after pair, or any structured context worth keeping. */
  diff?: Record<string, unknown> | null;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const hdrs = await headers();
    await adminClient()
      .from('audit_log')
      .insert({
        actor_id: entry.actorId ?? null,
        actor_email: entry.actorEmail ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        target_label: entry.targetLabel ?? null,
        diff: entry.diff ?? null,
        ip: clientIp(hdrs),
        user_agent: hdrs.get('user-agent'),
      });
  } catch (error) {
    // An audit write must never be what breaks a user's action, but a silent
    // failure here would be worse — it is the one log a maintainer will go
    // looking for when something has gone wrong.
    console.error('[audit] failed to record', entry.action, error);
  }
}

/** Build a compact before/after diff, skipping fields that did not change. */
export function diffOf<T extends Record<string, unknown>>(
  before: Partial<T>,
  after: Partial<T>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) {
      out[key] = { from: before[key] ?? null, to: after[key] ?? null };
    }
  }
  return out;
}
