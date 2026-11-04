import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, canSeePage } from "@/lib/authorize";
import { EVENT_START } from "@/lib/constants";
import { endOfWeek, timeAgo } from "@/lib/dates";
import { Countdown } from "@/components/countdown";
import { AssignmentRow, type AssignmentSummary } from "@/components/assignment-row";
import { Avatar, Banner, Card, EmptyState, SectionTitle, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const assignmentInclude = {
  department: { select: { name: true, color: true, slug: true } },
  assignees: {
    select: { user: { select: { id: true, name: true, nickname: true, avatarUrl: true } } },
  },
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const viewer = await requireViewer();
  const { denied } = await searchParams;
  const deptId = viewer.departmentId;

  const [myThisWeek, announcements] = await Promise.all([
    db.assignment.findMany({
      where: {
        deletedAt: null,
        assignees: { some: { userId: viewer.id } },
        status: { notIn: ["DONE", "APPROVED"] },
        OR: [{ dueDate: { lte: endOfWeek() } }, { dueDate: null }],
      },
      include: assignmentInclude,
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      take: 8,
    }),
    db.announcement.findMany({
      where: {
        deletedAt: null,
        OR: [{ scope: "all" }, { departmentId: deptId ?? "__none__" }],
      },
      include: { author: { select: { name: true, nickname: true, avatarUrl: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 4,
    }),
  ]);

  const greeting = viewer.nickname || viewer.name.split(" ")[0];

  const links = [
    viewer.department && canSeePage(viewer, "departments")
      ? { href: `/departments/${viewer.department.slug}`, label: `My team · ${viewer.department.name}` }
      : null,
    canSeePage(viewer, "documents") ? { href: "/documents", label: "Documents" } : null,
    canSeePage(viewer, "files") ? { href: "/files", label: "Files & Assets" } : null,
    canSeePage(viewer, "brand") ? { href: "/brand", label: "Brand Kit" } : null,
    canSeePage(viewer, "forms") ? { href: "/forms", label: "Forms" } : null,
    canSeePage(viewer, "people") ? { href: "/people", label: "Find people" } : null,
    canSeePage(viewer, "help") ? { href: "/help", label: "Help" } : null,
  ].filter((l): l is { href: string; label: string } => l !== null);

  return (
    <div className="space-y-5">
      {denied ? (
        <Banner tone="warn">
          {denied === "page"
            ? "That page is switched off for your tier. An owner can turn it back on from Admin → Page access."
            : "That area needs a higher permission tier than your account has."}
        </Banner>
      ) : null}

      <PageHeader eyebrow="Your workspace" title={`Hi, ${greeting}`} />

      <Card className="p-5 sm:p-6">
        <SectionTitle
          action={
            <Link href="/announcements" className="text-sm font-semibold text-brand-deep">
              All announcements
            </Link>
          }
        >
          Announcements
        </SectionTitle>

        {announcements.length === 0 ? (
          <EmptyState title="No announcements yet" />
        ) : (
          <ul className="divide-y divide-line-soft">
            {announcements.map((n) => (
              <li key={n.id} className="py-3.5 first:pt-0 last:pb-0">
                <Link href={`/announcements/${n.id}`} className="block">
                  <p className="flex items-center gap-2 text-xl font-extrabold leading-snug text-ink sm:text-2xl">
                    {n.pinned ? <span aria-label="Pinned">📌</span> : null}
                    {n.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{n.body}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                    <Avatar
                      name={n.author.name}
                      nickname={n.author.nickname}
                      url={n.author.avatarUrl}
                      size={16}
                    />
                    {n.author.nickname || n.author.name} · {timeAgo(n.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <details open className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="hs-h2">My assignments</span>
            <span className="flex items-center gap-3">
              {canSeePage(viewer, "assignments") ? (
                <Link href="/assignments?view=mine" className="text-sm font-semibold text-brand-deep">
                  See all
                </Link>
              ) : null}
              <span aria-hidden="true" className="text-faint transition group-open:rotate-180">
                ▾
              </span>
            </span>
          </summary>
          <div className="mt-3">
            {myThisWeek.length === 0 ? (
              <EmptyState title="Nothing due this week" />
            ) : (
              <div className="-mx-1 space-y-0.5">
                {myThisWeek.map((a) => (
                  <AssignmentRow key={a.id} a={a as AssignmentSummary} />
                ))}
              </div>
            )}
          </div>
        </details>
      </Card>

      <Countdown
        targetIso={EVENT_START.toISOString()}
        href={canSeePage(viewer, "event") ? "/event" : undefined}
      />

      {links.length > 0 ? (
        <nav aria-label="Quick links" className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hs-btn hs-btn-ghost">
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
