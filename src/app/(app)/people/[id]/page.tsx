import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { requireViewer, isAdmin, isOwner } from "@/lib/authorize";
import { DepartmentSelect, RoleSelect, TierSelect } from "@/components/admin-widgets";
import { Avatar, DocStatusPill, EmptyState, PriorityPill, StatusPill, TierPill } from "@/components/ui";
import { formatDate, formatDateLong, isOverdue, relativeDue } from "@/lib/dates";
import { decryptField } from "@/lib/crypto";
import { swatchStyle } from "@/lib/color";
import { STATUS_LABEL, STATUS_ORDER, TIER_ORDER } from "@/lib/constants";
import { Attachments } from "@/components/attachments";
import { listAttachments } from "@/lib/attachment-access";
import { MAX_UPLOAD_BYTES } from "@/lib/attachments";
import { can } from "@/lib/policy";
import { ProfileMenu, type ProfileSetting } from "./profile-menu";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

/** A rounded section card with a title row, LinkedIn style. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="hs-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-line-soft px-5 py-3.5">
        <h2 className="text-base font-bold text-ink">{title}</h2>
        {count !== undefined ? (
          <span className="rounded-full bg-tint px-2.5 py-0.5 text-xs font-bold text-brand-deep">{count}</span>
        ) : null}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Fact({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`text-right text-sm font-semibold ${muted ? "text-faint" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer();
  const { id } = await params;

  // Columns, not `include: everything`, so `passwordHash` can never end up in
  // the page payload by accident.
  const person = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      nickname: true,
      email: true,
      username: true,
      passwordHash: true,
      grade: true,
      phone: true,
      lineId: true,
      shirtSize: true,
      roleTitle: true,
      departmentId: true,
      avatarUrl: true,
      tier: true,
      isReserve: true,
      isMentor: true,
      isAlumni: true,
      isActive: true,
      deletedAt: true,
      createdAt: true,
      lastLoginAt: true,
      department: { select: { name: true, color: true, slug: true } },
    },
  });

  if (!person || person.deletedAt) notFound();

  // Admins and the Owner manage accounts at or below their own tier. The
  // server actions enforce the same rules again.
  const canManage = isAdmin(viewer) && TIER_ORDER[person.tier] <= TIER_ORDER[viewer.tier];
  const owner = isOwner(viewer);

  const mayAttach = person.id === viewer.id || can(viewer, "update", { kind: "user", userId: person.id });

  const [assignments, documents, departments, files] = await Promise.all([
    db.assignment.findMany({
      where: { deletedAt: null, assignees: { some: { userId: person.id } } },
      include: { department: { select: { name: true, color: true, slug: true } } },
      orderBy: [{ dueDate: "asc" }],
      take: 50,
    }),
    db.document.findMany({
      where: { deletedAt: null, ownerId: person.id },
      orderBy: { updatedAt: "desc" },
      take: 12,
    }),
    canManage
      ? db.department.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    listAttachments("user", person.id),
  ]);

  const showContact = isAdmin(viewer) || viewer.id === person.id;
  const display = person.nickname || person.name;
  const done = assignments.filter((a) => a.status === "DONE" || a.status === "APPROVED").length;
  const overdue = assignments.filter((a) => isOverdue(a.dueDate, a.status)).length;
  const open = assignments.length - done;

  // Every change to this person lives behind the three-dots menu, and each
  // opens in the centred pop-up. Add new settings here.
  const settings: ProfileSetting[] = [];
  if (canManage) {
    settings.push({
      key: "department",
      label: "Change department",
      hint: person.department?.name ?? "No department",
      title: "Department",
      description: `Which team ${display} works in. Saves as soon as you pick.`,
      content: (
        <DepartmentSelect userId={person.id} current={person.departmentId} departments={departments} />
      ),
    });
  }
  if (canManage && owner) {
    settings.push({
      key: "role",
      label: "Change role and tier",
      hint: `${person.roleTitle ?? "No role"} · ${person.tier.replace("_", " ")}`,
      title: "Role and tier",
      description: "Picking a role from the staff chart also sets the tier it comes with. Saves as soon as you pick.",
      content: (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-faint">Role</span>
            <RoleSelect userId={person.id} current={person.roleTitle} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-faint">Tier</span>
            <TierSelect userId={person.id} current={person.tier} disabled={person.id === viewer.id} canSetOwner />
            {person.id === viewer.id ? (
              <span className="mt-1 block text-[11px] text-faint">You cannot change your own tier.</span>
            ) : null}
          </label>
        </div>
      ),
    });
  }
  const deptColor = person.department?.color ?? "#EC4899";

  return (
    <div className="hs-enter mx-auto w-full max-w-[1100px] space-y-5">
      <Link href="/people" className="inline-block text-sm font-semibold text-brand-deep">
        ← Directory
      </Link>

      {/* Header card: cover banner, overlapping avatar, name and headline. */}
      <section className="hs-card overflow-hidden">
        <div
          className="relative h-28 sm:h-40"
          style={{
            background: `linear-gradient(120deg, ${deptColor} 0%, color-mix(in srgb, ${deptColor} 35%, var(--hs-surface)) 60%, var(--hs-surface) 100%)`,
          }}
        >
          <div className="absolute right-3 top-3">
            <ProfileMenu settings={settings} />
          </div>
        </div>

        <div className="px-5 pb-5 sm:px-7">
          <div className="relative z-10 -mt-12 sm:-mt-16">
            <div className="inline-block rounded-full p-1" style={{ background: "var(--hs-surface)" }}>
              <Avatar name={person.name} nickname={person.nickname} url={person.avatarUrl} size={120} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-ink sm:text-3xl">{display}</h1>
              <p className="mt-0.5 text-base text-ink/90">
                {person.roleTitle ?? "Staff"}
                {person.department ? ` · ${person.department.name}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted">
                {person.name}
                {person.grade ? ` · ${person.grade}` : ""}
                {isAdmin(viewer) && person.email ? ` · ${person.email}` : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <TierPill tier={person.tier} />
                {person.department ? (
                  <Link
                    href={`/departments/${person.department.slug}`}
                    className="hs-pill"
                    style={swatchStyle(person.department.color)}
                  >
                    {person.department.name}
                  </Link>
                ) : null}
                {person.isReserve ? <span className="hs-pill bg-warn-soft text-warn-strong">Reserve</span> : null}
                {person.isMentor ? <span className="hs-pill bg-teal-soft text-teal-strong">Mentor</span> : null}
                {person.isAlumni ? <span className="hs-pill bg-neutral-soft text-neutral-strong">Alumni</span> : null}
                {!person.isActive ? (
                  <span className="hs-pill bg-danger-soft text-danger-strong">Suspended</span>
                ) : null}
              </div>
            </div>

            {/* Quick stats, the "company / school" slot on LinkedIn. */}
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Open", value: open },
                { label: "Done", value: done },
                { label: "Overdue", value: overdue, danger: overdue > 0 },
              ].map((s) => (
                <div key={s.label} className="min-w-[72px] rounded-xl border border-line px-3 py-2">
                  <p className={`text-xl font-bold ${s.danger ? "text-danger-strong" : "text-ink"}`}>{s.value}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Two columns on desktop: work on the left, details on the right. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Section title="Assignments" count={assignments.length}>
            {assignments.length === 0 ? (
              <EmptyState title="Nothing assigned right now" />
            ) : (
              <div className="space-y-5">
                {STATUS_ORDER.map((status) => {
                  const group = assignments.filter((a) => a.status === status);
                  if (group.length === 0) return null;
                  return (
                    <div key={status}>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">
                        {STATUS_LABEL[status]} · {group.length}
                      </p>
                      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
                        {group.map((a) => {
                          const late = isOverdue(a.dueDate, a.status);
                          return (
                            <li key={a.id}>
                              <Link
                                href={`/assignments/${a.id}`}
                                className="flex items-center gap-3 px-3.5 py-3 transition hover:bg-tint/40"
                              >
                                <span
                                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                                  style={swatchStyle(a.department.color)}
                                  aria-hidden="true"
                                >
                                  {a.department.name.charAt(0)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-ink">{a.title}</span>
                                  <span className="block truncate text-xs text-muted">
                                    {a.department.name}
                                    {" · "}
                                    <span className={late ? "font-semibold text-danger-strong" : ""}>
                                      {a.dueDate ? `${formatDate(a.dueDate)} (${relativeDue(a.dueDate)})` : "No due date"}
                                    </span>
                                  </span>
                                </span>
                                <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                                  <PriorityPill priority={a.priority} />
                                  <StatusPill status={a.status} />
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title="Documents" count={documents.length}>
            {documents.length === 0 ? (
              <EmptyState title="No documents owned" />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/documents/${d.id}`}
                      className="flex h-full items-start gap-3 rounded-xl border border-line p-3.5 transition hover:border-brand"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-tint text-brand-deep"
                        aria-hidden="true"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{d.title}</span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <DocStatusPill status={d.status} />
                          <span>Updated {formatDate(d.updatedAt)}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <section className="hs-card p-5">
            <Attachments
              parentType="user"
              parentId={person.id}
              canWrite={mayAttach}
              attachments={files}
              viewerId={viewer.id}
              maxBytes={MAX_UPLOAD_BYTES}
              title="Reference files"
              hint="Click a file to preview it"
            />
          </section>
        </div>

        <aside className="space-y-5">
          <Section title="Details">
            <dl className="-my-2 divide-y divide-line-soft">
              <Fact label="Grade" value={person.grade ?? "—"} muted={!person.grade} />
              <Fact label="Shirt size" value={person.shirtSize ?? "—"} muted={!person.shirtSize} />
              <Fact label="Department" value={person.department?.name ?? "None"} muted={!person.department} />
              <Fact label="Role" value={person.roleTitle ?? "None"} muted={!person.roleTitle} />
            </dl>
          </Section>

          <Section title="Contact">
            {showContact ? (
              <dl className="-my-2 divide-y divide-line-soft">
                <Fact label="Phone" value={decryptField(person.phone) ?? "—"} muted={!person.phone} />
                <Fact label="LINE" value={decryptField(person.lineId) ?? "—"} muted={!person.lineId} />
                {person.email ? <Fact label="Email" value={<span className="break-all">{person.email}</span>} /> : null}
              </dl>
            ) : (
              <p className="text-sm text-faint">Visible to admins only.</p>
            )}
          </Section>

          {isAdmin(viewer) ? (
            <Section title="Account">
              <dl className="-my-2 divide-y divide-line-soft">
                {person.username ? <Fact label="Username" value={`@${person.username}`} /> : null}
                <Fact label="Joined" value={formatDateLong(person.createdAt)} />
                <Fact
                  label="Last sign-in"
                  value={person.lastLoginAt ? formatDateLong(person.lastLoginAt) : "Never"}
                  muted={!person.lastLoginAt}
                />
                <Fact label="Password" value={person.passwordHash ? "Set" : "Not set"} muted={!person.passwordHash} />
              </dl>
            </Section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
