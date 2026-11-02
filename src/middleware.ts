import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/cookies";

/**
 * Transport and content-security policy, applied to every request.
 *
 * Three jobs:
 *
 *   1. Refuse plain HTTP. Render terminates TLS at its edge and forwards
 *      `x-forwarded-proto`, so the app is the only place that can tell whether
 *      the browser's leg of the connection was encrypted. A session cookie on
 *      an http:// request is a session cookie somebody on the school Wi-Fi can
 *      read, so it is redirected before the app ever sees it, and HSTS then
 *      makes the browser stop trying.
 *
 *   2. Ship a real Content-Security-Policy. Everything else in this codebase
 *      escapes output correctly today; CSP is what keeps a future mistake from
 *      becoming an account takeover. The nonce is generated per request and
 *      Next.js picks it up automatically for its own bundles.
 *
 *   3. Slide the session cookie's expiry forward. A signed-in person must be
 *      able to stay signed in for months without ever seeing the login page,
 *      and the middleware is the only place on a normal page request where a
 *      cookie may legally be written — Next rejects a write from a Server
 *      Component, which is where the renewal used to live.
 */

const PUBLIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml)$/i;

/**
 * Stored attachments are bytes somebody uploaded, served from the origin that
 * holds everybody's session cookie.
 *
 * The route already refuses to serve anything outside a small allowlist as
 * itself — everything else comes back as `application/octet-stream` with a
 * download disposition — but the policy below is the belt to that pair of
 * braces: nothing loads, nothing runs, and the sandbox denies the response an
 * origin of its own even if a browser one day decides to render it anyway.
 *
 * It lives here rather than only in the route because the middleware's header
 * is the one that survives: `NextResponse.next()` merges over whatever the
 * handler set, so a policy written only in the route would be quietly replaced
 * by the ordinary page policy.
 */
const ATTACHMENT_PATH = /^\/api\/attachments\//;
const ATTACHMENT_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'";

function buildCsp(nonce: string, isProduction: boolean): string {
  const scriptSrc = isProduction
    ? // `strict-dynamic` means the allowlist stops mattering once the nonced
      // bundle loads: scripts it inserts inherit trust, anything an injected
      // tag tries to load does not.
      `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : // The dev server injects eval-based HMR. Loosened only here; the
      // production header above is the one that ships.
      `'self' 'unsafe-eval' 'unsafe-inline'`;

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind and the brand tokens use inline `style` attributes for
    // per-department colours, which style-src-attr cannot nonce.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // Avatars are pasted Drive/Canva/Gravatar links, so the host cannot be
    // known ahead of time. https: only — never http:, never data: for scripts.
    "img-src 'self' data: blob: https:",
    "connect-src 'self'",
    // blob: only, for the in-page file preview (a PDF fetched into a blob).
    "frame-src blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    // Server Actions post back to this origin. Nothing else may receive a form
    // from this app, which is what stops an injected form exfiltrating a
    // password field.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function middleware(request: NextRequest): NextResponse {
  const isProduction = process.env.NODE_ENV === "production";

  // --- 1. HTTPS -----------------------------------------------------------
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const host = request.headers.get("host")?.split(":")[0] ?? "";

  // Localhost is exempt. `next start` sets `x-forwarded-proto: http` on a
  // direct connection, so without this a production build run locally — which
  // is how anyone verifies a release before pushing it — redirects to an
  // https://localhost that is not listening, forever. On a real hostname the
  // header comes from Render's edge and the redirect is the point.
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]";

  if (isProduction && !isLocal && proto && proto !== "https") {
    // Built from the Host header rather than by flipping `nextUrl.protocol`:
    // behind a proxy `nextUrl` carries the origin the Node server sees, which
    // is the internal one, so cloning it sends the browser to a host that does
    // not exist publicly. The Host header is the name the browser actually
    // asked for.
    const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `https://${host}`);
    return NextResponse.redirect(target, 308);
  }

  // --- 2. CSP nonce -------------------------------------------------------
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isAttachment = ATTACHMENT_PATH.test(request.nextUrl.pathname);
  const csp = isAttachment ? ATTACHMENT_CSP : buildCsp(nonce, isProduction);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // The path, forwarded so a Server Component can read it. Next gives a layout
  // no way to ask which page is rendering inside it, and the app shell needs to
  // know: it is where the owner's page grid is enforced, once, for every route
  // underneath it rather than in thirty separate page files.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  // Next reads this back off the request to nonce its own script tags.
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("x-dns-prefetch-control", "off");
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  // Nothing in the portal needs a camera, a microphone or a location.
  response.headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );

  if (isProduction) {
    response.headers.set(
      "strict-transport-security",
      "max-age=63072000; includeSubDomains; preload",
    );
  }

  // Signed-in pages are per-person. A shared cache holding one is a data leak.
  const path = request.nextUrl.pathname;
  const isAsset = path.startsWith("/_next/") || PUBLIC_FILE.test(path);
  if (!isAsset) {
    response.headers.set("cache-control", "no-store, must-revalidate");
  }

  // --- 3. Rolling session cookie ------------------------------------------
  // Re-stamped with a full TTL on every page view, so the browser's copy never
  // ages out under an active user. Nothing is validated here: the token is
  // opaque, and `getViewer()` still checks it against the database on every
  // request, so refreshing a revoked or expired one grants nobody anything.
  //
  // GET pages only. A sign-out is a Server Action POST that clears this same
  // cookie, and two Set-Cookie headers for one name on one response would race.
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionToken && request.method === "GET" && !isAsset) {
    response.cookies.set(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own static output and the favicon: those are
    // public bytes, and running them through this costs latency for nothing.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
