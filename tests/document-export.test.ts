import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docxFromTiptap, htmlFromTiptap } from '@/lib/export/document-export';

const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Judging rubric' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Teams are scored on ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'clinical impact' },
        { type: 'text', text: ' and feasibility.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Impact — 40%' }] }],
        },
      ],
    },
  ],
};

describe('HTML export', () => {
  it('renders headings, marks and lists', () => {
    const html = htmlFromTiptap('Rubric v3', SAMPLE);
    expect(html).toContain('<h2>Judging rubric</h2>');
    expect(html).toContain('<strong>clinical impact</strong>');
    expect(html).toContain('<li><p>Impact — 40%</p></li>');
  });

  it('escapes content that would otherwise inject markup', () => {
    const html = htmlFromTiptap('Title', {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      ],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('DOCX export', () => {
  it('produces a zip that unzips to the expected parts', async () => {
    const buffer = await docxFromTiptap('Rubric v3', SAMPLE);

    // A .docx is a zip; the first two bytes must be the local file header.
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');

    const dir = mkdtempSync(join(tmpdir(), 'docx-'));
    const path = join(dir, 'out.docx');
    writeFileSync(path, buffer);

    // Let a real unzip validate the CRCs and the central directory. If the
    // archive were malformed this throws.
    const listing = execFileSync('unzip', ['-l', path], { encoding: 'utf8' });
    expect(listing).toContain('word/document.xml');
    expect(listing).toContain('[Content_Types].xml');

    const documentXml = execFileSync('unzip', ['-p', path, 'word/document.xml'], {
      encoding: 'utf8',
    });
    expect(documentXml).toContain('Judging rubric');
    expect(documentXml).toContain('<w:b/>');
    expect(documentXml).toContain('Rubric v3');
  });

  it('escapes XML-significant characters', async () => {
    const buffer = await docxFromTiptap('A & B', {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x < y & "quoted"' }] }],
    });
    const dir = mkdtempSync(join(tmpdir(), 'docx-'));
    const path = join(dir, 'out.docx');
    writeFileSync(path, buffer);
    const xml = execFileSync('unzip', ['-p', path, 'word/document.xml'], { encoding: 'utf8' });
    expect(xml).toContain('x &lt; y &amp; &quot;quoted&quot;');
    expect(xml).toContain('A &amp; B');
  });
});
