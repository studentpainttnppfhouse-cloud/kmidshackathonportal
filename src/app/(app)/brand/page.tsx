import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, can } from "@/lib/authorize";
import { listAttachments } from "@/lib/attachment-access";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { AssetsSection } from "./assets";
import { FontsSection, LogosSection, PaletteSection } from "./kit";
import { LastUpdated, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Brand kit" };
export const dynamic = "force-dynamic";

/**
 * The brand kit. Every part of it is data: the palette is rows admins edit,
 * and fonts and logos are uploaded files that anyone can preview and download.
 */
export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; dept?: string; tag?: string }>;
}) {
  const viewer = await requireViewer();
  const { q, dept, tag } = await searchParams;

  const [colors, fonts, logos] = await Promise.all([
    db.brandToken.findMany({
      where: { kind: "color" },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    listAttachments("brand_font", "kit"),
    listAttachments("brand_logo", "kit"),
  ]);

  const canEdit = can(viewer, "manage_departments", { kind: "system" });
  const lastChanged = colors.reduce<Date | null>(
    (latest, c) => (latest === null || c.updatedAt > latest ? c.updatedAt : latest),
    null,
  );
  const slim = (f: { id: string; name: string; size: number; mimeType: string }) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    mimeType: f.mimeType,
  });

  return (
    <div className="hs-enter mx-auto max-w-[1100px] space-y-5">
      <PageHeader eyebrow="Shared resources" title="Brand kit" />

      <PaletteSection
        colors={colors.map((c) => ({
          id: c.id,
          name: c.name,
          value: c.value,
          groupName: c.groupName,
          note: c.note,
        }))}
        canEdit={canEdit}
      />

      <FontsSection fonts={fonts.filter((f) => f.storage === "db").map(slim)} canEdit={canEdit} maxBytes={MAX_UPLOAD_BYTES} />

      <LogosSection
        logos={logos.filter((f) => f.storage === "db" && f.mimeType.startsWith("image/")).map(slim)}
        canEdit={canEdit}
        maxBytes={MAX_UPLOAD_BYTES}
      />

      <AssetsSection viewer={viewer} q={q} dept={dept} tag={tag} />

      <LastUpdated at={lastChanged} label="Palette last changed" />
    </div>
  );
}
