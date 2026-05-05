import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Heading from '@tiptap/extension-heading';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Image from '@tiptap/extension-image';
import CharacterCount from '@tiptap/extension-character-count';
import { common, createLowlight } from 'lowlight';
import { markdownToHtml, htmlToMarkdown } from '@/lib/markdown';
import { editorMarkdown, editorContent, editorImageKeys, editorWordCount, editorSetContent, editorOnContentChange, editorTriggerImageUpload, editorTriggerLinkDialog } from '@/lib/editor-signals';
import LinkDialog from './LinkDialog';
import SlashCommandMenu, { createSlashCommandExtension } from './SlashCommandMenu';
import ShortcutsModal from './ShortcutsModal';

const lowlight = createLowlight(common);

/** Upload an image file to the server and return the URL. Uses XHR for progress events. */
function uploadImageFileXHR(
  file: File,
  workId: number | string,
  onProgress?: (percent: number) => void
): Promise<{ key: string; url: string }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'chapter');
    formData.append('id', String(workId));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error || 'Upload failed'));
        } catch {
          reject(new Error('Upload failed'));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(formData);
  });
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Expose workId globally for upload function
  useEffect(() => {
    if (workId) {
      (window as any).__editorWorkId = workId;
    }
  }, [workId]);

  // Expose setContent for external chapter loading (used by draft workspace)
  useEffect(() => {
    const handler = (mdOrHtml: string) => {
      if (!editorRef.current) return;
      // If it looks like HTML, set directly; otherwise convert from markdown
      const html = mdOrHtml.includes('<') ? mdOrHtml : markdownToHtml(mdOrHtml);
      editorRef.current.commands.setContent(html);
      // Update signal state
      const md = htmlToMarkdown(editorRef.current.getHTML());
      editorMarkdown.value = md;
      editorContent.value = md;
      editorWordCount.value = countWords(editorRef.current.getText());
    };
    editorSetContent.value = handler;
    return () => { editorSetContent.value = undefined; };
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
        CharacterCount,
        createSlashCommandExtension(),
      ],
      content: content || '',
      onUpdate: ({ editor: e }) => {
        const html = e.getHTML();
        const md = htmlToMarkdown(html);
        // Expose markdown via signals for form submission
        editorMarkdown.value = md;
        editorContent.value = md;
        // Update canonical word count from editor text (not markdown)
        // to avoid 0-word bugs when htmlToMarkdown degrades content
        editorWordCount.value = countWords(e.getText());
        onContentChangeRef.current?.(md);
        // Call autosave hook if set (used by draft workspace)
        if (editorOnContentChange.value) {
          editorOnContentChange.value(md);
        }
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
    // Set initial markdown content via signals
    const initialMd = content ? htmlToMarkdown(editor.getHTML()) : '';
    editorMarkdown.value = initialMd;
    editorContent.value = initialMd;
    editorWordCount.value = content ? countWords(editor.getText()) : 0;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Sync placeholder if it changes
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.setOptions({ extensions: [Placeholder.configure({ placeholder })] });
    }
  }, [placeholder]);

  // ── Image Upload Handler (with XHR progress) ──
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

    setUploadProgress(0);
    try {
      const effectiveWorkId = workId || (window as any).__editorWorkId || '0';
      const result = await uploadImageFileXHR(file, effectiveWorkId, (pct) => {
        setUploadProgress(pct);
      });
      // Insert image into editor at current position
      editorRef.current.chain().focus().setImage({
        src: result.url,
        alt: file.name.replace(/\.[^.]+$/, ''),
      }).run();
      // Track the image key for form submission
      const imageKeys = [...editorImageKeys.value];
      if (!imageKeys.includes(result.key)) {
        imageKeys.push(result.key);
        editorImageKeys.value = imageKeys;
      }
    } catch (e: any) {
      alert(e.message || 'Image upload failed');
    } finally {
      setUploadProgress(null);
    }
  }, [workId]);

  // Expose image upload trigger for slash commands
  useEffect(() => {
    editorTriggerImageUpload.value = handleImageButtonClick;
    return () => { editorTriggerImageUpload.value = undefined; };
  }, []);

  // Helper for image button click — defined outside useEffect so it's stable
  function handleImageButtonClick() {
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
  }

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
      setIsDragOver(false);

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
        setIsDragOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      // Only set false if leaving the editor element entirely
      if (editorEl.contains(e.relatedTarget as Node)) return;
      setIsDragOver(false);
    };

    editorEl.addEventListener('drop', handleDrop);
    editorEl.addEventListener('paste', handlePaste);
    editorEl.addEventListener('dragover', handleDragOver);
    editorEl.addEventListener('dragleave', handleDragLeave);

    return () => {
      editorEl.removeEventListener('drop', handleDrop);
      editorEl.removeEventListener('paste', handlePaste);
      editorEl.removeEventListener('dragover', handleDragOver);
      editorEl.removeEventListener('dragleave', handleDragLeave);
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

  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDialogUrl, setLinkDialogUrl] = useState('');

  // ── Link dialog ──
  const openLinkDialog = useCallback((editor: Editor) => {
    const prev = editor.getAttributes('link').href as string | undefined;
    setLinkDialogUrl(prev || 'https://');
    setLinkDialogOpen(true);
  }, []);

  // Expose link dialog trigger for slash commands
  useEffect(() => {
    editorTriggerLinkDialog.value = () => {
      if (editorRef.current) {
        openLinkDialog(editorRef.current);
      }
    };
    return () => { editorTriggerLinkDialog.value = undefined; };
  }, [openLinkDialog]);

  const handleLinkConfirm = useCallback((url: string) => {
    setLinkDialogOpen(false);
    if (!editorRef.current) return;
    if (url === '') {
      editorRef.current.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editorRef.current.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, []);

  const handleLinkCancel = useCallback(() => {
    setLinkDialogOpen(false);
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
      action: (e) => openLinkDialog(e),
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

  // ── Word count + reading time ──
  // Always count from getText() — CharacterCount.words() can return 0 after
  // programmatic setContent or large paste events before the extension recalculates.
  const words = editor ? countWords(editor.getText()) : 0;
  const readingTime = Math.max(1, Math.ceil(words / 200));
  const formattedWords = words.toLocaleString();

  return (
    <div ref={wrapperRef} class={`tiptap-wrapper${isDragOver ? ' tiptap-wrapper--dragover' : ''}`}>
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

      {/* Drag overlay */}
      {isDragOver && (
        <div class="tiptap-drag-overlay">
          <span class="tiptap-drag-overlay-text">Drop images here</span>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div class="tiptap-upload-overlay">
          <div class="tiptap-upload-progress">
            <div class="tiptap-upload-progress-bar-wrap">
              <div class="tiptap-upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
            <span class="tiptap-upload-progress-text">Uploading {uploadProgress}%</span>
          </div>
        </div>
      )}

      <div class="tiptap-footer">
        <span class="tiptap-wordcount">
          {formattedWords} words · {readingTime} min read
        </span>
      </div>

      <LinkDialog
        open={linkDialogOpen}
        initialUrl={linkDialogUrl}
        onConfirm={handleLinkConfirm}
        onCancel={handleLinkCancel}
      />

      {editor && <SlashCommandMenu editor={editor} />}
      <ShortcutsModal />
    </div>
  );
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}