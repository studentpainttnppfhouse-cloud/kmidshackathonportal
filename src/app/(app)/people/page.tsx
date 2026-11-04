import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, isAdmin } from "@/lib/authorize";
import { PageHeader } from "@/components/ui";
import {
  AddPersonButton,
  PeopleTable,
  type PersonRow,
} from "./people-widgets";

export const metadata: Metadata = { title: "People" };
export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; add?: string }>;
}) {
  const viewer = await requireViewer();
  const admin = isAdmin(viewer);
  const { add } = await searchParams;

  const [people, departments] = await Promise.all([
    db.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        nickname: true,
        username: true,
        email: true,
        roleTitle: true,
        tier: true,
        avatarUrl: true,
        isActive: true,
        passwordHash: true,
        lastLoginAt: true,
        department: { select: { name: true, color: true, slug: true, sortOrder: true } },
      },
      orderBy: [{ tier: "desc" }, { name: "asc" }],
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);

  // Only what the viewer may see goes to the browser; the hash never leaves.
  const rows: PersonRow[] = people.map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    username: admin ? p.username : null,
    email: admin ? p.email : null,
    roleTitle: p.roleTitle,
    tier: p.tier,
    avatarUrl: p.avatarUrl,
    isActive: p.isActive,
    hasPassword: admin ? Boolean(p.passwordHash) : null,
    lastLoginAt: admin && p.lastLoginAt ? p.lastLoginAt.toISOString() : null,
    department: p.department,
  }));

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="People"
        title="People"
        action={
          admin ? (
            <AddPersonButton departments={departments} viewerTier={viewer.tier} startOpen={add === "1"} />
          ) : null
        }
      />

      <PeopleTable people={rows} isAdmin={admin} />
    </div>
  );
}
