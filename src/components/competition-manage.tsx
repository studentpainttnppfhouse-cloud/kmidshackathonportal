import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { canCompetition, isOwner, type Viewer } from "@/lib/policy";
import { appOrigin } from "@/lib/request";
import {
  availability,
  bangkokTimestamp,
  toBangkokLocal,
  type LoadedWorkflow,
} from "@/lib/competition/server";
import { keyQuestionIds, unresolvedSettings, type CAnswers } from "@/lib/competition/schema";
import {
  createFromTemplate,
  duplicateCompetition,
  setCompetitionPublished,
  setStageH,
} from "@/lib/actions/competition-admin";
import { SettingsForm } from "@/components/competition-admin-forms";
import { Banner, Card, SectionTitle } from "@/components/ui";

const PAYMENT_LABEL: Record<string, string> = {
  not_required: "Free",
  pending: "Not checked",
  verified: "Verified",
  flagged: "Problem",
};

/**
 * The staff page for one competition form: what still needs deciding, the
 * publish switch, settings, and every registered team with its separate
 * statuses (registered, payment, Round 1, access checked, finalist).
 */
export async function CompetitionManage({ loaded, viewer }: { loaded: LoadedWorkflow; viewer: Viewer }) {
  if (!canCompetition(viewer, "view")) notFound();
  const { form, workflow, settings, definition } = loaded;

  const mayEdit = canCompetition(viewer, "edit");
  const mayPublish = canCompetition(viewer, "publish", { publishDelegatedToAdmins: settings.publishDelegatedToAdmins });
  const mayExport = canCompetition(viewer, "export");
  const owner = isOwner(viewer);

  const issues = unresolvedSettings(workflow.track, settings, workflow);
  const blocking = issues.filter((i) => i.blocksPublish);
  const state = availability(workflow);
  const publicUrl = `${await appOrigin()}/f/${form.slug ?? form.id}`;

  const teams = await db.competitionTeam.findMany({
    where: { workflowId: workflow.id },
    include: { submissions: { select: { stage: true, status: true, finalizedAt: true, payload: true, archiveStatus: true } } },
    orderBy: { seq: "asc" },
  });
  const keys = keyQuestionIds(workflow.track);
  const p = workflow.track === "internal" ? "I" : "E";
  const fDone = teams.filter((t) => t.submissions.some((s) => s.stage === "F" && s.status === "final")).length;

  const publish = setCompetitionPublished.bind(null, form.id, true);
  const unpublish = setCompetitionPublished.bind(null, form.id, false);
  const hOn = setStageH.bind(null, form.id, true);
  const hOff = setStageH.bind(null, form.id, false);
  const duplicate = duplicateCompetition.bind(null, form.id);

  return (
    <div className="hs-enter space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/forms" className="text-sm font-semibold text-brand-deep">
          ← All forms
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href={`/forms/${form.id}/preview`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
            Preview
          </Link>
          {mayEdit ? (
            <>
              <Link href={`/forms/${form.id}/edit`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                Edit wording
              </Link>
              <form action={duplicate}>
                <button type="submit" className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                  Duplicate as draft
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>

      <Card>
        <p className="hs-eyebrow">
          Competition form · {workflow.track === "internal" ? "Internal track (KMIDS only)" : "External track"} ·{" "}
          {workflow.year}
        </p>
        <h1 className="hs-h1 mt-1">{definition.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className={`hs-pill ${workflow.status === "published" ? "bg-tint text-brand-deep" : "bg-surface-2 text-muted"}`}>
            {workflow.status === "published" ? "Published" : "Private draft"}
          </span>
          <span className="hs-pill bg-surface-2 text-muted">
            {state === "open"
              ? "Taking registrations now"
              : state === "not_yet_open"
                ? "Not open yet"
                : state === "closed"
                  ? "Closed"
                  : "No public link"}
          </span>
          <span className="hs-pill bg-surface-2 text-muted">
            Finalist confirmation (H): {workflow.stageHActive ? "on" : "off"}
          </span>
          <span className="hs-pill bg-surface-2 text-muted">Schema version {workflow.version}</span>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-faint">Opens</dt>
            <dd className="text-ink">{workflow.opensAt ? bangkokTimestamp(workflow.opensAt) : "Not set"}</dd>
          </div>
          <div>
            <dt className="text-faint">Closes</dt>
            <dd className="text-ink">{workflow.closesAt ? bangkokTimestamp(workflow.closesAt) : "Not set"}</dd>
          </div>
        </dl>
        {workflow.status === "published" ? (
          <p className="mt-4 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink">{publicUrl}</p>
        ) : (
          <p className="mt-4 text-xs text-faint">
            Drafts have no working public link. Use Preview to check the form.
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2 border-t border-line-soft pt-4">
          {mayPublish ? (
            workflow.status === "published" ? (
              <form action={unpublish}>
                <button type="submit" className="hs-btn hs-btn-secondary">
                  Take down (back to draft)
                </button>
              </form>
            ) : (
              <form action={publish}>
                <button type="submit" className="hs-btn hs-btn-primary" disabled={blocking.length > 0}>
                  Publish
                </button>
              </form>
            )
          ) : (
            <p className="text-xs text-faint">Only the owner{settings.publishDelegatedToAdmins ? " and admins" : ""} can publish.</p>
          )}
          {owner ? (
            <form action={workflow.stageHActive ? hOff : hOn}>
              <button
                type="submit"
                className="hs-btn hs-btn-secondary"
                disabled={!workflow.stageHActive && settings.guardianConsentText === ""}
              >
                {workflow.stageHActive ? "Turn off finalist confirmation (H)" : "Turn on finalist confirmation (H)"}
              </button>
            </form>
          ) : null}
          {owner && !workflow.stageHActive && settings.guardianConsentText === "" ? (
            <p className="w-full text-xs text-faint">
              Finalist confirmation stays off until the approved guardian consent text is added in the settings.
            </p>
          ) : null}
        </div>
      </Card>

      {issues.length > 0 ? (
        <Card>
          <SectionTitle>Still to decide</SectionTitle>
          <p className="mb-3 text-sm text-muted">
            Nothing here is filled in by guesswork. Items marked <strong>needed to publish</strong> keep the public link
            off until they are set.
          </p>
          <ul className="space-y-1.5 text-sm">
            {issues.map((i) => (
              <li key={i.key} className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true">{i.blocksPublish ? "⛔" : "•"}</span>
                <span className="text-ink">{i.label}</span>
                {i.blocksPublish ? <span className="hs-pill bg-tint text-brand-deep">needed to publish</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {mayEdit ? (
        <Card>
          <details className="hs-disclosure">
            <summary>Organizer settings</summary>
            <div className="pt-4">
              <SettingsForm
                formId={form.id}
                track={workflow.track}
                settings={settings}
                opensAt={toBangkokLocal(workflow.opensAt)}
                closesAt={toBangkokLocal(workflow.closesAt)}
                isOwner={owner}
              />
            </div>
          </details>
        </Card>
      ) : null}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>
            Teams · {teams.length} registered · {fDone} Round 1 submitted
          </SectionTitle>
          {mayExport ? (
            <div className="flex flex-wrap gap-2">
              <a href={`/api/forms/${form.id}/export?stage=registration`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                Registrations · Export CSV (Excel compatible)
              </a>
              <a href={`/api/forms/${form.id}/export?stage=F`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                Round 1 · Export CSV (Excel compatible)
              </a>
              {workflow.stageHActive && mayEdit ? (
                <a href={`/api/forms/${form.id}/export?stage=H`} className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
                  Finalists (H) · Export CSV
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {teams.length === 0 ? (
          <p className="text-sm text-faint">No teams yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="text-faint">
                <tr>
                  <th className="py-2 pr-3">Team ID</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Members</th>
                  <th className="py-2 pr-3">Representative</th>
                  <th className="py-2 pr-3">Registered</th>
                  <th className="py-2 pr-3">Status</th>
                  {workflow.track === "external" ? <th className="py-2 pr-3">Payment</th> : null}
                  <th className="py-2 pr-3">Round 1</th>
                  <th className="py-2 pr-3">Folder</th>
                  <th className="py-2 pr-3">Access</th>
                  <th className="py-2 pr-3">Finalist</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const f = t.submissions.find((s) => s.stage === "F");
                  const fAnswers = ((f?.payload as { answers?: CAnswers } | undefined)?.answers ?? {}) as CAnswers;
                  const folder = fAnswers[`${p}-F05`];
                  const answers = ((t.registration as { answers?: CAnswers }).answers ?? {}) as CAnswers;
                  return (
                    <tr key={t.id} className="border-t border-line align-top">
                      <td className="py-2 pr-3 font-mono font-semibold">
                        <Link href={`/forms/${form.id}/teams/${t.id}`} className="text-brand-deep hover:underline">
                          {t.teamCode}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-ink">{t.teamName}</td>
                      <td className="py-2 pr-3">
                        {t.memberCount} · {answers[keys.memberName(1)] ?? ""}
                      </td>
                      <td className="py-2 pr-3 break-all">{t.representativeEmail}</td>
                      <td className="py-2 pr-3">{bangkokTimestamp(t.registeredAt).replace(" (Bangkok time)", "")}</td>
                      <td className="py-2 pr-3 capitalize">{t.registrationStatus}</td>
                      {workflow.track === "external" ? (
                        <td className={`py-2 pr-3 ${t.paymentStatus === "flagged" || t.paymentFlag ? "font-semibold text-danger-strong" : ""}`}>
                          {PAYMENT_LABEL[t.paymentStatus] ?? t.paymentStatus}
                          {t.paymentFlag ? " · amount differs" : ""}
                        </td>
                      ) : null}
                      <td className="py-2 pr-3">
                        {f?.status === "final"
                          ? `Submitted ${f.finalizedAt ? bangkokTimestamp(f.finalizedAt).replace(" (Bangkok time)", "") : ""}${f.archiveStatus === "archived" ? " · archived" : ""}`
                          : f?.status === "reopened"
                            ? "Reopened by owner"
                            : "Not submitted"}
                      </td>
                      <td className="py-2 pr-3">
                        {folder ? (
                          <a href={folder} target="_blank" rel="noreferrer noopener" className="text-brand-deep underline">
                            Open ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3">{t.accessChecked ? "Checked" : "—"}</td>
                      <td className="py-2 pr-3">{t.finalist ? "Selected" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {workflow.status === "draft" && teams.length === 0 ? (
        <Banner tone="info">
          This is a private draft. Participants cannot open it, even with the link, until it is published.
        </Banner>
      ) : null}
    </div>
  );
}

/** "New form" page: start a competition draft from a template. Admins only. */
export function TemplatePicker() {
  const internal = createFromTemplate.bind(null, "internal");
  const external = createFromTemplate.bind(null, "external");
  return (
    <Card>
      <SectionTitle>Start from a 2027 competition template</SectionTitle>
      <p className="mb-3 text-sm text-muted">
        Makes a new private draft with the approved questions. The template and existing forms are not changed.
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={internal}>
          <button type="submit" className="hs-btn hs-btn-secondary">
            Internal Round 1 2027
          </button>
        </form>
        <form action={external}>
          <button type="submit" className="hs-btn hs-btn-secondary">
            External Round 1 2027
          </button>
        </form>
      </div>
    </Card>
  );
}
