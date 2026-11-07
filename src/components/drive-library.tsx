"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

export type LibraryItem = {
  id: string;
  title: string;
  preview: string;
  kind: string;
  ownerId: string;
  ownerName: string;
  updatedAt: string;
  createdAt: string;
  openedAt: string | null;
  sharing: string;
};

function dateLabel(date: string | null) {
  return date
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Bangkok",
      }).format(new Date(date))
    : "Not opened yet";
}

export function DriveLibrary({
  items,
  viewerId,
  initialFilter = "all",
  initialQuery = "",
}: {
  items: LibraryItem[];
  viewerId: string;
  initialFilter?: string;
  initialQuery?: string;
}) {
  const [layout, setLayout] = useState("grid");
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState("opened");
  useEffect(() => {
    const stored = localStorage.getItem("portal-documents-layout");
    if (stored === "grid" || stored === "list") setLayout(stored);
  }, []);
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (filter === "all" ||
              (filter === "mine"
                ? item.ownerId === viewerId
                : item.ownerId !== viewerId)) &&
            `${item.title} ${item.ownerName}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .sort((a, b) => {
          if (sort === "name") return a.title.localeCompare(b.title);
          if (sort === "owner")
            return (
              a.ownerName.localeCompare(b.ownerName) ||
              a.title.localeCompare(b.title)
            );
          if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
          if (sort === "modified")
            return b.updatedAt.localeCompare(a.updatedAt);
          return (
            (b.openedAt ?? "").localeCompare(a.openedAt ?? "") ||
            b.updatedAt.localeCompare(a.updatedAt)
          );
        }),
    [items, viewerId, filter, query, sort],
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <div className="flex flex-wrap gap-1" aria-label="Document ownership">
          {[
            ["all", "All"],
            ["mine", "Owned by me"],
            ["shared", "Shared with me"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={`hs-btn ${filter === value ? "hs-btn-primary" : "hs-btn-secondary"}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div
          className="flex gap-1 rounded-lg border border-line p-1"
          role="group"
          aria-label="Document layout"
        >
          {[
            ["grid", "▦ Grid"],
            ["list", "☰ List"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={layout === value}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold ${layout === value ? "bg-tint text-brand-deep" : "text-muted"}`}
              onClick={() => {
                setLayout(value);
                localStorage.setItem("portal-documents-layout", value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-52 flex-1 text-sm font-semibold">
          Search documents
          <input
            type="search"
            className="hs-input mt-1"
            placeholder="Search by title or creator"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold">
          Sort by
          <select
            className="hs-input mt-1"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="opened">Last opened by me</option>
            <option value="modified">Last modified</option>
            <option value="created">Date created</option>
            <option value="name">Document name</option>
            <option value="owner">Creator</option>
          </select>
        </label>
      </div>
      <p role="status" className="text-sm text-muted">
        {visible.length} {visible.length === 1 ? "item" : "items"}
      </p>
      {!visible.length ? (
        <div className="hs-card p-8 text-center text-muted">
          {items.length
            ? "No documents match these filters."
            : "Create your first document. It stays private until you share it."}
        </div>
      ) : layout === "grid" ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((item) => (
            <Link
              key={item.id}
              href={`/drive/${item.id}`}
              className="group overflow-hidden rounded-xl border border-line bg-surface transition-colors hover:border-brand"
            >
              <div
                className="h-64 overflow-hidden border-b border-line bg-surface-2 p-5"
                aria-hidden="true"
              >
                <div className="min-h-full rounded-sm border border-line bg-surface p-5 shadow-sm">
                  <div className="mb-3 text-sm font-bold text-ink">
                    {item.title}
                  </div>
                  <div
                    className="hs-document-thumbnail"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdown(
                        item.preview ||
                          (item.kind === "folder"
                            ? "Files and attachments"
                            : "Your blank document"),
                      )
                        .replace(/<a\b[^>]*>/g, "<span>")
                        .replace(/<\/a>/g, "</span>"),
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1 p-4">
                <h2 className="truncate text-sm font-semibold text-ink group-hover:text-brand-deep">
                  {item.kind === "folder" ? "▣ " : "▤ "}
                  {item.title}
                </h2>
                <p className="truncate text-xs text-muted">
                  Created by{" "}
                  {item.ownerId === viewerId ? "you" : item.ownerName}
                </p>
                <p className="text-xs text-muted">
                  {item.openedAt
                    ? `Opened ${dateLabel(item.openedAt)}`
                    : "Not opened yet"}
                </p>
                <p className="truncate text-xs text-muted">{item.sharing}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[660px] text-left text-sm">
            <thead className="bg-surface-2 text-muted">
              <tr>
                {[
                  ["name", "Name"],
                  ["owner", "Created by"],
                  ["opened", "Last opened by me"],
                  ["modified", "Modified"],
                ].map(([value, label]) => (
                  <th
                    key={value}
                    className="px-4 py-3"
                    aria-sort={
                      sort === value
                        ? value === "name" || value === "owner"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button type="button" onClick={() => setSort(value)}>
                      {label}
                      {sort === value
                        ? value === "name" || value === "owner"
                          ? " ↑"
                          : " ↓"
                        : ""}
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3">Sharing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {visible.map((item) => (
                <tr key={item.id} className="hover:bg-tint/40">
                  <td className="px-4 py-4">
                    <Link
                      href={`/drive/${item.id}`}
                      className="font-semibold text-brand-deep hover:underline"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    {item.ownerId === viewerId ? "You" : item.ownerName}
                  </td>
                  <td className="px-4 py-4">{dateLabel(item.openedAt)}</td>
                  <td className="px-4 py-4">{dateLabel(item.updatedAt)}</td>
                  <td className="px-4 py-4">{item.sharing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
