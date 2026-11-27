import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireViewer } from "@/lib/authorize";
import { canCompetition } from "@/lib/policy";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { loadWorkflow } from "@/lib/competition/server";
import { previewOnly } from "@/lib/actions/competition-admin";
import { CompetitionForm } from "@/components/competition-form";
import { EventLinks, Markdown } from "@/components/competition-public";
import { Banner } from "@/components/ui";

export const metadata: Metadata = { title: "Preview" };
export const dynamic = "force-dynamic";

/**
 * Staff see a draft exactly as participants will, inside the portal. Every
 * submit button here goes to an action that saves nothing.
 */
export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;
  const loaded = await loadWorkflow(id);
  if (!loaded || !canCompetition(viewer, "view")) notFound();
  const { form, definition, settings, workflow } = loaded;
  const sample = { code: `${workflow.track}01`, name: "Sample Team", roster: ["Member One", "Member Two"] };

  return (
    <div className="hs-enter space-y-5">
      <Link href={`/forms/${form.id}`} className="text-sm font-semibold text-brand-deep">
        ← Back to the form
      </Link>
      <Banner tone="warn">Staff preview. Nothing you submit here is saved.</Banner>

      <div className="hs-card mx-auto max-w-2xl p-5 sm:p-8">
        <h1 className="text-2xl font-bold text-ink">{definition.title}</h1>
        <Markdown source={definition.intro} className="mt-4" />
        <div className="mt-4">
          <EventLinks settings={settings} />
        </div>
        <div className="mt-8">
          <CompetitionForm
            mode="register"
            formId={form.id}
            sections={definition.sections}
            maxBytes={MAX_UPLOAD_BYTES}
            submitLabel={definition.registerLabel}
            action={previewOnly}
            payment={
              workflow.track === "external"
                ? {
                    payeeName: settings.payeeName || "(payee not set)",
                    bankName: settings.bankName,
                    accountNumber: settings.accountNumber,
                    promptPayId: settings.promptPayId,
                    paymentQr: settings.paymentQr,
                    expectedFee: settings.expectedFee,
                    refundPolicy: settings.refundPolicy || "(refund policy not set)",
                  }
                : null
            }
          />
        </div>
      </div>

      <div className="hs-card mx-auto max-w-2xl space-y-4 p-5 sm:p-8">
        <p className="hs-eyebrow">Stage F, as a team with ID {sample.code} sees it</p>
        <h2 className="text-xl font-bold text-ink">{definition.f.title}</h2>
        <Markdown source={definition.f.intro} />
        <CompetitionForm
          mode="F"
          formId={form.id}
          token="preview"
          team={sample}
          sections={definition.f.sections}
          maxBytes={MAX_UPLOAD_BYTES}
          submitLabel={definition.f.submitLabel}
          action={previewOnly}
        />
      </div>

      <div className="hs-card mx-auto max-w-2xl space-y-4 p-5 sm:p-8">
        <p className="hs-eyebrow">Stage H · private draft{workflow.stageHActive ? " (switched on)" : ", not visible to anyone outside staff"}</p>
        <h2 className="text-xl font-bold text-ink">{definition.h.title}</h2>
        <Markdown source={definition.h.intro} />
        <CompetitionForm
          mode="H"
          formId={form.id}
          token="preview"
          team={sample}
          sections={definition.h.sections}
          maxBytes={MAX_UPLOAD_BYTES}
          submitLabel={definition.h.submitLabel}
          action={previewOnly}
        />
      </div>
    </div>
  );
}
