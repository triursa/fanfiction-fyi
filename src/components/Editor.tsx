import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { h } from 'preact';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import { common, createLowlight } from 'lowlight';
import { markdownToHtml, htmlToMarkdown } from '@/lib/markdown';

const lowlight = createLowlight(common);

/** Upload an image file to the server and return the URL */
async function uploadImageFile(file: File): Promise<{ key: string; url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'chapter');
  // workId will be set by the parent page via a global or we extract from URL
  const workIdMatch = window.location.pathname.match(/\/works\/(\d+)/);
  const workId = workIdMatch ? workIdMatch[1] : '0';
  formData.append('id', workId);

  const res = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(data.error || 'Upload failed');
  }

  return res.json();
}

interface EditorProps {
  content?: string;
  onContentChange?: (markdown: string) => void;
  placeholder?: string;
  workId?: number;
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
  workId,
}: EditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  // Expose workId globally for upload function
  useEffect(() => {
    if (workId) {
      (window as any).__editorWorkId = workId;
    }
  }, [workId]);

  // Initialize image key tracking
  useEffect(() => {
    if (!(window as any).__editorImageKeys) {
      (window as any).__editorImageKeys = [];
    }
  }, []);

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
        Image.configure({
          inline: false,
          allowBase64: false,
          HTMLAttributes: {
            class: 'chapter-image',
          },
        }),
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

  // ── Image Upload Handler ──
  const handleImageUpload = useCallback(async (file: File) => {
    if (!editorRef.current) return;

    // Validate file type
    const allowedTypes = ['image/gif', 'image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Invalid file type. Allowed: GIF, PNG, JPEG, WebP');
      return;
    }

    // Validate file size (25MB max)
    if (file.size > 25 * 1024 * 1024) {
      alert('File too large. Maximum size: 25MB');
      return;
    }

    setIsUploading(true);
    try {
      const result = await uploadImageFile(file);
      // Insert image into editor at current position
      editorRef.current.chain().focus().setImage({
        src: result.url,
        alt: file.name.replace(/\.[^.]+$/, ''),
      }).run();
      // Track the image key for form submission
      const imageKeys = (window as any).__editorImageKeys || [];
      if (!imageKeys.includes(result.key)) {
        imageKeys.push(result.key);
        (window as any).__editorImageKeys = imageKeys;
      }
    } catch (e: any) {
      alert(e.message || 'Image upload failed');
    } finally {
      setIsUploading(false);
    }
  }, []);

  // ── File input for image upload button ──
  const handleImageButtonClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/gif,image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        await handleImageUpload(file);
      }
    };
    input.click();
  }, [handleImageUpload]);

  // ── Drag & drop + paste handlers ──
  useEffect(() => {
    const editorEl = mountRef.current;
    if (!editorEl) return;

    const handleDrop = (e: DragEvent) => {
      // Only handle if there are image files
      if (!e.dataTransfer?.files?.length) return;
      const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      e.preventDefault();
      e.stopPropagation();

      // Upload each image sequentially
      (async () => {
        for (const file of imageFiles) {
          await handleImageUpload(file);
        }
      })();
    };

    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.files?.length) return;
      const imageFiles = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      e.preventDefault();
      // Don't stop propagation — let TipTap handle text too

      // Upload pasted images
      (async () => {
        for (const file of imageFiles) {
          await handleImageUpload(file);
        }
      })();
    };

    // Prevent browser default drag behavior on the editor area
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    };

    editorEl.addEventListener('drop', handleDrop);
    editorEl.addEventListener('paste', handlePaste);
    editorEl.addEventListener('dragover', handleDragOver);

    return () => {
      editorEl.removeEventListener('drop', handleDrop);
      editorEl.removeEventListener('paste', handlePaste);
      editorEl.removeEventListener('dragover', handleDragOver);
    };
  }, [handleImageUpload]);

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
      label: '🖼️',
      title: 'Insert Image',
      action: () => handleImageButtonClick(),
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

      {isUploading && (
        <div class="tiptap-upload-overlay">
          <span class="tiptap-upload-status">Uploading image…</span>
        </div>
      )}

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