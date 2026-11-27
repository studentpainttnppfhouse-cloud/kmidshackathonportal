import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWorkflow } from "@/lib/competition/server";
import { PublicShell } from "@/components/competition-public";
import { RecoverForm } from "@/components/competition-recover";

export const metadata: Metadata = { title: "Team link · KMIDS Hackathon 2027", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Getting a lost team link back. The new link goes to the registered
 * representative's inbox and is never shown here, so knowing a team ID and an
 * email address is not enough to take over a team.
 */
export default async function RecoverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadWorkflow(id);
  if (!loaded || loaded.workflow.status !== "published") notFound();

  return (
    <PublicShell>
      <h1 className="text-xl font-bold text-ink">Get your team link again</h1>
      <p className="mt-2 text-sm text-muted">
        Enter your team ID and Member 1&apos;s email address, exactly as registered. If they match, we email a new
        private link to Member 1. The old link stops working.
      </p>
      <RecoverForm formId={loaded.form.id} />
    </PublicShell>
  );
}
