/**
 * A small Markdown renderer, written rather than installed.
 *
 * Documents written in the portal are stored as Markdown and shown as HTML.
 * That is an XSS sink by construction — the body is user input and the output
 * is markup — so the renderer is the security control, and the two rules that
 * make it one are:
 *
 *   1. Every character of the input is HTML-escaped *before* any Markdown
 *      syntax is interpreted. Nothing the author types can become a tag,
 *      because `<` stops being `<` in the first pass.
 *   2. Only this file's own fixed strings become tags. There is no raw-HTML
 *      passthrough, no `dangerouslySetInnerHTML` of author content, and links
 *      go through the same http/https allowlist as every other URL in the
 *      portal.
 *
 * The alternative was `marked` + `DOMPurify`: two dependencies, a sanitiser
 * that has to be configured correctly, and a much larger surface than the six
 * constructs a staff document actually uses. This supports headings, bold,
 * italic, underline (`++u++`), strikethrough (`~~s~~`), highlight (`==h==`),
 * superscript (`^sup^`), subscript (`~sub~`), inline code, links, bullet,
 * numbered and check lists, block quotes, fenced code, horizontal rules and
 * paragraphs — and nothing else, deliberately.
 */

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "rule" };

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type MarkdownOptions = {
  /**
   * Keep single line breaks inside a paragraph instead of folding them into
   * spaces. Task briefs are written line by line ("Headline: …", "Date: …"),
   * and folding those into one run-on paragraph loses the brief's shape.
   */
  breaks?: boolean;
};

/**
 * Splits a document body into blocks. Shared by the HTML renderer, the DOCX
 * writer and the PDF writer, so all three agree on what the document *is*
 * before they disagree about how to draw it.
 */
export function parseBlocks(source: string, options: MarkdownOptions = {}): Block[] {
  const joiner = options.breaks ? "\n" : " ";
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quote: string[] = [];
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(joiner).trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  };
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push({ type: "quote", text: quote.join(joiner).trim() });
      quote = [];
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code !== null) {
      if (line.trimEnd().startsWith("```")) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    if (line.trimEnd().startsWith("```")) {
      flushAll();
      code = [];
      continue;
    }

    if (line.trim().length === 0) {
      flushAll();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll();
      blocks.push({ type: "rule" });
      continue;
    }

    // "•" too: briefs pasted from slides and chat apps use the real bullet.
    const bullet = /^\s*[-*+•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      flushQuote();
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(bullet[1].trim());
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      flushQuote();
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(numbered[1].trim());
      continue;
    }

    const blockQuote = /^\s*>\s?(.*)$/.exec(line);
    if (blockQuote) {
      flushParagraph();
      flushList();
      quote.push(blockQuote[1].trim());
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }

  if (code !== null) blocks.push({ type: "code", text: code.join("\n") });
  flushAll();

  return blocks;
}

/** Inline spans, as plain text with the markers removed. Used by the exporters. */
export function stripInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(\S(?:[^~]*?\S)?)~~/g, "$1")
    .replace(/\+\+(\S(?:[^+]*?\S)?)\+\+/g, "$1")
    .replace(/==(\S(?:[^=]*?\S)?)==/g, "$1")
    .replace(/\^(\S(?:[^^]*?\S)?)\^/g, "$1")
    .replace(/(^|[^~])~(\S(?:[^~]*?\S)?)~(?!~)/g, "$1$2")
    .replace(/^\[[ xX]\]\s+/, "");
}

const SAFE_LINK = /^https?:\/\/[^\s"'<>]+$/i;

/**
 * Inline formatting, applied to text that has *already* been escaped.
 *
 * The ordering matters and is the whole point: `escapeHtml` runs first in
 * `renderMarkdown`, so by the time this function sees the string, an author's
 * `<script>` is already the harmless five characters `&lt;script&gt;`. Every
 * `<` this function introduces is one of its own literals.
 *
 * Links and code spans are finished first and parked behind placeholders, so
 * the span markers below never reach inside them: a `~` in a URL or a `^` in
 * a quoted command stays exactly as typed.
 *
 * The newer span markers (underline, strike, highlight, super/subscript) only
 * match when the text inside starts and ends with a non-space character. That
 * keeps ordinary writing ordinary: "~5 to ~10 people" and "C++ and C++" are
 * not formatting.
 */
function renderInline(escaped: string): string {
  const parked: string[] = [];
  const park = (html: string) => `\u0000${parked.push(html) - 1}\u0000`;

  // A NUL typed by the author could otherwise pose as a placeholder.
  const out = escaped
    .replace(/\u0000/g, "")
    // Links: the label may be anything (it is escaped); the href must match
    // the allowlist exactly or the whole thing stays as literal text.
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
      const decoded = href.replace(/&amp;/g, "&");
      if (!SAFE_LINK.test(decoded)) return whole;
      return `\u0000L${parked.push(escapeHtml(decoded)) - 1}\u0000${label}\u0000/L\u0000`;
    })
    .replace(/`([^`]+)`/g, (_whole, code: string) => park(`<code>${code}</code>`))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/~~(\S(?:[^~]*?\S)?)~~/g, "<s>$1</s>")
    .replace(/\+\+(\S(?:[^+]*?\S)?)\+\+/g, "<u>$1</u>")
    .replace(/==(\S(?:[^=]*?\S)?)==/g, "<mark>$1</mark>")
    .replace(/\^(\S(?:[^^]*?\S)?)\^/g, "<sup>$1</sup>")
    .replace(/(^|[^~])~(\S(?:[^~]*?\S)?)~(?!~)/g, "$1<sub>$2</sub>")
    .replace(/\n/g, "<br />");

  return out
    .replace(
      /\u0000L(\d+)\u0000/g,
      (_whole, index: string) =>
        `<a href="${parked[Number(index)]}" target="_blank" rel="noreferrer noopener nofollow">`,
    )
    .replace(/\u0000\/L\u0000/g, "</a>")
    .replace(/\u0000(\d+)\u0000/g, (_whole, index: string) => parked[Number(index)] ?? "");
}

/** A check-list item, written `[ ] task` or `[x] task` inside a bullet list. */
function renderListItem(item: string): string {
  const check = /^\[([ xX])\]\s+(.*)$/.exec(item);
  if (!check) return `<li>${renderInline(escapeHtml(item))}</li>`;

  const done = check[1] !== " ";
  return (
    `<li class="hs-check${done ? " is-done" : ""}">` +
    `<span class="hs-check-box" aria-hidden="true">${done ? "✓" : ""}</span>` +
    `<span class="sr-only">${done ? "Done: " : "To do: "}</span>` +
    `<span>${renderInline(escapeHtml(check[2]))}</span></li>`
  );
}

/** Markdown to HTML. The output is safe to inject; the input never is. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const blocks = parseBlocks(source, options);
  const out: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        out.push(`<h${block.level}>${renderInline(escapeHtml(block.text))}</h${block.level}>`);
        break;
      case "paragraph":
        out.push(`<p>${renderInline(escapeHtml(block.text))}</p>`);
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const checklist = !block.ordered && block.items.some((item) => /^\[[ xX]\]\s/.test(item));
        const items = block.items.map(renderListItem).join("");
        out.push(checklist ? `<ul class="hs-checklist">${items}</ul>` : `<${tag}>${items}</${tag}>`);
        break;
      }
      case "quote":
        out.push(`<blockquote>${renderInline(escapeHtml(block.text))}</blockquote>`);
        break;
      case "code":
        // No inline pass inside a code fence: the content is meant to be shown
        // exactly as typed, and escaping alone already makes that safe.
        out.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "rule":
        out.push("<hr />");
        break;
    }
  }

  return out.join("\n");
}

/** First lines of the body, for a card preview. Never markup. */
export function excerpt(source: string, max = 180): string {
  const text = parseBlocks(source)
    .filter((b) => b.type === "paragraph" || b.type === "heading")
    .map((b) => ("text" in b ? stripInline(b.text) : ""))
    .join(" ")
    .trim();

  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export function wordCount(source: string): number {
  const words = stripInline(source).trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/**
 * Every word of the body as one line of plain text, list items included. For
 * search snippets and anywhere else that has room for a sentence, not markup.
 */
export function plainText(source: string, max = 160): string {
  const text = parseBlocks(source)
    .flatMap((b) => (b.type === "list" ? b.items : "text" in b ? [b.text] : []))
    .map(stripInline)
    .join(" · ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
