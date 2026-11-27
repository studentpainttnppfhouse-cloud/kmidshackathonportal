import type { ReactNode } from "react";
import { renderMarkdown } from "@/lib/markdown";
import type { CompetitionSettings } from "@/lib/competition/schema";

/** The white card every public competition page sits in. */
export function PublicShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="min-h-screen bg-brand-wash px-4 py-8 sm:py-12">
      <div className="hs-card mx-auto max-w-2xl p-5 sm:p-8">{children}</div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-faint">
        {footer}
        KMIDS Hackathon 2027
      </p>
    </main>
  );
}

export function Markdown({ source, className = "" }: { source: string; className?: string }) {
  return (
    <div
      className={`hs-prose hs-prose-compact ${className}`}
      // renderMarkdown escapes every character before it adds a tag.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source, { breaks: false }) }}
    />
  );
}

/** Rules, privacy notice, prompt and rubric, whichever the organizers have set. */
export function EventLinks({ settings }: { settings: CompetitionSettings }) {
  const links = [
    { href: settings.rulesUrl, label: "Rules & Information" },
    { href: settings.promptUrl, label: "Round 1 prompt" },
    { href: settings.rubricUrl, label: "Rubric" },
    { href: settings.privacyUrl, label: "Privacy notice" },
  ].filter((l) => l.href);
  if (links.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {links.map((l) => (
        <li key={l.label}>
          <a href={l.href} target="_blank" rel="noreferrer noopener" className="hs-btn hs-btn-secondary px-3 py-1.5 text-xs">
            {l.label} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

export function reviewerAccessText(settings: CompetitionSettings): string | null {
  if (settings.reviewerAccess === "anyone_with_link") {
    return 'Organizer access method: set the folder to "Anyone with the link: Viewer", then test it while signed out.';
  }
  if (settings.reviewerAccess === "reviewer_account" && settings.reviewerEmail) {
    return `Organizer access method: share Viewer access with ${settings.reviewerEmail}.`;
  }
  return null;
}
