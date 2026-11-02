import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireViewer, isAdmin, isOwner } from "@/lib/authorize";
import {
  DepartmentSelect,
  RoleSelect,
  TierSelect,
} from "@/components/admin-widgets";
import {
  AssignmentRow,
  type AssignmentSummary,
} from "@/components/assignment-row";
import {
  Avatar,
  Card,
  DocStatusPill,
  EmptyState,
  SectionTitle,
  TierPill,
} from "@/components/ui";
import { formatDateLong } from "@/lib/dates";
import { decryptField } from "@/lib/crypto";
import { swatchStyle } from "@/lib/color";
import { TIER_ORDER } from "@/lib/constants";
import { ResetLinkPanel } from "../people-widgets";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireViewer();
  const { id } = await params;

  // Columns, not `include: everything`. A server component that selects the
  // whole row is one accidental prop away from serialising `passwordHash` into
  // the page payload; naming the fields makes that impossible rather than
  // unlikely.
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

  // Admins and the Owner manage department, role and tier right here. Nobody
  // edits an account above their own tier; the actions enforce it as well.
  const canManage =
    isAdmin(viewer) && TIER_ORDER[person.tier] <= TIER_ORDER[viewer.tier];

  const [assignments, documents, departments] = await Promise.all([
    db.assignment.findMany({
      where: { deletedAt: null, assignees: { some: { userId: person.id } } },
      include: {
        department: { select: { name: true, color: true, slug: true } },
        assignees: {
          select: {
            user: {
              select: { id: true, name: true, nickname: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      take: 25,
    }),
    db.document.findMany({
      where: { deletedAt: null, ownerId: person.id },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    canManage
      ? db.department.findMany({
          orderBy: { sortOrder: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  // Contact details are staff-facing, but only the person themselves and
  // admins see the phone number and LINE ID.
  const showContact = isAdmin(viewer) || viewer.id === person.id;

  return (
    <div className="space-y-5">
      <Link href="/people" className="text-sm font-semibold text-brand-deep">
        ← Directory
      </Link>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar
            name={person.name}
            nickname={person.nickname}
            url={person.avatarUrl}
            size={72}
          />
          <div className="min-w-0">
            <h1 className="hs-h1">{person.nickname || person.name}</h1>
            <p className="text-sm text-muted">
              {person.name}
              {person.roleTitle ? ` · ${person.roleTitle}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
              {person.isReserve ? (
                <span className="hs-pill bg-warn-soft text-warn-strong">
                  Reserve
                </span>
              ) : null}
              {person.isMentor ? (
                <span className="hs-pill bg-teal-soft text-teal-strong">
                  Mentor
                </span>
              ) : null}
              {person.isAlumni ? (
                <span className="hs-pill bg-neutral-soft text-neutral-strong">
                  Alumni
                </span>
              ) : null}
              {!person.isActive ? (
                <span className="hs-pill bg-danger-soft text-danger-strong">
                  Suspended
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line-soft pt-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="hs-eyebrow">Grade</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {person.grade ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="hs-eyebrow">Shirt size</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {person.shirtSize ?? "—"}
            </dd>
          </div>
          {showContact ? (
            <>
              <div>
                <dt className="hs-eyebrow">Phone</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  {decryptField(person.phone) ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="hs-eyebrow">LINE</dt>
                <dd className="mt-0.5 font-semibold text-ink">
                  {decryptField(person.lineId) ?? "—"}
                </dd>
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <dt className="hs-eyebrow">Contact</dt>
              <dd className="mt-0.5 text-faint">Visible to admins only</dd>
            </div>
          )}
        </dl>

        {isAdmin(viewer) ? (
          <p className="mt-4 text-xs text-faint">
            {person.email}
            {person.username ? ` · @${person.username}` : ""} · joined{" "}
            {formatDateLong(person.createdAt)} · last signed in{" "}
            {person.lastLoginAt ? formatDateLong(person.lastLoginAt) : "never"}
          </p>
        ) : null}
      </Card>

      {canManage ? (
        <Card>
          <SectionTitle>Department and role</SectionTitle>
          <p className="-mt-2 mb-3 text-xs text-muted">
            Changes save as soon as you pick. Role and tier are Owner-only;
            picking a role from the chart also sets its tier.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="hs-eyebrow mb-1 block">Department</span>
              <DepartmentSelect
                userId={person.id}
                current={person.departmentId}
                departments={departments}
              />
            </label>
            {isOwner(viewer) ? (
              <>
                <label className="block">
                  <span className="hs-eyebrow mb-1 block">Role</span>
                  <RoleSelect userId={person.id} current={person.roleTitle} />
                </label>
                <label className="block">
                  <span className="hs-eyebrow mb-1 block">Tier</span>
                  <TierSelect
                    userId={person.id}
                    current={person.tier}
                    disabled={person.id === viewer.id}
                    canSetOwner
                  />
                </label>
              </>
            ) : null}
          </div>
        </Card>
      ) : null}

      {canManage ? (
        <Card>
          <SectionTitle>Password reset</SectionTitle>
          <p className="-mt-2 mb-3 text-xs text-muted">
            {person.passwordHash
              ? "Has a password."
              : "Has not set a password yet."}{" "}
            The link works once and you send it yourself.
          </p>
          <ResetLinkPanel
            userId={person.id}
            name={person.nickname || person.name}
          />
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Assignments</SectionTitle>
        {assignments.length === 0 ? (
          <EmptyState title="Nothing assigned right now" />
        ) : (
          <div className="-mx-1 space-y-0.5">
            {assignments.map((a) => (
              <AssignmentRow key={a.id} a={a as AssignmentSummary} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Documents</SectionTitle>
        {documents.length === 0 ? (
          <EmptyState title="No documents owned" />
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3"
              >
                <Link
                  href={`/documents/${d.id}`}
                  className="truncate text-sm font-semibold text-ink hover:text-brand-deep"
                >
                  {d.title}
                </Link>
                <DocStatusPill status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
