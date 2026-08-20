'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSessionUser, setImpersonation } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { canImpersonate } from '@/lib/permissions';
import { TIERS, type Tier } from '@/lib/types';

const schema = z.object({ tier: z.enum(TIERS).nullable() });

/**
 * "View as" (§4). The Owner can preview the app as a lower tier to verify the
 * permission model. The session is read-only throughout, banner-marked, and
 * both start and stop are audited.
 */
export async function setViewAsAction(raw: Tier | null): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error('Not signed in');

  // Checked against the real tier, never the impersonated one — otherwise an
  // Owner viewing as T1 could not switch back.
  if (!canImpersonate(user.tier)) {
    throw new Error('Only the Owner can preview other tiers');
  }

  const parsed = schema.parse({ tier: raw });
  const target = parsed.tier === 'T4' ? null : parsed.tier;

  await setImpersonation(target);
  await audit({
    actorId: user.id,
    actorEmail: user.email,
    action: target ? 'impersonation.started' : 'impersonation.stopped',
    targetType: 'tier',
    targetLabel: target ?? user.tier,
  });

  revalidatePath('/', 'layout');
}
