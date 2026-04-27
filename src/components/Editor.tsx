import { useState, useRef, useEffect } from 'preact/hooks';
import { h } from 'preact';

interface EditorProps {
  initialContent?: string;
  onContentChange?: (markdown: string) => void;
  placeholder?: string;
}

export default function TipTapEditor({ initialContent = '', onContentChange, placeholder = 'Start writing...' }: EditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isPreview, setIsPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleChange = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    const md = target.value;
    setContent(md);
    onContentChange?.(md);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.txt,.markdown';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      setContent(text);
      onContentChange?.(text);
    };
    input.click();
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chapter.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="editor-container">
      <div class="editor-toolbar">
        <button type="button" class={`editor-toolbar-btn ${!isPreview ? 'active' : ''}`} onClick={() => setIsPreview(false)}>Edit</button>
        <button type="button" class={`editor-toolbar-btn ${isPreview ? 'active' : ''}`} onClick={() => setIsPreview(true)}>Preview</button>
        <div class="editor-toolbar-spacer" />
        <button type="button" class="editor-toolbar-btn" onClick={handleImport} title="Import Markdown file">Import .md</button>
        <button type="button" class="editor-toolbar-btn" onClick={handleExport} title="Export as Markdown">Export .md</button>
      </div>

      {!isPreview ? (
        <textarea
          ref={textareaRef}
          class="editor-textarea"
          value={content}
          onInput={handleChange}
          placeholder={placeholder}
        />
      ) : (
        <div class="editor-preview prose-content" dangerouslySetInnerHTML={{ __html: simpleMarkdown(content) }} />
      )}

      <div class="editor-footer">
        <span class="editor-wordcount">{content.split(/\s+/).filter(Boolean).length} words</span>
      </div>
    </div>
  );
}

function simpleMarkdown(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^---$/gm, '<hr />')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />');
  html = `<p>${html}</p>`;
  return html;
}