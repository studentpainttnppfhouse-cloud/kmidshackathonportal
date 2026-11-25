import { createZip } from "@/lib/export/zip";
import { escapeHtml, parseBlocks, stripInline, type Block } from "@/lib/markdown";

/**
 * A .docx writer for portal documents.
 *
 * WordprocessingML is verbose but not complicated, and a document that only
 * needs headings, paragraphs, lists, quotes and code is a small subset of it.
 * What Word requires to open the file at all is: `[Content_Types].xml`, a
 * package relationship pointing at the document part, the document part
 * itself, and — for anything with a named style — a styles part that defines
 * the styles being referenced.
 *
 * Everything the author typed goes through `escapeHtml` before it reaches the
 * XML. A stray `&` in a task title would otherwise produce a file Word refuses
 * to open, and a `<` would let document text close a tag — the same injection
 * problem as HTML, in a different syntax.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/** Colours match the portal's brand tokens so an export still looks like the portal. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="22"/><w:szCs w:val="22"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="BE185D"/><w:sz w:val="52"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="280" w:after="140"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="BE185D"/><w:sz w:val="34"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="1F2937"/><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:ind w:left="480"/></w:pPr>
    <w:rPr><w:i/><w:color w:val="64748B"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="HTML Preformatted"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="0"/><w:ind w:left="280"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:color w:val="94A3B8"/><w:sz w:val="18"/></w:rPr>
  </w:style>
</w:styles>`;

function xml(text: string): string {
  return escapeHtml(text).replace(/&#39;/g, "&apos;");
}

/**
 * One paragraph, with bold and italic runs where the Markdown asked for them.
 *
 * The splitter keeps the delimiters in the output array so each fragment can be
 * classified; anything unmatched falls through as a plain run. Inline code is
 * rendered as a monospace run rather than dropped, because a document that
 * quotes a command should still show it as one.
 */
function runs(text: string): string {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]*\]\([^)\s]+\))/g);

  return parts
    .filter((part) => part.length > 0)
    .map((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(part.slice(2, -2))}</w:t></w:r>`;
      }
      if (/^`[^`]+`$/.test(part)) {
        return `<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr><w:t xml:space="preserve">${xml(part.slice(1, -1))}</w:t></w:r>`;
      }
      if (/^\*[^*]+\*$/.test(part)) {
        return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${xml(part.slice(1, -1))}</w:t></w:r>`;
      }
      const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(part);
      if (link) {
        // Rendered as underlined coloured text with the target in brackets:
        // a real hyperlink needs a relationship id per link, and a printed
        // document that shows its URLs is more useful than one that hides them.
        const label = link[1] || link[2];
        return (
          `<w:r><w:rPr><w:color w:val="BE185D"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${xml(label)}</w:t></w:r>` +
          `<w:r><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve"> (${xml(link[2])})</w:t></w:r>`
        );
      }
      return `<w:r><w:t xml:space="preserve">${xml(stripInline(part))}</w:t></w:r>`;
    })
    .join("");
}

function paragraph(style: string | null, text: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${runs(text)}</w:p>`;
}

function blockToXml(block: Block): string {
  switch (block.type) {
    case "heading":
      return paragraph(`Heading${block.level}`, block.text);
    case "paragraph":
      return paragraph(null, block.text);
    case "quote":
      return paragraph("Quote", block.text);
    case "code":
      return block.text
        .split("\n")
        .map((line) => paragraph("Code", line || " "))
        .join("");
    case "list":
      return block.items
        .map((item, index) =>
          paragraph(
            null,
            block.ordered
              ? `${index + 1}.  ${item}`
              : /^\[[ xX]\]\s/.test(item)
                ? `${item[1] === " " ? "☐" : "☑"}  ${item.slice(4)}`
                : `•  ${item}`,
          ),
        )
        .join("");
    case "rule":
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="F3E3EC"/></w:pBdr></w:pPr></w:p>`;
  }
}

export type DocxOptions = {
  title: string;
  body: string;
  subtitle?: string;
  footNote?: string;
};

export function buildDocx({ title, body, subtitle, footNote }: DocxOptions): Buffer {
  const content = [
    paragraph("Title", title),
    subtitle ? paragraph("Caption", subtitle) : "",
    ...parseBlocks(body).map(blockToXml),
    footNote ? paragraph("Caption", footNote) : "",
  ].join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${content}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${xml(title)}</dc:title>
  <dc:creator>Hackathon Studio</dc:creator>
  <cp:lastModifiedBy>Hackathon Studio</cp:lastModifiedBy>
</cp:coreProperties>`;

  return createZip([
    // `[Content_Types].xml` must be the first entry: some readers look for it
    // at a fixed position rather than through the central directory.
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "docProps/core.xml", content: core },
    { name: "word/_rels/document.xml.rels", content: DOCUMENT_RELS },
    { name: "word/styles.xml", content: STYLES },
    { name: "word/document.xml", content: document },
  ]);
}
