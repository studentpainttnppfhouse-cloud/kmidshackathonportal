import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getViewer } from "@/lib/session";
import { can } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { answerText, csvCell, isUpload, parseDefinition, type ResponsePayload } from "@/lib/forms-schema";
import { appOrigin } from "@/lib/request";
import { canCompetition } from "@/lib/policy";
import { loadWorkflow } from "@/lib/competition/server";
import { buildCompetitionCsv, type ExportStage, type ExportTeam } from "@/lib/competition/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The responses table as a CSV, for whoever runs the form. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return new NextResponse("Not found", { status: 404 });

  const { id } = await params;

  const competition = await loadWorkflow(id);
  if (competition) return exportCompetition(request, competition, viewer);

  const form = await db.form.findUnique({
    where: { id },
    select: { id: true, title: true, type: true, schema: true, deletedAt: true, ownerId: true, departmentId: true },
  });
  if (!form || form.deletedAt || form.type !== "internal") return new NextResponse("Not found", { status: 404 });

  if (!can(viewer, "update", { kind: "form", departmentId: form.departmentId, ownerId: form.ownerId })) {
    await audit(viewer.id, "form.responses.export_denied", {
      type: "form",
      id: form.id,
      detail: `Denied exporting responses to "${form.title}": not the form's owner or an admin`,
    });
    return new NextResponse("Not found", { status: 404 });
  }

  const definition = parseDefinition(form.schema);
  const questions = definition?.questions ?? [];
  const responses = await db.formResponse.findMany({
    where: { formId: form.id },
    include: { user: { select: { name: true, nickname: true } } },
    orderBy: { submittedAt: "desc" },
  });

  const files = await db.attachment.findMany({
    where: { parentType: "form_response", parentId: { in: responses.map((r) => r.id) }, deletedAt: null },
    select: { id: true, name: true },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));
  const origin = await appOrigin();

  const header = ["Submitted", "Email", "Name", ...questions.map((q) => q.label)];
  const rows = responses.map((response) => {
    const payload = response.payload as ResponsePayload;
    return [
      response.submittedAt.toISOString(),
      response.respondentEmail ?? "",
      response.user ? response.user.nickname || response.user.name : "",
      ...questions.map((question) => {
        if (!isUpload(question.type)) return answerText(payload, question);
        const ids = Array.isArray(payload[question.id]) ? (payload[question.id] as string[]) : [];
        return ids
          .map((fid) => fileById.get(fid))
          .filter((f) => f !== undefined)
          .map((f) => `${f.name} (${origin}/api/attachments/${f.id})`)
          .join("; ");
      }),
    ];
  });

  const csv = "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";

  await audit(viewer.id, "form.responses.exported", {
    type: "form",
    id: form.id,
    detail: `Exported ${responses.length} responses to "${form.title}" as CSV`,
  });

  const filename = `${form.title.replace(/[^A-Za-z0-9-_ ]+/g, "").trim().replace(/\s+/g, "-") || "form"}-responses.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

/**
 * A competition form's teams as CSV, one stage at a time. Heads, admins and the
 * owner may export registrations and Round 1; stage H (emergency contacts,
 * dietary and access needs) is admins and the owner only. Identity documents
 * are named but only linked for admins and the owner, and the link itself
 * still goes through the attachment permission check. Continuation links are
 * never exported: only their hashes are stored.
 */
async function exportCompetition(
  request: Request,
  loaded: NonNullable<Awaited<ReturnType<typeof loadWorkflow>>>,
  viewer: NonNullable<Awaited<ReturnType<typeof getViewer>>>,
) {
  const raw = new URL(request.url).searchParams.get("stage") ?? "registration";
  const stage: ExportStage = raw === "F" || raw === "H" ? raw : "registration";
  const allowed = canCompetition(viewer, "export") && (stage !== "H" || canCompetition(viewer, "edit"));
  if (!allowed) {
    await audit(viewer.id, "competition.export_denied", {
      type: "form",
      id: loaded.form.id,
      detail: `Denied exporting stage ${stage} of "${loaded.form.title}"`,
    });
    return new NextResponse("Not found", { status: 404 });
  }

  const teams = await db.competitionTeam.findMany({
    where: { workflowId: loaded.workflow.id },
    include: { submissions: true },
    orderBy: { seq: "asc" },
  });
  const files = await db.attachment.findMany({
    where: {
      parentId: { in: teams.map((t) => t.id) },
      parentType: { in: ["competition_team", "competition_identity"] },
      deletedAt: null,
    },
    select: { id: true, name: true, parentType: true },
  });
  const origin = await appOrigin();
  const seeIdentity = canCompetition(viewer, "view_identity");
  const byId = new Map(files.map((f) => [f.id, f]));
  const fileRef = (fileId: string) => {
    const file = byId.get(fileId);
    if (!file) return null;
    const linked = file.parentType !== "competition_identity" || seeIdentity;
    return { name: file.name, url: linked ? `${origin}/api/attachments/${file.id}` : null };
  };

  const csv = buildCompetitionCsv(loaded.definition, stage, teams as unknown as ExportTeam[], fileRef);

  await audit(viewer.id, "competition.exported", {
    type: "form",
    id: loaded.form.id,
    detail: `Exported ${teams.length} teams, stage ${stage}, from "${loaded.form.title}"`,
  });

  const name = `hackathon-${loaded.workflow.year}-${loaded.workflow.track}-${stage === "registration" ? "registrations" : `stage-${stage}`}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
