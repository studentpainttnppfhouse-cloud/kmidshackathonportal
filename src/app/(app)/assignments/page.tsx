import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireViewer, atLeast, isAdmin } from "@/lib/authorize";
import { auditDenied } from "@/lib/audit";
import { PageHeader } from "@/components/ui";
import { AssignmentFilters } from "@/components/assignment-filters";
import { BoardView, ListView } from "./views";
import { loadTasks } from "./query";
import { TimingView } from "./timing-view";

export const metadata: Metadata = { title: "Assignments board" };
export const dynamic = "force-dynamic";

type View = "board" | "list" | "timing";

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; dept?: string; status?: string; month?: string }>;
}) {
  const viewer = await requireViewer();
  const sp = await searchParams;

  // Old links into the combined page land on the pages that replaced them.
  if (sp.view === "mine") redirect("/my-tasks");
  if (sp.view === "calendar") redirect(sp.month ? `/calendar?month=${encodeURIComponent(sp.month)}` : "/calendar");

  // The whole-team board is for heads, admins and the owner.
  if (!atLeast(viewer, "T2_HEAD")) {
    await auditDenied(viewer.id, "board.view", "Board is limited to department heads, admins and the owner", {
      type: "page",
      detail: `${viewer.name} tried to open the task board`,
    });
    redirect("/my-tasks");
  }

  // Owner and Admins oversee every team, so they get the by-timing view and
  // the full list with no row cap.
  const seesAll = isAdmin(viewer);
  const view: View =
    sp.view === "list" ? "list" : sp.view === "timing" && seesAll ? "timing" : "board";
  const { tasks, departments, creatable } = await loadTasks(viewer, {
    dept: sp.dept,
    status: sp.status,
    all: seesAll,
  });

  const tab = (v: View, label: string) => {
    const params = new URLSearchParams();
    if (v !== "board") params.set("view", v);
    if (sp.dept) params.set("dept", sp.dept);
    if (sp.status) params.set("status", sp.status);
    const qs = params.toString();
    return (
      <Link
        key={v}
        href={qs ? `/assignments?${qs}` : "/assignments"}
        aria-current={view === v ? "page" : undefined}
        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
          view === v ? "bg-brand-solid text-on-brand" : "text-muted hover:text-brand-deep"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="hs-enter space-y-4">
      <PageHeader
        eyebrow="Tasks"
        title="Assignments board"
        action={
          creatable.length > 0 ? (
            <Link
              href={sp.dept ? `/assignments/new?dept=${encodeURIComponent(sp.dept)}` : "/assignments/new"}
              className="hs-btn hs-btn-primary"
            >
              <span aria-hidden="true">＋</span> New task
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <AssignmentFilters
          departments={departments}
          dept={sp.dept}
          status={sp.status}
          keep={{ view: view === "board" ? undefined : view }}
        />
        <div className="flex gap-1 rounded-full border border-line bg-surface p-0.5" aria-label="View">
          {tab("board", "Board")}
          {tab("list", "List")}
          {seesAll ? tab("timing", "By timing") : null}
        </div>
      </div>

      {view === "board" ? (
        <BoardView items={tasks} />
      ) : view === "timing" ? (
        <TimingView items={tasks} />
      ) : (
        <ListView items={tasks} />
      )}
    </div>
  );
}
