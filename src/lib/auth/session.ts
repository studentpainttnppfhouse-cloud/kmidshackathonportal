import 'server-only';
import { cookies, headers } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { adminClient } from '@/lib/pg/server';
import type { AppUser, SessionUser, Tier } from '@/lib/types';
import { isTier } from '@/lib/permissions';

/**
 * Device sessions.
 *
 * The brief is explicit that event-day staff must not be retyping anything at
 * 7 AM, and the ask on top of it was that a device stays signed in across
 * deploys. So the session lives in two places that both survive a redeploy:
 * a long-lived cookie on the device, and a row in `device_sessions`. Nothing
 * is held in server memory, so a new build signs nobody out.
 *
 * The cookie holds a 32-byte random token. Only its SHA-256 hash is stored, so
 * a leaked database dump does not hand over live sessions.
 */
export const SESSION_COOKIE = 'hs_device';
const IMPERSONATION_COOKIE = 'hs_view_as';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Re-stamp last_seen_at at most once an hour to avoid a write per request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Issue a device session and set the cookie. Called once, at sign-in. */
export async function createDeviceSession(userId: string): Promise<void> {
  const token = newToken();
  const hdrs = await headers();
  const userAgent = hdrs.get('user-agent') ?? null;

  await adminClient().from('device_sessions').insert({
    user_id: userId,
    token_hash: hashToken(token),
    user_agent: userAgent,
    device_label: describeDevice(userAgent),
    ip: clientIp(hdrs) ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
}

/** Revoke the current device's session and clear the cookie. */
export async function destroyDeviceSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await adminClient()
      .from('device_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', hashToken(token));
  }

  jar.delete(SESSION_COOKIE);
  jar.delete(IMPERSONATION_COOKIE);
}

/** Revoke every session for a user — what makes a suspension bite immediately. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await adminClient()
    .from('device_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
}

/**
 * Resolve the cookie to a user. Returns null when there is no session, the
 * session was revoked, or it has expired.
 *
 * This has to use the admin client: we cannot authenticate as the user until
 * we know who they are, which is the thing we are working out.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = adminClient();
  const { data: session } = await db
    .from('device_sessions')
    .select('id, user_id, last_seen_at, expires_at, revoked_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!session || session.revoked_at) return null;
  if (session.expires_at && new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await db
    .from('users')
    .select('*')
    .eq('id', session.user_id)
    .is('deleted_at', null)
    .maybeSingle<AppUser>();

  if (!user) return null;

  // A suspension whose end date has passed lifts itself, so nobody has to
  // remember to go and undo it.
  const lifted = await liftExpiredSuspension(user);

  void touchSession(session.id, session.last_seen_at, user.id);

  const impersonating = readImpersonation(jar.get(IMPERSONATION_COOKIE)?.value, lifted.tier);

  return {
    ...lifted,
    impersonating,
    effectiveTier: impersonating ?? lifted.tier,
  };
}

async function liftExpiredSuspension(user: AppUser): Promise<AppUser> {
  if (user.status !== 'suspended' || !user.suspended_until) return user;
  if (new Date(user.suspended_until) > new Date()) return user;

  const { data } = await adminClient()
    .from('users')
    .update({ status: 'active', suspended_until: null })
    .eq('id', user.id)
    .select('*')
    .maybeSingle<AppUser>();

  return data ?? user;
}

async function touchSession(
  sessionId: string,
  lastSeen: string | null,
  userId: string,
): Promise<void> {
  const seenAt = lastSeen ? new Date(lastSeen).getTime() : 0;
  if (Date.now() - seenAt < TOUCH_INTERVAL_MS) return;

  const now = new Date().toISOString();
  const db = adminClient();
  // Roll the expiry forward so an active device never gets logged out.
  await db
    .from('device_sessions')
    .update({
      last_seen_at: now,
      expires_at: new Date(Date.now() + ONE_YEAR_SECONDS * 1000).toISOString(),
    })
    .eq('id', sessionId);
  await db.from('users').update({ last_active_at: now }).eq('id', userId);
}

/**
 * Impersonation ("view as", §4). Only an Owner may set it, the session is
 * read-only throughout, and the banner is always visible.
 */
function readImpersonation(raw: string | undefined, actualTier: Tier): Tier | null {
  if (!raw || actualTier !== 'T4') return null;
  if (!isTier(raw) || raw === 'T4') return null;
  return raw;
}

export async function setImpersonation(tier: Tier | null): Promise<void> {
  const jar = await cookies();
  if (tier === null) {
    jar.delete(IMPERSONATION_COOKIE);
    return;
  }
  jar.set(IMPERSONATION_COOKIE, tier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 4,
  });
}

export function clientIp(hdrs: Headers): string | null {
  const forwarded = hdrs.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return hdrs.get('x-real-ip');
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android phone';
  if (/Macintosh/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Browser';
}
