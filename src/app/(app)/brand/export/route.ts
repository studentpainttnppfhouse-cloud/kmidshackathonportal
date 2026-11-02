import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/session";
import { audit } from "@/lib/audit";
import { PdfBuilder } from "@/lib/export/pdf";
import { RULES, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The brand kit as a one-file PDF.
 *
 * The point of a brand kit is that somebody outside the portal — a printer, a
 * sponsor's designer, next year's team — can use it. A page behind a login is
 * not that; a PDF somebody can attach to an email is. Every swatch is drawn as
 * a real filled rectangle with its hex printed beside it, so the file is usable
 * as a specification rather than a screenshot.
 */



export async function GET(): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const limit = rateLimit(`export:${viewer.id}`, RULES.search);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many exports at once." },
      { status: 429, headers: { "retry-after": String(limit.retryAfter) } },
    );
  }

  const tokens = await db.brandToken.findMany({
    where: { kind: "color" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const colors = tokens.filter((t) => t.kind === "color");
  const fontFiles = await db.attachment.findMany({
    where: { parentType: "brand_font", parentId: "kit", deletedAt: null },
    select: { name: true },
    orderBy: { createdAt: "asc" },
  });

  const pdf = new PdfBuilder();

  pdf.text("Hackathon Studio", { size: 26, font: "Helvetica-Bold", color: "#BE185D", spaceAfter: 2 });
  pdf.text("Brand Kit — KMIDS Hackathon 2027", { size: 12, color: "#64748B", spaceAfter: 8 });
  pdf.rule();

  pdf.text("Core palette", { size: 15, font: "Helvetica-Bold", spaceAfter: 6 });
  let currentGroup: string | null = null;
  for (const color of colors) {
    const group = color.groupName ?? "Other";
    if (group !== currentGroup) {
      currentGroup = group;
      pdf.space(6);
      pdf.text(group, { size: 11, font: "Helvetica-Bold", color: "#64748B", spaceAfter: 4 });
    }
    pdf.swatch(color.value, color.name, color.note ?? "");
  }

  pdf.space(10);
  pdf.rule();
  pdf.text("Typography", { size: 15, font: "Helvetica-Bold", spaceAfter: 6 });
  if (fontFiles.length === 0) {
    pdf.text("No fonts uploaded yet.", { size: 10, spaceAfter: 2 });
  }
  for (const f of fontFiles) {
    pdf.text(`${f.name.replace(/\.(ttf|otf|woff2?)$/i, "")}  (${f.name})`, { size: 10, indent: 12, spaceAfter: 2 });
  }

  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date());

  pdf.space(12);
  pdf.text(`Exported from Hackathon Studio on ${stamp}.`, { size: 8.5, color: "#94A3B8" });

  await audit(viewer.id, "brand.exported");

  return new NextResponse(pdf.build() as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="hackathon-studio-brand-kit.pdf"',
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
