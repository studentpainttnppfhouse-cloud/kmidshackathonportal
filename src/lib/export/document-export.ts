import 'server-only';
import { deflateRawSync } from 'node:zlib';

/**
 * Tiptap JSON -> HTML and -> DOCX.
 *
 * Both walk the same node tree. Keeping them in one file means a node type
 * added to the editor shows up as a gap in both exporters at once.
 */

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineToHtml(node: TiptapNode): string {
  if (node.type === 'hardBreak') return '<br />';
  let out = escapeHtml(node.text ?? '');
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold': out = `<strong>${out}</strong>`; break;
      case 'italic': out = `<em>${out}</em>`; break;
      case 'underline': out = `<u>${out}</u>`; break;
      case 'strike': out = `<s>${out}</s>`; break;
      case 'code': out = `<code>${out}</code>`; break;
      case 'highlight': out = `<mark>${out}</mark>`; break;
      case 'link': {
        const href = escapeHtml(String(mark.attrs?.href ?? '#'));
        out = `<a href="${href}">${out}</a>`;
        break;
      }
      case 'textStyle': {
        const color = mark.attrs?.color;
        if (color) out = `<span style="color:${escapeHtml(String(color))}">${out}</span>`;
        break;
      }
      default: break;
    }
  }
  return out;
}

function nodeToHtml(node: TiptapNode): string {
  const kids = () => (node.content ?? []).map(nodeToHtml).join('');
  const inline = () => (node.content ?? []).map(inlineToHtml).join('');

  switch (node.type) {
    case 'doc': return kids();
    case 'paragraph': return `<p>${inline()}</p>`;
    case 'heading': return `<h${node.attrs?.level ?? 1}>${inline()}</h${node.attrs?.level ?? 1}>`;
    case 'bulletList': return `<ul>${kids()}</ul>`;
    case 'orderedList': return `<ol>${kids()}</ol>`;
    case 'taskList': return `<ul class="task">${kids()}</ul>`;
    case 'listItem': return `<li>${kids()}</li>`;
    case 'taskItem':
      return `<li>${node.attrs?.checked ? '☑' : '☐'} ${kids()}</li>`;
    case 'blockquote': return `<blockquote>${kids()}</blockquote>`;
    case 'codeBlock': return `<pre><code>${escapeHtml(inline())}</code></pre>`;
    case 'horizontalRule': return '<hr />';
    case 'image': return `<img src="${escapeHtml(String(node.attrs?.src ?? ''))}" alt="" />`;
    case 'table': return `<table>${kids()}</table>`;
    case 'tableRow': return `<tr>${kids()}</tr>`;
    case 'tableHeader': return `<th>${kids()}</th>`;
    case 'tableCell': return `<td>${kids()}</td>`;
    case 'text': return inlineToHtml(node);
    default: return kids();
  }
}

export function htmlFromTiptap(title: string, content: unknown): string {
  const body = nodeToHtml(content as TiptapNode);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 22mm; }
  body { font-family: Inter, system-ui, sans-serif; color: #1F2937; line-height: 1.65;
         max-width: 780px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 28px; letter-spacing: -0.02em; }
  h2 { font-size: 21px; letter-spacing: -0.015em; }
  h3 { font-size: 17px; }
  blockquote { border-left: 3px solid #EC4899; padding-left: 14px; color: #64748B; margin-left: 0; }
  pre { background: #FDF2F8; border: 1px solid #EEE2E9; border-radius: 8px; padding: 12px; overflow-x: auto; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #EEE2E9; padding: 7px 10px; text-align: left; }
  th { background: #FDF2F8; }
  mark { background: #FCE7F3; }
  ul.task { list-style: none; padding-left: 8px; }
  .doc-title { border-bottom: 2px solid #EC4899; padding-bottom: 10px; margin-bottom: 24px; }
  .hint { color: #94A3B8; font-size: 12px; margin-bottom: 28px; }
  @media print { .hint { display: none; } }
</style>
</head>
<body>
<h1 class="doc-title">${escapeHtml(title)}</h1>
<p class="hint">Use your browser's Print dialogue and choose "Save as PDF".</p>
${body}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function runsFor(node: TiptapNode): string {
  return (node.content ?? [])
    .map((child) => {
      if (child.type === 'hardBreak') return '<w:r><w:br/></w:r>';
      const marks = new Set((child.marks ?? []).map((m) => m.type));
      const props = [
        marks.has('bold') ? '<w:b/>' : '',
        marks.has('italic') ? '<w:i/>' : '',
        marks.has('underline') ? '<w:u w:val="single"/>' : '',
        marks.has('strike') ? '<w:strike/>' : '',
        marks.has('highlight') ? '<w:highlight w:val="yellow"/>' : '',
        marks.has('code') ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : '',
      ].join('');
      const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(child.text ?? '')}</w:t></w:r>`;
    })
    .join('');
}

function paragraphsFor(node: TiptapNode, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${runsFor(node)}</w:p>`;
}

function docxBody(node: TiptapNode): string {
  const kids = () => (node.content ?? []).map(docxBody).join('');

  switch (node.type) {
    case 'doc': return kids();
    case 'paragraph': return paragraphsFor(node);
    case 'heading': return paragraphsFor(node, `Heading${node.attrs?.level ?? 1}`);
    case 'blockquote': return kids();
    case 'codeBlock': return paragraphsFor(node);
    case 'bulletList':
    case 'orderedList':
    case 'taskList': return kids();
    case 'listItem':
    case 'taskItem': return kids();
    case 'horizontalRule':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="EEE2E9"/></w:pBdr></w:pPr></w:p>';
    case 'table': return kids();
    case 'tableRow': return kids();
    case 'tableHeader':
    case 'tableCell': return kids();
    default: return kids();
  }
}

/** Minimal ZIP writer — a .docx is just a zip of XML parts. */
function zip(files: { name: string; data: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const deflated = deflateRawSync(file.data);
    const crc = crc32(file.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(file.data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);

    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

let crcTable: number[] | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function docxFromTiptap(title: string, content: unknown): Promise<Buffer> {
  const body = docxBody(content as TiptapNode);

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(title)}</w:t></w:r></w:p>
    ${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1247" w:right="1247" w:bottom="1247" w:left="1247"/></w:sectPr>
  </w:body>
</w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:sz w:val="22"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  ${[1, 2, 3]
    .map(
      (l) => `<w:style w:type="paragraph" w:styleId="Heading${l}">
    <w:name w:val="heading ${l}"/>
    <w:pPr><w:spacing w:before="${320 - l * 60}" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="${40 - l * 6}"/><w:color w:val="1F2937"/></w:rPr>
  </w:style>`,
    )
    .join('')}
</w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return zip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(styles, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') },
  ]);
}
