import "server-only";
import { driveItems } from "./workspace-access";
import { db } from "@/lib/db";
import { can, type Viewer } from "@/lib/policy";
import { excerpt } from "@/lib/markdown";

/**
 * One search box across the whole portal.
 *
 * Every query is filtered through `can()` before anything is returned, for the
 * reason that makes search a classic authorisation hole: a page shows what it
 * chooses to load, but a search box invites the user to name what they want and
 * then goes looking for it. An announcement scoped to another department must
 * not surface here just because somebody typed a word from its title.
 *
 * TiDB is MySQL, so this is `LIKE` matching rather than a full-text index. On a
 * portal with a few hundred rows that is the right amount of machinery; when it
 * stops being, the fix is a FULLTEXT index on the same columns, not a service.
 */

export type SearchHit = {
  kind: "assignment" | "document" | "file" | "person" | "announcement" | "form" | "department";
  id: string;
  href: string;
  title: string;
  context: string;
  meta: string;
};

const PER_KIND = 6;

export async function searchPortal(viewer: Viewer, rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];

  const contains = { contains: query };

  const [assignments, documents, files, people, announcements, forms, departments] =
    await Promise.all([
      db.assignment.findMany({
        where: {
          deletedAt: null,
          OR: [{ title: contains }, { description: contains }],
        },
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          departmentId: true,
          createdById: true,
          department: { select: { name: true } },
          assignees: { select: { userId: true } },
        },
        take: PER_KIND * 2,
        orderBy: { updatedAt: "desc" },
      }),
      db.document.findMany({
        where: {
          deletedAt: null,
          OR: [{ title: contains }, { description: contains }, { body: contains }],
        },
        select: {
          id: true,
          title: true,
          description: true,
          body: true,
          source: true,
          departmentId: true,
          ownerId: true,
          department: { select: { name: true } },
        },
        take: PER_KIND * 2,
        orderBy: { updatedAt: "desc" },
      }),
      db.fileAsset.findMany({
        where: { deletedAt: null, OR: [{ name: contains }, { description: contains }] },
        select: {
          id: true,
          name: true,
          description: true,
          kind: true,
          departmentId: true,
          uploadedById: true,
          department: { select: { name: true } },
        },
        take: PER_KIND * 2,
        orderBy: { createdAt: "desc" },
      }),
      db.user.findMany({
        where: {
          deletedAt: null,
          OR: [{ name: contains }, { nickname: contains }, { roleTitle: contains }],
        },
        select: {
          id: true,
          name: true,
          nickname: true,
          roleTitle: true,
          tier: true,
          department: { select: { name: true } },
        },
        take: PER_KIND * 2,
        orderBy: { name: "asc" },
      }),
      db.announcement.findMany({
        where: { deletedAt: null, OR: [{ title: contains }, { body: contains }] },
        select: {
          id: true,
          title: true,
          body: true,
          departmentId: true,
          authorId: true,
          department: { select: { name: true } },
        },
        take: PER_KIND * 2,
        orderBy: { createdAt: "desc" },
      }),
      db.form.findMany({
        where: { deletedAt: null, OR: [{ title: contains }, { description: contains }] },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          departmentId: true,
          ownerId: true,
          department: { select: { name: true } },
        },
        take: PER_KIND,
        orderBy: { updatedAt: "desc" },
      }),
      db.department.findMany({
        where: { OR: [{ name: contains }, { description: contains }] },
        select: { id: true, name: true, slug: true, description: true },
        take: PER_KIND,
      }),
    ]);

  const hits: SearchHit[] = [];

  for (const a of assignments) {
    if (
      !can(viewer, "read", {
        kind: "assignment",
        departmentId: a.departmentId,
        createdById: a.createdById,
        ownerIds: a.assignees.map((x) => x.userId),
      })
    ) {
      continue;
    }
    hits.push({
      kind: "assignment",
      id: a.id,
      href: `/assignments/${a.id}`,
      title: a.title,
      context: a.description?.slice(0, 160) ?? "",
      meta: `${a.department.name} · ${a.status.replace(/_/g, " ").toLowerCase()}`,
    });
  }

  for (const d of documents.filter(d=>d.source === "portal")) {
    if (!can(viewer, "read", { kind: "document", departmentId: d.departmentId, ownerId: d.ownerId })) {
      continue;
    }
    hits.push({
      kind: "document",
      id: d.id,
      href: `/documents/${d.id}`,
      title: d.title,
      context: d.description?.slice(0, 160) || (d.body ? excerpt(d.body, 160) : ""),
      meta: `${d.department.name} · ${d.source === "portal" ? "written here" : "linked"}`,
    });
  }

  for (const f of files) {
    if (
      !can(viewer, "read", { kind: "file", departmentId: f.departmentId, ownerId: f.uploadedById })
    ) {
      continue;
    }
    hits.push({
      kind: "file",
      id: f.id,
      href: `/files?q=${encodeURIComponent(f.name)}`,
      title: f.name,
      context: f.description?.slice(0, 160) ?? "",
      meta: `${f.department.name} · ${f.kind}`,
    });
  }

  for (const p of people) {
    if (!can(viewer, "read", { kind: "user", userId: p.id })) continue;
    hits.push({
      kind: "person",
      id: p.id,
      href: `/people/${p.id}`,
      title: p.nickname || p.name,
      context: p.roleTitle ?? "",
      meta: p.department?.name ?? "No department",
    });
  }

  for (const n of announcements) {
    if (
      !can(viewer, "read", {
        kind: "announcement",
        departmentId: n.departmentId,
        authorId: n.authorId,
      })
    ) {
      continue;
    }
    hits.push({
      kind: "announcement",
      id: n.id,
      href: "/announcements",
      title: n.title,
      context: n.body.slice(0, 160),
      meta: n.department?.name ?? "All staff",
    });
  }

  for (const f of forms) {
    if (!can(viewer, "read", { kind: "form", departmentId: f.departmentId, ownerId: f.ownerId })) {
      continue;
    }
    hits.push({
      kind: "form",
      id: f.id,
      href: f.type === "internal" ? `/forms/${f.id}` : "/forms",
      title: f.title,
      context: f.description?.slice(0, 160) ?? "",
      meta: `${f.department?.name ?? "Portal-wide"} · ${f.type}`,
    });
  }

  for (const d of departments) {
    if (!can(viewer, "read", { kind: "department", departmentId: d.id })) continue;
    hits.push({
      kind: "department",
      id: d.id,
      href: `/departments/${d.slug}`,
      title: d.name,
      context: d.description?.slice(0, 160) ?? "",
      meta: "Department",
    });
  }

  for (const d of (await driveItems(viewer, "all", query)).slice(0, PER_KIND)) {
    hits.push({kind:"document",id:d.id,href:`/drive/${d.id}`,title:d.title,context:d.body?excerpt(d.body,160):"",meta:"Portal drive"});
  }
  return hits;
}

export const KIND_LABEL: Record<SearchHit["kind"], string> = {
  assignment: "Task",
  document: "Document",
  file: "Asset",
  person: "Person",
  announcement: "Announcement",
  form: "Form",
  department: "Department",
};
