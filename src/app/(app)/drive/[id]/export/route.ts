import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/session";
import { db } from "@/lib/db";
import { readDrive } from "@/lib/workspace-access";
import { buildDocx } from "@/lib/export/docx";
import { buildPdf } from "@/lib/export/pdf";
import { rateLimit, RULES } from "@/lib/rate-limit";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const v = await getViewer();
  if (!v) return new NextResponse("Sign in first", { status: 401 });
  if (!rateLimit(`export:${v.id}`, RULES.search).ok)
    return new NextResponse("Try again later", { status: 429 });
  const { id } = await params;
  const d = await db.driveItem.findUnique({ where: { id } });
  if (!d || !(await readDrive(v, d)))
    return new NextResponse("Not found", { status: 404 });
  const f = req.nextUrl.searchParams.get("format") ?? "md";
  if (!["docx", "pdf", "md"].includes(f) || d.kind !== "document")
    return new NextResponse("Unsupported format", { status: 400 });
  const data = {
    title: d.title,
    body: d.body ?? "",
    subtitle: "KMIDS Hackathon 2027",
    footNote: "Exported from Portal drive",
  };
  const bytes =
    f === "docx"
      ? buildDocx(data)
      : f === "pdf"
        ? buildPdf(data)
        : `# ${d.title}\n\n${d.body ?? ""}`;
  const name =
    d.title.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "document";
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "content-type":
        f === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : f === "pdf"
            ? "application/pdf"
            : "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${name}.${f}"`,
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
    },
  });
}
