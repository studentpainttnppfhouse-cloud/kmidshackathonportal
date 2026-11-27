import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireViewer } from "@/lib/authorize";
import { audit } from "@/lib/audit";
import { canCompetition } from "@/lib/policy";
import { formatBytes } from "@/lib/attachments";
import { bangkokTimestamp, loadWorkflow } from "@/lib/competition/server";
import { expandSection, type CAnswers, type CSection } from "@/lib/competition/schema";
import { ArchiveForm, IssueLinkForm, ReopenForm, ReviewForm } from "@/components/competition-admin-forms";
import { Card, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

type Stored = { answers?: CAnswers; files?: Record<string, string>; shown?: string[]; flags?: string[] };

/**
 * One team, every answer, and the staff controls. Identity documents are only
 * linked for admins and the owner; for heads they are listed as "uploaded"
 * without a link, and the file endpoint refuses them too.
 */
export default async function TeamDetailPage({ params }: { params: Promise<{ id: string; teamId: string }> }) {
  const viewer = await requireViewer();
  const { id, teamId } = await params;
  const loaded = await loadWorkflow(id);
  if (!loaded || !canCompetition(viewer, "view")) notFound();

  const team = await db.competitionTeam.findUnique({ where: { id: teamId }, include: { submissions: true } });
  if (!team || team.workflowId !== loaded.workflow.id) notFound();

  const seeIdentity = canCompetition(viewer, "view_identity");
  const files = await db.attachment.findMany({
    where: { parentId: team.id, parentType: { in: ["competition_team", "competition_identity"] }, deletedAt: null },
    select: { id: true, name: true, size: true, parentType: true },
  });
  const fileById = new Map(files.map((f) => [f.id, f]));

  await audit(viewer.id, "competition.team.viewed", {
    type: "form",
    id: loaded.form.id,
    detail: `Opened ${team.teamCode}${seeIdentity ? " (with identity documents)" : ""}`,
  });

  const reg = team.registration as Stored;
  const { definition, workflow } = loaded;

  const answerList = (sections: CSection[], stored: Stored) => {
    const shown = new Set(stored.shown ?? []);
    return sections.map((section) => {
      const rows = expandSection(section, team.memberCount).filter((q) => shown.has(q.id) && q.type !== "display");
      if (rows.length === 0) return null;
      return (
        <div key={section.key} className="space-y-2">
          <p className="text-sm font-bold text-brand-deep">{section.title}</p>
          <dl className="space-y-2 text-sm">
            {rows.map((q) => {
              const fileId = stored.files?.[q.id];
              const file = fileId ? fileById.get(fileId) : undefined;
              const identity = file?.parentType === "competition_identity";
              return (
                <div key={q.id} className="grid gap-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="text-faint">
                    <span className="font-mono text-[10px]">{q.id}</span> {q.label}
                  </dt>
                  <dd className="break-words text-ink">
                    {file ? (
                      identity && !seeIdentity ? (
                        <span className="text-muted">Uploaded (admins and the owner can open it)</span>
                      ) : (
                        <a href={`/api/attachments/${file.id}`} className="text-brand-deep underline">
                          {file.name} · {formatBytes(file.size)}
                        </a>
                      )
                    ) : (
                      (stored.answers?.[q.id] ?? "—")
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      );
    });
  };

  const f = team.submissions.find((s) => s.stage === "F");
  const h = team.submissions.find((s) => s.stage === "H");

  return (
    <div className="hs-enter space-y-5">
      <Link href={`/forms/${loaded.form.id}`} className="text-sm font-semibold text-brand-deep">
        ← {definition.title}
      </Link>

      <Card>
        <p className="hs-eyebrow">{workflow.track === "internal" ? "Internal track" : "External track"}</p>
        <h1 className="hs-h1 mt-1">
          <span className="font-mono text-brand-deep">{team.teamCode}</span> · {team.teamName}
        </h1>
        <p className="mt-2 text-sm text-muted">
          Registered {bangkokTimestamp(team.registeredAt)} · {team.memberCount} member
          {team.memberCount === 1 ? "" : "s"} · schema version {team.schemaVersion}
        </p>
        {reg.flags?.length ? (
          <p className="hs-feedback hs-feedback-error mt-3">Check: {reg.flags.join("; ")}</p>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Review</SectionTitle>
        {canCompetition(viewer, "review") ? (
          <ReviewForm team={team} canChooseFinalists={canCompetition(viewer, "edit")} />
        ) : (
          <p className="text-sm text-muted">You can read this registration but not change its status.</p>
        )}
      </Card>

      <Card>
        <SectionTitle>Registration answers</SectionTitle>
        <div className="space-y-6">{answerList(definition.sections, reg)}</div>
      </Card>

      <Card>
        <SectionTitle>Round 1 submission (F)</SectionTitle>
        {f ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {f.status === "final" ? "Final and locked" : "Reopened by the owner, waiting for the team"} · reference{" "}
              <span className="font-mono text-ink">{f.reference}</span>
              {f.finalizedAt ? ` · ${bangkokTimestamp(f.finalizedAt)}` : ""}
            </p>
            <div className="space-y-6">{answerList(definition.f.sections, f.payload as Stored)}</div>
            {f.archiveStatus === "archived" ? (
              <p className="text-sm text-ok-strong">
                Organizer copy recorded {f.archivedAt ? bangkokTimestamp(f.archivedAt) : ""}: {f.archiveNote}
              </p>
            ) : f.status === "final" && canCompetition(viewer, "review") ? (
              <div className="rounded-xl border border-line p-3">
                <p className="mb-2 text-xs text-muted">
                  A saved folder link does not freeze the files. Make an organizer-owned copy of the folder, then
                  record where it is.
                </p>
                <ArchiveForm submissionId={f.id} />
              </div>
            ) : null}
            {f.status === "final" && canCompetition(viewer, "correct") ? (
              <details className="hs-disclosure">
                <summary>Owner: reopen this locked entry</summary>
                <div className="pt-3">
                  <ReopenForm submissionId={f.id} />
                </div>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-faint">Not submitted.</p>
        )}
      </Card>

      {h ? (
        <Card>
          <SectionTitle>Finalist confirmation (H)</SectionTitle>
          {canCompetition(viewer, "edit") ? (
            <div className="space-y-6">{answerList(definition.h.sections, h.payload as Stored)}</div>
          ) : (
            <p className="text-sm text-muted">Received. Admins and the owner can read the details.</p>
          )}
        </Card>
      ) : null}

      {canCompetition(viewer, "edit") ? (
        <Card>
          <SectionTitle>Team link</SectionTitle>
          <p className="mb-3 text-sm text-muted">
            If the team lost its link and email is not working, make a new one here and send it to Member 1 only.
          </p>
          <IssueLinkForm teamId={team.id} />
        </Card>
      ) : null}
    </div>
  );
}
