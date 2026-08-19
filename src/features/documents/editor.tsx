'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, List, ListOrdered,
  ListChecks, Table as TableIcon, Link2, Code, Quote, Minus, Undo2, Redo2,
  Heading1, Heading2, Heading3, Highlighter, Check, CloudOff, Loader2,
} from 'lucide-react';
import { saveDocumentAction } from './actions';

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

const AUTOSAVE_DELAY_MS = 1200;

export function DocumentEditor({
  documentId,
  initialContent,
  initialTitle,
  editable,
}: {
  documentId: string;
  initialContent: object;
  initialTitle: string;
  editable: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef(initialTitle);

  const editor = useEditor({
    editable,
    // Tiptap renders differently on the server; let the client own it.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Highlight.configure({ multicolor: true }),
      TextStyle,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'tiptap focus:outline-none min-h-[440px]',
        'aria-label': 'Document body',
      },
    },
    onUpdate: () => scheduleSave(),
  });

  const scheduleSave = useCallback(() => {
    if (!editable) return;
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    // `flush` is stable enough for this debounce; re-creating it on every
    // keystroke would reset the timer and defeat the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  const flush = useCallback(async () => {
    if (!editor || !editable) return;
    setSaveState('saving');
    setError(null);
    const res = await saveDocumentAction(
      documentId,
      editor.getJSON(),
      editor.getText(),
      titleRef.current.trim() || 'Untitled',
    );
    if (res.ok) setSaveState('saved');
    else {
      setSaveState('error');
      setError(res.error);
    }
  }, [editor, editable, documentId]);

  // Save on the way out, so a closed tab does not lose the last edit.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!editor) {
    return <div className="py-16 text-center text-[13px] text-muted-2">Loading editor…</div>;
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-5 pt-4">
        <input
          value={title}
          disabled={!editable}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            scheduleSave();
          }}
          aria-label="Document title"
          placeholder="Untitled"
          className="w-full border-0 bg-transparent pb-3 text-[24px] font-extrabold tracking-[-0.02em] text-ink outline-none placeholder:text-muted"
        />
      </div>

      {editable ? <Toolbar editor={editor} /> : null}

      <div className="px-5 py-5">
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-2 border-t border-line bg-surface-2 px-5 py-2.5 text-[12px] font-semibold">
        <SaveIndicator state={saveState} />
        {error ? <span className="text-danger">{error}</span> : null}
        <span className="ml-auto text-muted-2">
          {editor.storage.characterCount?.words?.() ?? editor.getText().split(/\s+/).filter(Boolean).length}{' '}
          words
        </span>
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-muted-2">
        <Loader2 size={13} className="animate-[spin_1s_linear_infinite]" /> Saving…
      </span>
    );
  }
  if (state === 'dirty') {
    return <span className="flex items-center gap-1.5 text-muted-2">Unsaved changes</span>;
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-danger">
        <CloudOff size={13} /> Not saved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-teal">
      <Check size={13} /> All changes saved
    </span>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const groups = [
    [
      { icon: Undo2, label: 'Undo', run: () => editor.chain().focus().undo().run(), active: false },
      { icon: Redo2, label: 'Redo', run: () => editor.chain().focus().redo().run(), active: false },
    ],
    [
      { icon: Heading1, label: 'Heading 1', run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
      { icon: Heading2, label: 'Heading 2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
      { icon: Heading3, label: 'Heading 3', run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
    ],
    [
      { icon: Bold, label: 'Bold', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
      { icon: Italic, label: 'Italic', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
      { icon: UnderlineIcon, label: 'Underline', run: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive('underline') },
      { icon: Strikethrough, label: 'Strikethrough', run: () => editor.chain().focus().toggleStrike().run(), active: editor.isActive('strike') },
      { icon: Highlighter, label: 'Highlight', run: () => editor.chain().focus().toggleHighlight().run(), active: editor.isActive('highlight') },
    ],
    [
      { icon: List, label: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
      { icon: ListOrdered, label: 'Numbered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
      { icon: ListChecks, label: 'Checklist', run: () => editor.chain().focus().toggleTaskList().run(), active: editor.isActive('taskList') },
    ],
    [
      { icon: Quote, label: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
      { icon: Code, label: 'Code block', run: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive('codeBlock') },
      { icon: Minus, label: 'Divider', run: () => editor.chain().focus().setHorizontalRule().run(), active: false },
      {
        icon: TableIcon,
        label: 'Insert table',
        run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        active: editor.isActive('table'),
      },
      {
        icon: Link2,
        label: 'Link',
        run: () => {
          const url = window.prompt('Link URL');
          if (url === null) return;
          if (url === '') editor.chain().focus().unsetLink().run();
          else editor.chain().focus().setLink({ href: url }).run();
        },
        active: editor.isActive('link'),
      },
    ],
  ];

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-3 py-2">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 ? <span className="mx-1.5 h-5 w-px bg-line" /> : null}
          {group.map(({ icon: Icon, label, run, active }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={run}
              className={`grid h-8 w-8 place-items-center rounded-md transition-colors ${
                active ? 'bg-pink text-white' : 'text-muted-2 hover:bg-surface-3 hover:text-ink'
              }`}
            >
              <Icon size={15} strokeWidth={2} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
