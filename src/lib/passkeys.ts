import "server-only";
import { cookies, headers } from "next/headers";

/**
 * Passkeys (WebAuthn) via @simplewebauthn/server.
 *
 * The challenge lives in a short-lived httpOnly cookie rather than a table:
 * it is single-use, five minutes long, and only ever read back by the same
 * browser that asked for it.
 */
const CHALLENGE_COOKIE = "hs_webauthn";
const CHALLENGE_TTL_S = 5 * 60;

export const RP_NAME = "Hackathon Studio";

/**
 * The relying party must match the address the browser is on, or the browser
 * refuses with "The RP ID ... is invalid for this domain". So it is taken from
 * the request itself, not from APP_URL: that may name a different domain than
 * the one somebody opened (a Vercel preview URL, an alias, a custom domain).
 *
 * WEBAUTHN_RP_ID is still honoured, but only when it is the request's host or
 * a parent domain of it, which is the only case a browser accepts.
 */
export async function relyingParty(): Promise<{ rpID: string; origin: string }> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim();
  const scheme = proto === "http" || host.startsWith("localhost") ? "http" : "https";
  const origin = `${scheme}://${host}`;
  const hostname = new URL(origin).hostname;

  const configured = process.env.WEBAUTHN_RP_ID?.trim().toLowerCase();
  const rpID =
    configured && (hostname === configured || hostname.endsWith(`.${configured}`))
      ? configured
      : hostname;
  return { rpID, origin };
}

export async function storeChallenge(purpose: "register" | "login", challenge: string) {
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, `${purpose}:${challenge}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/passkeys",
    maxAge: CHALLENGE_TTL_S,
  });
}

/** Reads and burns the challenge. */
export async function takeChallenge(purpose: "register" | "login"): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE_COOKIE)?.value ?? "";
  jar.set(CHALLENGE_COOKIE, "", { path: "/api/passkeys", maxAge: 0 });
  const [p, challenge] = raw.split(":");
  if (p !== purpose || !challenge) return null;
  return challenge;
}

export function labelFromUserAgent(ua: string | null): string {
  if (!ua) return "Passkey";
  const device = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}
