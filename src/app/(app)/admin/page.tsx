import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireTier, isOwner } from "@/lib/authorize";
import {
  revokeAllSessionsFor,
  revokeInvite,
  unlockUser,
} from "@/lib/actions/admin";
import {
  CopyLink,
  DepartmentSelect,
  FlagToggle,
  InviteForm,
  RoleSelect,
  TierSelect,
} from "@/components/admin-widgets";
import { setEventPanelVisible } from "@/lib/actions/brand";
import { TEAMS, TIER_LABEL } from "@/lib/constants";
import { SETTING_KEYS, getSettings } from "@/lib/settings";
import { joinLinkStatus } from "@/lib/join-links";
import { Avatar, Banner, Card, EmptyState, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { formatDateLong, timeAgo } from "@/lib/dates";

export const metadata: Metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const viewer = await requireTier("T3_ADMIN");
  const owner = isOwner(viewer);

  const [users, invites, departments, sessionCount, deletedCounts, settings, joinLinks] = await Promise.all([
    db.user.findMany({
      where: { deletedAt: null },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { sessions: { where: { revokedAt: null } } } },
      },
      orderBy: [{ tier: "desc" }, { name: "asc" }],
    }),
    db.invite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: {
        department: { select: { name: true } },
        invitedBy: { select: { name: true, nickname: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.department.findMany({ orderBy: { sortOrder: "asc" } }),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    Promise.all([
      db.assignment.count({ where: { deletedAt: { not: null } } }),
      db.document.count({ where: { deletedAt: { not: null } } }),
      db.fileAsset.count({ where: { deletedAt: { not: null } } }),
    ]),
    getSettings([SETTING_KEYS.eventPanel]),
    db.inviteLink.findMany({
      where: { revokedAt: null },
      select: { revokedAt: true, expiresAt: true, maxUses: true, useCount: true },
    }),
  ]);

  const eventVisible = settings[SETTING_KEYS.eventPanel] === "1";

  const lockedOut = users.filter((u) => u.lockedUntil && u.lockedUntil.getTime() > Date.now());
  const recycleBin = deletedCounts.reduce((a, b) => a + b, 0);
  const liveJoinLinks = joinLinks.filter((link) => joinLinkStatus(link) === "ok");

  return (
    <div className="hs-enter space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Accounts, invites & access"
        action={
          <>
            <Link href="/admin/audit" className="hs-btn hs-btn-secondary">
              Audit log
            </Link>
            <Link href="/admin/access" className="hs-btn hs-btn-secondary">
              Page access
            </Link>
            {owner ? (
              <Link href="/people/import" className="hs-btn hs-btn-primary">
                <span aria-hidden="true">＋</span> Import people
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Active staff" value={users.filter((u) => u.isActive).length} />
        <Stat label="Pending invites" value={invites.length} />
        <Stat label="Live join links" value={liveJoinLinks.length} />
        <Stat label="Live sessions" value={sessionCount} />
        <Stat label="Recycle bin" value={recycleBin} tone={recycleBin > 0 ? "warn" : "default"} />
      </div>

      {lockedOut.length > 0 ? (
        <Banner tone="warn">
          {lockedOut.length} account{lockedOut.length > 1 ? "s are" : " is"} locked after failed
          sign-ins. Unlock below — a lockout clears itself after 15 minutes.
        </Banner>
      ) : null}

      <Card>
        <SectionTitle>Add somebody to the portal</SectionTitle>
        <p className="mb-4 -mt-2 text-sm text-muted">
          A name and an email is enough. Their team, role and tier can wait until the
          chart settles — set them from the user list below whenever you like. The portal
          sends no email by design, so copy the link it gives you and send it on LINE.
        </p>
        <InviteForm
          departments={departments.map((d) => ({ id: d.id, name: d.name, slug: d.slug }))}
          canCreateOwner={owner}
        />

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-tint/50 p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">Adding a whole room at once?</p>
            <p className="text-xs text-muted">
              One link and one QR code the team scans, instead of an invite each. Live links,
              their remaining uses, and the printable poster all live there.
            </p>
          </div>
          <Link href="/admin/invite" className="hs-btn hs-btn-secondary shrink-0">
            Join links &amp; QR codes
          </Link>
        </div>
      </Card>

      <Card>
        <SectionTitle>Pending invites</SectionTitle>
        {invites.length === 0 ? (
          <EmptyState title="No invites waiting" />
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{inv.email}</p>
                  <p className="text-xs text-faint">
                    {inv.department?.name ?? "No department"} ·{" "}
                    {inv.invitedBy.nickname || inv.invitedBy.name} · expires{" "}
                    {formatDateLong(inv.expiresAt)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <CopyLink path={`/invite/${inv.code}`} label="Copy invite link" />
                  <form
                    action={async () => {
                      "use server";
                      await revokeInvite(inv.id);
                    }}
                  >
                    <button type="submit" className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs">
                      Revoke
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>Portal panels</SectionTitle>
        <p className="mb-4 -mt-2 text-sm text-muted">
          Turn a section off while it is empty. Hiding a panel takes it out of everybody&rsquo;s
          navigation — it is a tidiness switch, not a permission: the pages behind it still check
          who is asking, and admins keep the link so there is a way back here.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">Event Day</p>
            <p className="text-xs text-muted">
              Run sheet, check-in and the incident log. Worth hiding until the week of the event.
            </p>
          </div>
          <form
            action={async () => {
              "use server";
              await setEventPanelVisible(!eventVisible);
            }}
          >
            <button
              type="submit"
              className={`hs-btn px-3 py-1.5 text-xs ${eventVisible ? "hs-btn-ghost" : "hs-btn-primary"}`}
            >
              {eventVisible ? "Hide the panel" : "Show the panel"}
            </button>
          </form>
        </div>
      </Card>

      <Card>
        <SectionTitle>The staff chart</SectionTitle>
        <p className="mb-4 -mt-2 text-sm text-muted">
          Every team, the seats it plans for, and who is in them. A team over its
          planned size is fine — the number is the plan, not a limit.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEAMS.filter((team) => team.slots > 0).map((team) => {
            const members = users.filter((u) => u.department?.name === team.name && u.isActive);
            const lead = members.find((u) => u.tier === "T2_HEAD" || u.tier === "T4_OWNER");
            const short = team.slots - members.length;

            return (
              <div key={team.slug} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-ink">
                    <span
                      aria-hidden="true"
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ background: team.color }}
                    />
                    {team.name}
                  </p>
                  <span
                    className={`hs-pill shrink-0 ${
                      short > 0 ? "bg-warn-soft text-warn-strong" : "bg-ok-soft text-ok-strong"
                    }`}
                  >
                    {members.length}/{team.slots}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {lead ? `Led by ${lead.nickname || lead.name}` : "No lead yet"}
                  {short > 0 ? ` · ${short} seat${short > 1 ? "s" : ""} open` : ""}
                </p>
                <p className="mt-1.5 text-[11px] text-faint">
                  {team.roles.map((role) => `${role.title} (${TIER_LABEL[role.tier]})`).join(" · ")}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle>Users</SectionTitle>
        <div className="space-y-2">
          {users.map((u) => {
            const locked = u.lockedUntil && u.lockedUntil.getTime() > Date.now();
            return (
              <div key={u.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={u.name} nickname={u.nickname} url={u.avatarUrl} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/people/${u.id}`}
                      className="block truncate text-sm font-bold text-ink hover:text-brand-deep"
                    >
                      {u.nickname || u.name}
                      {u.id === viewer.id ? (
                        <span className="ml-1.5 text-[11px] font-normal text-faint">(you)</span>
                      ) : null}
                    </Link>
                    <p className="truncate text-xs text-faint">
                      {u.email} · {u._count.sessions} device
                      {u._count.sessions === 1 ? "" : "s"} ·{" "}
                      {u.lastLoginAt ? `last in ${timeAgo(u.lastLoginAt)}` : "never signed in"}
                      {!u.passwordHash ? " · no password set" : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <DepartmentSelect
                      userId={u.id}
                      current={u.departmentId}
                      departments={departments.map((d) => ({ id: d.id, name: d.name }))}
                    />
                    <RoleSelect userId={u.id} current={u.roleTitle} />
                    <TierSelect
                      userId={u.id}
                      current={u.tier}
                      disabled={u.id === viewer.id}
                      canSetOwner={owner}
                    />
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-4 border-t border-line pt-2.5">
                  <FlagToggle userId={u.id} flag="isActive" value={u.isActive} label="Active" />
                  <FlagToggle userId={u.id} flag="isReserve" value={u.isReserve} label="Reserve" />
                  <FlagToggle userId={u.id} flag="isMentor" value={u.isMentor} label="Mentor" />
                  <FlagToggle userId={u.id} flag="isAlumni" value={u.isAlumni} label="Alumni" />

                  <span className="ml-auto flex flex-wrap gap-2">
                    {locked ? (
                      <form
                        action={async () => {
                          "use server";
                          await unlockUser(u.id);
                        }}
                      >
                        <button type="submit" className="hs-btn hs-btn-danger px-3 py-1.5 text-xs">
                          Unlock account
                        </button>
                      </form>
                    ) : null}

                    {owner ? (
                      <>
                        {u._count.sessions > 0 ? (
                          <form
                            action={async () => {
                              "use server";
                              await revokeAllSessionsFor(u.id);
                            }}
                          >
                            <button
                              type="submit"
                              className="hs-btn hs-btn-ghost px-3 py-1.5 text-xs"
                            >
                              Sign out all devices
                            </button>
                          </form>
                        ) : null}
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {owner ? (
        <Card>
          <SectionTitle>Data</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <a href="/api/export" className="hs-btn hs-btn-primary">
              Export everything (JSON)
            </a>
            <Link href="/admin/audit" className="hs-btn hs-btn-secondary">
              Audit log
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
