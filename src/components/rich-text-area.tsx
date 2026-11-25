"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { renderMarkdown } from "@/lib/markdown";

/**
 * A textarea with a formatting bar and a preview.
 *
 * What is stored is still plain Markdown (see src/lib/markdown.ts), so the
 * field posts, drafts and exports exactly as a textarea always did, and the
 * renderer stays the one security control for what reaches the page. The bar
 * only types the markers for you: select some text, press B, and it becomes
 * `**text**`. Press it again and the markers come off.
 *
 * Edits go through `execCommand("insertText")` where the browser still has it,
 * because that is the only way to change a textarea and keep Ctrl+Z working.
 */

type Inline = { open: string; close: string; sample: string };

const INLINE = {
  bold: { open: "**", close: "**", sample: "bold text" },
  italic: { open: "*", close: "*", sample: "italic text" },
  underline: { open: "++", close: "++", sample: "underlined text" },
  strike: { open: "~~", close: "~~", sample: "struck text" },
  highlight: { open: "==", close: "==", sample: "highlighted text" },
  sup: { open: "^", close: "^", sample: "2" },
  sub: { open: "~", close: "~", sample: "2" },
  code: { open: "`", close: "`", sample: "code" },
} satisfies Record<string, Inline>;

type LineKind = "bullet" | "number" | "check" | "quote";

const LINE_PREFIX: Record<LineKind, RegExp> = {
  bullet: /^(\s*)[-*+•]\s+(?!\[[ xX]\]\s)/,
  number: /^(\s*)\d+[.)]\s+/,
  check: /^(\s*)[-*+•]\s+\[[ xX]\]\s+/,
  quote: /^(\s*)>\s?/,
};

/** Every prefix a line can carry, removed before another one is put on. */
const ANY_PREFIX = /^(\s*)(?:#{1,3}\s+|[-*+•]\s+\[[ xX]\]\s+|[-*+•]\s+|\d+[.)]\s+|>\s?)/;

function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string) {
  el.focus();
  el.setSelectionRange(start, end);
  let done = false;
  try {
    done = document.execCommand("insertText", false, text);
  } catch {
    done = false;
  }
  if (!done || el.value.slice(start, start + text.length) !== text) {
    el.setRangeText(text, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** The start and end offsets of every whole line the selection touches. */
function lineSpan(el: HTMLTextAreaElement) {
  const { value, selectionStart, selectionEnd } = el;
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const endBreak = value.indexOf("\n", Math.max(selectionEnd - (selectionEnd > selectionStart ? 1 : 0), selectionStart));
  const end = endBreak === -1 ? value.length : endBreak;
  return { start, end, lines: value.slice(start, end).split("\n") };
}

function toggleInline(el: HTMLTextAreaElement, { open, close, sample }: Inline) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  const selected = value.slice(s, e);

  // Already wrapped from the outside: **|text|**
  if (value.slice(s - open.length, s) === open && value.slice(e, e + close.length) === close) {
    // A lone "*" next to "**" is bold, not italic. Leave it alone.
    const doubled = open.length === 1 && (value[s - 2] === open || value[e + 1] === close);
    if (!doubled) {
      replaceRange(el, s - open.length, e + close.length, selected);
      el.setSelectionRange(s - open.length, e - open.length);
      return;
    }
  }

  // Wrapped from the inside: |**text**|
  if (selected.length > open.length + close.length && selected.startsWith(open) && selected.endsWith(close)) {
    const inner = selected.slice(open.length, selected.length - close.length);
    replaceRange(el, s, e, inner);
    el.setSelectionRange(s, s + inner.length);
    return;
  }

  // Markers only work around text that does not start or end with a space,
  // so " word " becomes " **word** " rather than "** word **".
  const text = selected || sample;
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  const core = text.trim() || sample;
  const out = `${text.slice(0, lead)}${open}${core}${close}${text.slice(text.length - trail)}`;
  replaceRange(el, s, e, out);
  const coreStart = s + lead + open.length;
  el.setSelectionRange(coreStart, coreStart + core.length);
}

function toggleLines(el: HTMLTextAreaElement, kind: LineKind) {
  const { start, end, lines } = lineSpan(el);
  const content = lines.filter((line) => line.trim().length > 0);
  const allHave = content.length > 0 && content.every((line) => LINE_PREFIX[kind].test(line));

  let n = 0;
  const next = lines.map((line) => {
    if (line.trim().length === 0) return line;
    if (allHave) return line.replace(LINE_PREFIX[kind], "$1");
    const bare = line.replace(ANY_PREFIX, "$1");
    n += 1;
    const prefix = kind === "bullet" ? "- " : kind === "number" ? `${n}. ` : kind === "check" ? "- [ ] " : "> ";
    return bare.replace(/^(\s*)/, `$1${prefix}`);
  });

  // An empty line still gets a marker, so a fresh list can be started.
  if (content.length === 0) {
    const prefix = kind === "bullet" ? "- " : kind === "number" ? "1. " : kind === "check" ? "- [ ] " : "> ";
    next[0] = prefix + next[0];
  }

  const text = next.join("\n");
  replaceRange(el, start, end, text);
  el.setSelectionRange(start + text.length, start + text.length);
}

function setBlockStyle(el: HTMLTextAreaElement, level: 0 | 1 | 2 | 3) {
  const { start, end, lines } = lineSpan(el);
  const next = lines.map((line) => {
    const bare = line.replace(/^#{1,3}\s+/, "");
    if (level === 0 || bare.trim().length === 0) return bare;
    return `${"#".repeat(level)} ${bare.replace(ANY_PREFIX, "$1").trimStart()}`;
  });
  const text = next.join("\n");
  replaceRange(el, start, end, text);
  el.setSelectionRange(start + text.length, start + text.length);
}

function currentLevel(el: HTMLTextAreaElement | null): "0" | "1" | "2" | "3" {
  if (!el) return "0";
  const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
  const match = /^(#{1,3})\s/.exec(el.value.slice(start));
  return match ? (String(match[1].length) as "1" | "2" | "3") : "0";
}

function insertBlock(el: HTMLTextAreaElement, block: string) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  const before = value.slice(0, s);
  const pad = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const text = `${pad}${block}\n`;
  replaceRange(el, s, e, text);
}

function insertLink(el: HTMLTextAreaElement) {
  const { value, selectionStart: s, selectionEnd: e } = el;
  const url = window.prompt("Link address (https://…)", "https://");
  if (!url || !/^https?:\/\/\S+$/i.test(url.trim())) {
    el.focus();
    return;
  }
  const label = value.slice(s, e).trim() || "link text";
  const text = `[${label}](${url.trim()})`;
  replaceRange(el, s, e, text);
  el.setSelectionRange(s + 1, s + 1 + label.length);
}

function clearFormatting(el: HTMLTextAreaElement) {
  const { start, end, lines } = lineSpan(el);
  const { selectionStart: s, selectionEnd: e } = el;
  const whole = s === e;
  const from = whole ? start : s;
  const to = whole ? end : e;
  const source = whole ? lines.join("\n") : el.value.slice(s, e);
  const text = source
    .split("\n")
    .map((line) => line.replace(ANY_PREFIX, "$1"))
    .join("\n")
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*|~~|\+\+|==|`/g, "")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/\^(\S(?:[^^]*?\S)?)\^/g, "$1")
    .replace(/(^|[^~])~(\S(?:[^~]*?\S)?)~/g, "$1$2");
  replaceRange(el, from, to, text);
  el.setSelectionRange(from, from + text.length);
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function RichTextArea({
  id,
  name,
  defaultValue = "",
  placeholder,
  rows = 8,
  maxLength,
  className = "hs-composer-notes",
  label,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState("");
  const [level, setLevel] = useState<"0" | "1" | "2" | "3">("0");
  const tabsId = useId();

  const run = (fn: (el: HTMLTextAreaElement) => void) => () => {
    const el = ref.current;
    if (!el || mode !== "write") return;
    fn(el);
    setLevel(currentLevel(el));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return;
    const key = event.key.toLowerCase();

    const action: (() => void) | null =
      key === "b" && !event.shiftKey ? () => toggleInline(el, INLINE.bold)
      : key === "i" && !event.shiftKey ? () => toggleInline(el, INLINE.italic)
      : key === "u" && !event.shiftKey ? () => toggleInline(el, INLINE.underline)
      : key === "x" && event.shiftKey ? () => toggleInline(el, INLINE.strike)
      : key === "k" && !event.shiftKey ? () => insertLink(el)
      : key === "." && !event.shiftKey ? () => toggleInline(el, INLINE.sup)
      : key === "," && !event.shiftKey ? () => toggleInline(el, INLINE.sub)
      : null;

    if (action) {
      event.preventDefault();
      action();
    }
  };

  // Enter inside a list continues the list; Enter on an empty item ends it.
  const onKeyDownList = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
    const el = event.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const start = el.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const line = el.value.slice(start, el.selectionStart);
    const match = /^(\s*)([-*+•]\s+\[[ xX]\]\s+|[-*+•]\s+|(\d+)([.)])\s+)(.*)$/.exec(line);
    if (!match) return;
    event.preventDefault();
    if (match[5].trim().length === 0) {
      replaceRange(el, start, el.selectionStart, "");
      return;
    }
    const marker = match[3]
      ? `${Number(match[3]) + 1}${match[4]} `
      : /\[[ xX]\]/.test(match[2])
        ? `${match[2].trim()[0]} [ ] `
        : match[2];
    replaceRange(el, el.selectionStart, el.selectionStart, `\n${match[1]}${marker}`);
  };

  const showPreview = () => {
    setPreview(ref.current?.value ?? "");
    setMode("preview");
  };
  const showWrite = () => {
    setMode("write");
    requestAnimationFrame(() => ref.current?.focus());
  };

  const writing = mode === "write";

  return (
    <div className="hs-rte">
      <div className="hs-rte-bar" role="toolbar" aria-label={`${label ?? "Text"} formatting`}>
        <select
          aria-label="Text style"
          className="hs-rte-select"
          value={level}
          disabled={!writing}
          onChange={(e) => {
            const next = e.target.value as "0" | "1" | "2" | "3";
            setLevel(next);
            const el = ref.current;
            if (el) setBlockStyle(el, Number(next) as 0 | 1 | 2 | 3);
          }}
        >
          <option value="0">Body text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>

        <span className="hs-rte-sep" aria-hidden="true" />

        <button type="button" className="hs-rte-btn" title="Bold (Ctrl+B)" aria-label="Bold" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.bold))}>
          <b>B</b>
        </button>
        <button type="button" className="hs-rte-btn" title="Italic (Ctrl+I)" aria-label="Italic" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.italic))}>
          <i style={{ fontFamily: "Georgia, serif" }}>I</i>
        </button>
        <button type="button" className="hs-rte-btn" title="Underline (Ctrl+U)" aria-label="Underline" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.underline))}>
          <u>U</u>
        </button>
        <button type="button" className="hs-rte-btn" title="Strikethrough (Ctrl+Shift+X)" aria-label="Strikethrough" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.strike))}>
          <s>S</s>
        </button>
        <button type="button" className="hs-rte-btn" title="Superscript (Ctrl+.)" aria-label="Superscript" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.sup))}>
          <span>x<sup style={{ fontSize: "0.65em" }}>2</sup></span>
        </button>
        <button type="button" className="hs-rte-btn" title="Subscript (Ctrl+,)" aria-label="Subscript" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.sub))}>
          <span>x<sub style={{ fontSize: "0.65em" }}>2</sub></span>
        </button>
        <button type="button" className="hs-rte-btn" title="Highlight" aria-label="Highlight" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.highlight))}>
          <Icon>
            <path d="M12.5 3.5l4 4-7 7H5.5v-4z" />
            <path d="M3 17h14" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Inline code" aria-label="Inline code" disabled={!writing} onClick={run((el) => toggleInline(el, INLINE.code))}>
          <Icon>
            <path d="M7 6l-4 4 4 4M13 6l4 4-4 4" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Link (Ctrl+K)" aria-label="Link" disabled={!writing} onClick={run(insertLink)}>
          <Icon>
            <path d="M8.5 11.5a3 3 0 004.2 0l2.6-2.6a3 3 0 00-4.2-4.2l-1 1" />
            <path d="M11.5 8.5a3 3 0 00-4.2 0l-2.6 2.6a3 3 0 004.2 4.2l1-1" />
          </Icon>
        </button>

        <span className="hs-rte-sep" aria-hidden="true" />

        <button type="button" className="hs-rte-btn" title="Bulleted list" aria-label="Bulleted list" disabled={!writing} onClick={run((el) => toggleLines(el, "bullet"))}>
          <Icon>
            <path d="M8 5.5h9M8 10h9M8 14.5h9" />
            <circle cx="4" cy="5.5" r="0.9" fill="currentColor" />
            <circle cx="4" cy="10" r="0.9" fill="currentColor" />
            <circle cx="4" cy="14.5" r="0.9" fill="currentColor" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Numbered list" aria-label="Numbered list" disabled={!writing} onClick={run((el) => toggleLines(el, "number"))}>
          <Icon>
            <path d="M8 5.5h9M8 10h9M8 14.5h9" />
            <path d="M3.5 4.5l1-.6v3.2M3 12.2c.3-.6 1.9-.7 1.9.3 0 .8-1.9 1.4-1.9 2.2h2" strokeWidth="1.2" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Checklist" aria-label="Checklist" disabled={!writing} onClick={run((el) => toggleLines(el, "check"))}>
          <Icon>
            <rect x="3" y="3.5" width="5" height="5" rx="1" />
            <path d="M3.8 13.8l1.4 1.4 2.6-2.8M11 6h6M11 14h6" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Quote" aria-label="Quote" disabled={!writing} onClick={run((el) => toggleLines(el, "quote"))}>
          <Icon>
            <path d="M4 5v10M8 6h9M8 10h9M8 14h6" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Divider" aria-label="Divider" disabled={!writing} onClick={run((el) => insertBlock(el, "---"))}>
          <Icon>
            <path d="M3 10h14" />
          </Icon>
        </button>
        <button type="button" className="hs-rte-btn" title="Clear formatting" aria-label="Clear formatting" disabled={!writing} onClick={run(clearFormatting)}>
          <Icon>
            <path d="M5 4.5h9M9.5 4.5L7 15.5M4 16l12-12" />
          </Icon>
        </button>

        <div className="hs-rte-tabs" role="tablist" aria-label="Editor view">
          <button type="button" role="tab" id={`${tabsId}-w`} aria-selected={writing} className="hs-rte-tab" onClick={showWrite}>
            Write
          </button>
          <button type="button" role="tab" id={`${tabsId}-p`} aria-selected={!writing} className="hs-rte-tab" onClick={showPreview}>
            Preview
          </button>
        </div>
      </div>

      {/* The textarea stays mounted while previewing so the form still posts it. */}
      <textarea
        ref={ref}
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={className}
        hidden={!writing}
        onKeyDown={onKeyDownList}
        onKeyUp={(e) => setLevel(currentLevel(e.currentTarget))}
        onClick={(e) => setLevel(currentLevel(e.currentTarget))}
      />

      {!writing ? (
        preview.trim() ? (
          <div
            className="hs-rte-preview hs-prose hs-prose-compact"
            // renderMarkdown escapes every character before it adds a tag.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(preview, { breaks: true }) }}
          />
        ) : (
          <p className="hs-rte-preview text-sm text-faint">Nothing to preview yet.</p>
        )
      ) : null}

      <p className="hs-rte-hint">
        Select text and use the bar, or type it:{" "}
        <code>**bold**</code> <code>*italic*</code> <code>++underline++</code> <code>~~strike~~</code>{" "}
        <code>^super^</code> <code>~sub~</code> <code># heading</code> <code>- list</code>
      </p>
    </div>
  );
}
