import "server-only";

/**
 * Outgoing email through Resend (https://resend.com), called over plain HTTPS
 * so there is no extra package. Off unless RESEND_API_KEY is set; callers fall
 * back to the admin flow when `mailEnabled()` is false or sending fails.
 */

const DEFAULT_FROM = "KMIDS Hack Portal <no-reply@kmidshackportal.com>";

export function mailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || DEFAULT_FROM, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[mail] Resend refused the email:", res.status, await res.text().catch(() => ""));
    return res.ok;
  } catch (err) {
    console.error("[mail] Could not reach Resend:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function resetEmail(name: string, url: string, origin: string, minutes: number) {
  const n = escapeHtml(name);
  const u = escapeHtml(url);
  const logo = escapeHtml(`${origin}/hack-logo-black.png`);
  const html = `<!doctype html><html><body style="margin:0;background:#f6f6f8;font-family:Arial,Helvetica,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;padding:32px">
<tr><td align="center" style="padding-bottom:24px"><img src="${logo}" alt="HACK" height="40" style="height:40px"></td></tr>
<tr><td style="font-size:16px;line-height:1.5">
<p style="margin:0 0 12px">Hi ${n},</p>
<p style="margin:0 0 20px">Someone asked to reset the password for your KMIDS Hack Portal account. Click the button to choose a new one.</p>
<p style="margin:0 0 24px;text-align:center"><a href="${u}" style="display:inline-block;background:#e0457b;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold">Reset password</a></p>
<p style="margin:0 0 12px;font-size:14px;color:#555">The link works once and expires in ${minutes} minutes. If the button does not work, copy this into your browser:<br><a href="${u}" style="color:#e0457b;word-break:break-all">${u}</a></p>
<p style="margin:0;font-size:14px;color:#555">If you did not ask for this, you can ignore this email. Your password stays the same.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `Hi ${name},\n\nSomeone asked to reset the password for your KMIDS Hack Portal account.\nOpen this link to choose a new one (works once, expires in ${minutes} minutes):\n\n${url}\n\nIf you did not ask for this, ignore this email. Your password stays the same.`;
  return { subject: "Reset your KMIDS Hack Portal password", html, text };
}
