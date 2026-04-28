import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { h } from 'preact';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { markdownToHtml, htmlToMarkdown } from '@/lib/markdown';

const lowlight = createLowlight(common);

interface EditorProps {
  content?: string;
  onContentChange?: (markdown: string) => void;
  placeholder?: string;
}

interface ToolbarBtn {
  label: string;
  title: string;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  separator?: boolean;
}

function ToolbarButton({ editor, btn }: { editor: Editor; btn: ToolbarBtn }) {
  const active = btn.isActive ? btn.isActive(editor) : false;
  return (
    <button
      type="button"
      class={`tiptap-toolbar-btn${active ? ' tiptap-toolbar-btn--active' : ''}`}
      title={btn.title}
      aria-label={btn.title}
      aria-pressed={active}
      onClick={() => btn.action(editor)}
    >
      {btn.label}
    </button>
  );
}

export default function TipTapEditor({
  content = '',
  onContentChange,
  placeholder = 'Start writing…',
}: EditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    if (!mountRef.current) return;

    const editor = new Editor({
      element: mountRef.current,
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
        }),
        Heading.configure({ levels: [1, 2, 3] }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Placeholder.configure({ placeholder }),
        CodeBlockLowlight.configure({ lowlight }),
      ],
      content: content || '',
      onUpdate: ({ editor: e }) => {
        const html = e.getHTML();
        const md = htmlToMarkdown(html);
        // Expose markdown to global for form submission
        (window as any).__editorMarkdown = md;
        (window as any).__editorContent = md;
        onContentChangeRef.current?.(md);
      },
      onFocus: ({ editor: e }) => {
        const el = e.options.element?.closest('.tiptap-wrapper');
        el?.classList.add('tiptap-wrapper--focused');
      },
      onBlur: ({ editor: e }) => {
        const el = e.options.element?.closest('.tiptap-wrapper');
        el?.classList.remove('tiptap-wrapper--focused');
      },
    });

    editorRef.current = editor;
    // Set initial markdown content on global
    const initialMd = content ? htmlToMarkdown(editor.getHTML()) : '';
    (window as any).__editorMarkdown = initialMd;
    (window as any).__editorContent = initialMd;
    setIsEditorReady(true);

    return () => {
      editor.destroy();
      editorRef.current = null;
      setIsEditorReady(false);
    };
  }, []);

  // Sync placeholder if it changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setOptions({ extensions: [Placeholder.configure({ placeholder })] });
    }
  }, [placeholder]);

  // ── Markdown Import / Export ──
  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,.markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editorRef.current) return;
      const md = await file.text();
      const html = markdownToHtml(md);
      editorRef.current.commands.setContent(html);
    };
    input.click();
  }, []);

  const handleExport = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const md = htmlToMarkdown(editor.getHTML());
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chapter.md';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Link prompt ──
  const promptLink = useCallback((editor: Editor) => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL', prev || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, []);

  // ── Toolbar definition ──
  const toolbarButtons: ToolbarBtn[] = [
    {
      label: 'B',
      title: 'Bold',
      action: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive('bold'),
    },
    {
      label: 'I',
      title: 'Italic',
      action: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive('italic'),
    },
    { label: '', title: '', action: () => {}, separator: true },
    {
      label: 'H1',
      title: 'Heading 1',
      action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (e) => e.isActive('heading', { level: 1 }),
    },
    {
      label: 'H2',
      title: 'Heading 2',
      action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (e) => e.isActive('heading', { level: 2 }),
    },
    {
      label: 'H3',
      title: 'Heading 3',
      action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: (e) => e.isActive('heading', { level: 3 }),
    },
    { label: '', title: '', action: () => {}, separator: true },
    {
      label: '🔗',
      title: 'Insert Link',
      action: (e) => promptLink(e),
      isActive: (e) => e.isActive('link'),
    },
    {
      label: '""',
      title: 'Blockquote',
      action: (e) => e.chain().focus().toggleBlockquote().run(),
      isActive: (e) => e.isActive('blockquote'),
    },
    {
      label: '💻',
      title: 'Code Block',
      action: (e) => e.chain().focus().toggleCodeBlock().run(),
      isActive: (e) => e.isActive('codeBlock'),
    },
    { label: '', title: '', action: () => {}, separator: true },
    {
      label: '1.',
      title: 'Ordered List',
      action: (e) => e.chain().focus().toggleOrderedList().run(),
      isActive: (e) => e.isActive('orderedList'),
    },
    {
      label: '•',
      title: 'Bullet List',
      action: (e) => e.chain().focus().toggleBulletList().run(),
      isActive: (e) => e.isActive('bulletList'),
    },
    {
      label: '—',
      title: 'Horizontal Rule',
      action: (e) => e.chain().focus().setHorizontalRule().run(),
    },
  ];

  const editor = editorRef.current;

  return (
    <div class="tiptap-wrapper">
      <div class="tiptap-toolbar" role="toolbar" aria-label="Formatting toolbar">
        {toolbarButtons.map((btn, i) =>
          btn.separator ? (
            <div key={`sep-${i}`} class="tiptap-toolbar-separator" role="separator" aria-orientation="vertical" />
          ) : (
            editor && (
              <ToolbarButton key={`btn-${i}`} editor={editor} btn={btn} />
            )
          )
        )}
        <div class="tiptap-toolbar-spacer" />
        <button
          type="button"
          class="tiptap-toolbar-btn tiptap-toolbar-btn--secondary"
          title="Import Markdown file"
          onClick={handleImport}
        >
          Import .md
        </button>
        <button
          type="button"
          class="tiptap-toolbar-btn tiptap-toolbar-btn--secondary"
          title="Export as Markdown"
          onClick={handleExport}
        >
          Export .md
        </button>
      </div>

      <div class="tiptap-editor-area" ref={mountRef}>
      </div>

      <div class="tiptap-footer">
        <span class="tiptap-wordcount">
          {editor ? editor.storage.characterCount?.words?.() ?? countWords(editor.getText()) : 0} words
        </span>
      </div>
    </div>
  );
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}