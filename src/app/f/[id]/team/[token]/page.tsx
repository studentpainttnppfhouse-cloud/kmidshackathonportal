import type { Metadata } from "next";
import Link from "next/link";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { keyQuestionIds, namingFor, type CAnswers } from "@/lib/competition/schema";
import { availability, bangkokTimestamp, fillReceipt, loadWorkflow, teamByToken } from "@/lib/competition/server";
import { submitFinalistConfirmation, submitRoundOne } from "@/lib/actions/competition-public";
import { CompetitionForm } from "@/components/competition-form";
import { Markdown, PublicShell, reviewerAccessText } from "@/components/competition-public";

export const metadata: Metadata = {
  title: "Your team · KMIDS Hackathon 2027",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/**
 * A team's private page, reached only through its secret link.
 *
 * Shows the saved team and roster, takes the Round 1 folder (stage F) once,
 * and, only after the owner switches stage H on and staff mark the team as a
 * finalist, the finalist confirmation. Every check here is repeated by the
 * submit actions; this page only decides what to draw.
 */
export default async function TeamPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  const loaded = await loadWorkflow(id);
  const team = await teamByToken(token);

  if (!loaded || !team || team.workflowId !== loaded.workflow.id || loaded.workflow.status !== "published") {
    return (
      <PublicShell>
        <h1 className="text-xl font-bold text-ink">This link does not work</h1>
        <p className="mt-2 text-sm text-muted">
          It may be an older link that has been replaced. Use the newest link sent to your team
          {loaded ? (
            <>
              , or{" "}
              <Link href={`/f/${loaded.form.id}/recover`} className="font-semibold text-brand-deep">
                ask for a new one
              </Link>
            </>
          ) : null}
          .
        </p>
      </PublicShell>
    );
  }

  const { form, workflow, definition, settings } = loaded;
  const answers = ((team.registration as { answers?: CAnswers }).answers ?? {}) as CAnswers;
  const keys = keyQuestionIds(workflow.track);
  const roster = Array.from({ length: team.memberCount }, (_, i) => answers[keys.memberName(i + 1)] ?? `Member ${i + 1}`);
  const teamSummary = { code: team.teamCode, name: team.teamName, roster };

  const f = team.submissions.find((s) => s.stage === "F");
  const fFinal = f?.status === "final";
  const h = team.submissions.find((s) => s.stage === "H");
  const state = availability(workflow);
  const inactive = team.registrationStatus === "withdrawn" || team.registrationStatus === "rejected";
  const showH = workflow.stageHActive && team.finalist && !inactive;
  const naming = namingFor(team.teamCode, team.teamName);
  const access = reviewerAccessText(settings);
  const fAnswers = ((f?.payload as { answers?: CAnswers } | undefined)?.answers ?? {}) as CAnswers;
  const p = workflow.track === "internal" ? "I" : "E";

  return (
    <PublicShell>
      <p className="hs-eyebrow">{definition.title}</p>
      <h1 className="mt-1 text-2xl font-bold text-ink">{team.teamName}</h1>
      <p className="mt-1 font-mono text-lg font-bold text-brand-deep">{team.teamCode}</p>
      <p className="mt-2 text-sm text-muted">Members: {roster.join(", ")}</p>
      <p className="mt-1 text-xs text-faint">Registered {bangkokTimestamp(team.registeredAt)}</p>

      {inactive ? (
        <p className="hs-feedback hs-feedback-error mt-6">
          This registration is no longer active. Please contact the organizers.
        </p>
      ) : null}

      <section className="mt-8 space-y-4 border-t border-line pt-6">
        <h2 className="text-lg font-bold text-ink">{definition.f.title}</h2>

        {fFinal ? (
          <div className="space-y-2 rounded-2xl border border-line p-4 text-sm">
            <p className="font-semibold text-ink">
              <span aria-hidden="true">🔒 </span>Submitted and locked
            </p>
            <Markdown
              source={fillReceipt(definition.f.receipt, {
                teamId: team.teamCode,
                BangkokTimestamp: f?.finalizedAt ? bangkokTimestamp(f.finalizedAt) : "",
                submissionReference: f?.reference ?? "",
              })}
            />
            <p className="text-muted">Project: {fAnswers[`${p}-F03`] ?? ""}</p>
            <p className="break-all text-muted">Folder: {fAnswers[`${p}-F05`] ?? ""}</p>
          </div>
        ) : inactive ? null : state === "open" ? (
          <>
            <div className="space-y-2 rounded-2xl border border-brand bg-tint/40 p-4 text-sm">
              <p className="font-semibold text-ink">Your names, ready to copy</p>
              <p className="text-xs text-muted">Folder</p>
              <p className="break-all rounded-lg bg-surface px-3 py-1.5 font-mono text-xs text-ink">{naming.folder}/</p>
              <p className="text-xs text-muted">Files inside it</p>
              <ul className="space-y-1 font-mono text-xs text-ink">
                <li className="break-all rounded-lg bg-surface px-3 py-1.5">{naming.video}</li>
                <li className="break-all rounded-lg bg-surface px-3 py-1.5">{naming.deck}</li>
                <li className="break-all rounded-lg bg-surface px-3 py-1.5">{naming.brief}</li>
              </ul>
              <p className="text-xs text-faint">
                Using an unlisted YouTube video instead of the MP4? Name the link PDF{" "}
                <span className="font-mono">{naming.videoLink}</span>.
              </p>
              {access ? <p className="text-xs font-semibold text-brand-deep">{access}</p> : null}
            </div>
            <Markdown source={definition.f.intro} />
            {workflow.closesAt ? (
              <p className="text-sm font-semibold text-brand-deep">Deadline: {bangkokTimestamp(workflow.closesAt)}</p>
            ) : null}
            <CompetitionForm
              mode="F"
              formId={form.id}
              token={token}
              team={teamSummary}
              sections={definition.f.sections}
              maxBytes={MAX_UPLOAD_BYTES}
              submitLabel={definition.f.submitLabel}
              action={submitRoundOne}
              deadlineText={workflow.closesAt ? bangkokTimestamp(workflow.closesAt) : undefined}
            />
          </>
        ) : (
          <p className="text-sm text-muted">
            {state === "closed"
              ? "The Round 1 deadline has passed. No entry was submitted for this team."
              : "Round 1 submission is not open."}
          </p>
        )}
      </section>

      {showH ? (
        <section className="mt-8 space-y-4 border-t border-line pt-6">
          <h2 className="text-lg font-bold text-ink">{definition.h.title}</h2>
          {h?.status === "final" ? (
            <Markdown
              source={`🔒 ${fillReceipt(definition.h.receipt, {
                teamId: team.teamCode,
                BangkokTimestamp: h.finalizedAt ? bangkokTimestamp(h.finalizedAt) : "",
                submissionReference: h.reference ?? "",
              })}`}
            />
          ) : (
            <>
              <Markdown source={definition.h.intro} />
              <CompetitionForm
                mode="H"
                formId={form.id}
                token={token}
                team={teamSummary}
                sections={definition.h.sections}
                maxBytes={MAX_UPLOAD_BYTES}
                submitLabel={definition.h.submitLabel}
                action={submitFinalistConfirmation}
              />
            </>
          )}
        </section>
      ) : null}
    </PublicShell>
  );
}
