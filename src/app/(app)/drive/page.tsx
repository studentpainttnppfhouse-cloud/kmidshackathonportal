import Link from "next/link";
import { requirePageAccess, canEditPage, atLeast } from "@/lib/authorize";
import { driveItems } from "@/lib/workspace-access";
import { PageHeader } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Drive({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string }>;
}) {
  const v = await requirePageAccess("documents");
  const sp = await searchParams;
  const items = await driveItems(v, sp.view, sp.q);
  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Workspace"
        title="Portal drive"
        subtitle="Your documents and files, plus items shared with you."
        action={
          canEditPage(v, "documents") &&
          atLeast(v, "T1_MEMBER") &&
          !v.isAlumni ? (
            <Link href="/drive/new" className="hs-btn hs-btn-primary">
              New document / upload
            </Link>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2">
        {[
          ["all", "All"],
          ["mine", "My drive"],
          ["shared", "Shared with me"],
        ].map(([id, label]) => (
          <Link
            key={id}
            href={"/drive?view=" + id}
            className={`hs-btn ${sp.view === id || (!sp.view && id === "all") ? "hs-btn-primary" : "hs-btn-secondary"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <form className="flex gap-2">
        <input type="hidden" name="view" value={sp.view ?? "all"} />
        <input
          aria-label="Search drive"
          name="q"
          defaultValue={sp.q}
          placeholder="Search your drive"
          className="hs-input"
        />
        <button className="hs-btn hs-btn-secondary">Search</button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((d) => (
          <Link
            key={d.id}
            href={`/drive/${d.id}`}
            className="hs-card block p-4"
          >
            <h2 className="font-semibold">{d.title}</h2>
            <p className="text-xs text-muted">
              {d.ownerId === v.id ? "Owned by you" : "Shared with you"} ·{" "}
              {d.kind === "folder" ? "Files" : "Document"} ·{" "}
              {d.scope === "private" ? "Private" : d.scope}
            </p>
          </Link>
        ))}
      </div>
      {!items.length ? (
        <p className="hs-card p-5">
          No documents here yet. Create a document or file collection to upload
          files.
        </p>
      ) : null}
    </div>
  );
}
