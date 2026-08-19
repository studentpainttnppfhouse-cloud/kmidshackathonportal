'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser } from '@/lib/auth/session';
import { userClient } from '@/lib/supabase/user';
import { audit } from '@/lib/audit';
import { atLeast } from '@/lib/permissions';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Check yourself in or out for a given day (§5.12). */
export async function checkInAction(day: string, direction: 'in' | 'out'): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (user.impersonating) return { ok: false, error: 'Impersonation sessions are read-only' };
  if (user.status !== 'active') return { ok: false, error: 'Your account is not active' };

  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(day);
  if (!parsed.success) return { ok: false, error: 'Unknown day' };

  const db = await userClient(user.id);
  const now = new Date().toISOString();
  const column = direction === 'in' ? 'checked_in_at' : 'checked_out_at';

  const { error } = await db.from('checkins').upsert(
    { user_id: user.id, day: parsed.data, [column]: now },
    { onConflict: 'user_id,day' },
  );

  if (error) return { ok: false, error: error.message };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'checkin.recorded',
    targetType: 'checkin',
    targetLabel: `${parsed.data} ${direction}`,
  });

  revalidatePath('/event-day');
  return { ok: true };
}

const incidentSchema = z.object({
  description: z.string().trim().min(1, 'Describe what happened').max(4000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  location: z.string().trim().max(200).optional(),
});

/**
 * Any active staff member can file an incident; only T3+ can read the log.
 * That asymmetry is enforced by RLS, not here.
 */
export async function fileIncidentAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (user.impersonating) return { ok: false, error: 'Impersonation sessions are read-only' };

  const parsed = incidentSchema.safeParse({
    description: formData.get('description') ?? '',
    severity: formData.get('severity') ?? 'low',
    location: formData.get('location') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('incidents')
    .insert({
      reported_by: user.id,
      description: parsed.data.description,
      severity: parsed.data.severity,
      location: parsed.data.location || null,
      occurred_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Your report could not be filed.' };

  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'incident.filed',
    targetType: 'incident',
    targetId: data.id,
    diff: { severity: parsed.data.severity },
  });

  revalidatePath('/event-day');
  return { ok: true };
}

export async function resolveIncidentAction(
  id: string,
  resolution: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (!atLeast(user.effectiveTier, 'T3') || user.impersonating) {
    return { ok: false, error: 'Only Administration can resolve incidents.' };
  }

  const parsed = z.string().trim().min(1).max(2000).safeParse(resolution);
  if (!parsed.success) return { ok: false, error: 'Describe how it was resolved.' };

  const db = await userClient(user.id);
  const { data, error } = await db
    .from('incidents')
    .update({ resolution: parsed.data, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'You do not have permission to resolve that.' };

  revalidatePath('/event-day');
  return { ok: true };
}

/** Reserve staff deployment (§5.12) — T3+ fills gaps. */
const deploySchema = z.object({
  userId: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  station: z.string().trim().min(1, 'Name the station').max(200),
  note: z.string().trim().max(500).optional(),
});

export async function deployReserveAction(formData: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Not signed in' };
  if (!atLeast(user.effectiveTier, 'T3') || user.impersonating) {
    return { ok: false, error: 'Only Administration can deploy reserves.' };
  }

  const parsed = deploySchema.safeParse({
    userId: formData.get('userId'),
    day: formData.get('day'),
    station: formData.get('station') ?? '',
    note: formData.get('note') ?? undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }

  const db = await userClient(user.id);
  const { error } = await db.from('reserve_deployments').insert({
    user_id: parsed.data.userId,
    day: parsed.data.day,
    station: parsed.data.station,
    note: parsed.data.note || null,
    assigned_by: user.id,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/event-day');
  return { ok: true };
}
