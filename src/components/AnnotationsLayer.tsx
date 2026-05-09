import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

interface AnnotationData {
  id: number;
  chapterId: number;
  userId: number;
  startOffset: number;
  endOffset: number;
  noteText: string;
  color: string;
  sharedWithAuthor: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AnnotationsLayerProps {
  workId: number;
  chapterId: number;
  userId: number | null;
}

const COLORS = [
  { key: 'yellow', bg: 'rgba(255, 235, 59, 0.2)', marker: '#FDD835' },
  { key: 'green', bg: 'rgba(76, 175, 80, 0.2)', marker: '#66BB6A' },
  { key: 'blue', bg: 'rgba(33, 150, 243, 0.2)', marker: '#42A5F5' },
  { key: 'pink', bg: 'rgba(233, 30, 99, 0.2)', marker: '#EC407A' },
  { key: 'orange', bg: 'rgba(255, 152, 0, 0.2)', marker: '#FFA726' },
] as const;

export default function AnnotationsLayer({ workId, chapterId, userId }: AnnotationsLayerProps) {
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>('yellow');
  const [shareWithAuthor, setShareWithAuthor] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editColor, setEditColor] = useState('yellow');
  const [editShared, setEditShared] = useState(false);
  const [visible, setVisible] = useState(true);
  const [activeAnnotation, setActiveAnnotation] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const proseRef = useRef<HTMLDivElement | null>(null);

  // Load annotations
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/works/${workId}/chapters/${chapterId}/annotations`)
      .then(r => r.json())
      .then(data => setAnnotations(data.annotations || data || []))
      .catch(() => {});
  }, [workId, chapterId, userId]);

  // Load visibility from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('ffy_annotations_visible');
    if (stored !== null) setVisible(stored === 'true');
  }, []);

  // Toggle visibility
  const toggleVisible = useCallback(() => {
    setVisible(prev => {
      const next = !prev;
      localStorage.setItem('ffy_annotations_visible', String(next));
      return next;
    });
  }, []);

  // Handle text selection
  useEffect(() => {
    const prose = proseRef.current || document.querySelector('[data-chapter-content]');
    if (!prose || !userId) return;

    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        // Don't hide create popup immediately — user may be clicking inside it
        return;
      }
      const range = sel.getRangeAt(0);
      // Check if selection is within the prose element
      if (!prose.contains(range.startContainer) || !prose.contains(range.endContainer)) return;

      const textContent = prose.textContent || '';
      const preRange = document.createRange();
      preRange.setStart(prose, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const start = preRange.toString().length;
      const end = start + range.toString().length;

      if (end > start && end <= textContent.length) {
        setSelectionRange({ start, end });
        setShowCreate(true);
      }
    };

    document.addEventListener('mouseup', handleSelection);
    return () => document.removeEventListener('mouseup', handleSelection);
  }, [userId]);

  // Create annotation
  const handleCreate = async () => {
    if (!selectionRange || !noteText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/works/${workId}/chapters/${chapterId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          start_offset: selectionRange.start,
          end_offset: selectionRange.end,
          note_text: noteText.trim(),
          color: selectedColor,
          shared_with_author: shareWithAuthor ? 1 : 0,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnnotations(prev => [...prev, data.annotation || data]);
        setNoteText('');
        setSelectedColor('yellow');
        setShareWithAuthor(false);
        setShowCreate(false);
        setSelectionRange(null);
        window.getSelection()?.removeAllRanges();
      }
    } finally {
      setSaving(false);
    }
  };

  // Delete annotation
  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/works/${workId}/chapters/${chapterId}/annotations/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      setAnnotations(prev => prev.filter(a => a.id !== id));
      if (activeAnnotation === id) setActiveAnnotation(null);
    }
  };

  // Update annotation
  const handleUpdate = async () => {
    if (!editingId) return;
    const res = await fetch(`/api/works/${workId}/chapters/${chapterId}/annotations/${editingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ note_text: editNote.trim(), color: editColor, shared_with_author: editShared ? 1 : 0 }),
    });
    if (res.ok) {
      const data = await res.json();
      setAnnotations(prev => prev.map(a => a.id === editingId ? (data.annotation || data) : a));
      setEditingId(null);
    }
  };

  // Toggle share with author
  const handleToggleShare = async (id: number, current: boolean) => {
    const res = await fetch(`/api/works/${workId}/chapters/${chapterId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ shared_with_author: current ? 0 : 1 }),
    });
    if (res.ok) {
      const data = await res.json();
      setAnnotations(prev => prev.map(a => a.id === id ? (data.annotation || data) : a));
    }
  };

  // Render highlights
  const renderHighlights = () => {
    if (!visible || annotations.length === 0) return null;
    const prose = proseRef.current || document.querySelector('[data-chapter-content]');
    if (!prose) return null;

    // We use a position: relative container for overlay highlights
    return (
      <div class="annotations-highlights">
        {annotations.map(ann => {
          const colorDef = COLORS.find(c => c.key === ann.color) || COLORS[0];
          return (
            <div
              key={ann.id}
              class="annotation-highlight"
              data-annotation-id={ann.id}
              style={{
                '--ann-color': colorDef.bg,
                '--ann-marker': colorDef.marker,
              }}
              onClick={() => setActiveAnnotation(activeAnnotation === ann.id ? null : ann.id)}
            />
          );
        })}
      </div>
    );
  };

  // Annotation detail popup
  const renderAnnotationDetail = () => {
    if (!activeAnnotation) return null;
    const ann = annotations.find(a => a.id === activeAnnotation);
    if (!ann) return null;
    const colorDef = COLORS.find(c => c.key === ann.color) || COLORS[0];
    const isOwner = ann.userId === userId;

    return (
      <div class="annotation-tooltip">
        {editingId === ann.id ? (
          <div class="annotation-edit-form">
            <textarea value={editNote} onInput={e => setEditNote((e.target as HTMLTextAreaElement).value)} rows={3} class="annotation-note-input" />
            <div class="annotation-color-picker">
              {COLORS.map(c => (
                <button
                  key={c.key}
                  class={`annotation-color-swatch${editColor === c.key ? ' active' : ''}`}
                  style={{ '--swatch-color': c.marker }}
                  onClick={() => setEditColor(c.key)}
                  aria-label={c.key}
                />
              ))}
            </div>
            <div class="annotation-actions">
              <button class="annotation-btn-save" onClick={handleUpdate}>Save</button>
              <button class="annotation-btn-cancel" onClick={() => setEditingId(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div class="annotation-tooltip-header">
              <span class="annotation-tooltip-color" style={{ backgroundColor: colorDef.marker }} />
              <span class="annotation-tooltip-time">{new Date(ann.createdAt).toLocaleDateString()}</span>
            </div>
            <p class="annotation-tooltip-text">{ann.noteText}</p>
            {isOwner && (
              <div class="annotation-actions">
                <button class="annotation-btn-edit" onClick={() => { setEditingId(ann.id); setEditNote(ann.noteText); setEditColor(ann.color); setEditShared(!!ann.sharedWithAuthor); }}>Edit</button>
                <button class="annotation-btn-delete" onClick={() => handleDelete(ann.id)}>Delete</button>
                <label class="annotation-share-toggle">
                  <input type="checkbox" checked={!!ann.sharedWithAuthor} onChange={() => handleToggleShare(ann.id, !!ann.sharedWithAuthor)} />
                  Share with author
                </label>
              </div>
            )}
            {!isOwner && ann.sharedWithAuthor && (
              <span class="annotation-shared-badge">Shared by author</span>
            )}
          </>
        )}
      </div>
    );
  };

  if (!userId) return null; // Guests can't annotate

  return (
    <>
      {/* Fragment root — no wrapper div to avoid layout issues */}
      {/* Visibility toggle - renders in ReadingMode's focus sheet or as a floating button */}
      <button
        class={`annotation-toggle-btn${visible ? ' active' : ''}`}
        onClick={toggleVisible}
        aria-label={visible ? 'Hide annotations' : 'Show annotations'}
        title={visible ? 'Hide annotations' : 'Show annotations'}
      >
        📝
      </button>

      {/* Annotation highlights overlay */}
      {renderHighlights()}

      {/* Create popup */}
      {showCreate && selectionRange && (
        <div class="annotation-create-popup">
          <h4>Add Annotation</h4>
          <textarea
            value={noteText}
            onInput={e => setNoteText((e.target as HTMLTextAreaElement).value)}
            placeholder="Write a note..."
            rows={3}
            class="annotation-note-input"
            autoFocus
          />
          <div class="annotation-color-picker">
            {COLORS.map(c => (
              <button
                key={c.key}
                class={`annotation-color-swatch${selectedColor === c.key ? ' active' : ''}`}
                style={{ '--swatch-color': c.marker }}
                onClick={() => setSelectedColor(c.key)}
                aria-label={c.key}
              />
            ))}
          </div>
          <label class="annotation-share-toggle">
            <input type="checkbox" checked={shareWithAuthor} onChange={() => setShareWithAuthor(!shareWithAuthor)} />
            Share with author
          </label>
          <div class="annotation-actions">
            <button class="annotation-btn-save" onClick={handleCreate} disabled={saving || !noteText.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button class="annotation-btn-cancel" onClick={() => { setShowCreate(false); setSelectionRange(null); window.getSelection()?.removeAllRanges(); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Annotation detail popup */}
      {renderAnnotationDetail()}

      {/* Annotation list sidebar (visible toggle) */}
      {visible && annotations.length > 0 && (
        <div class="annotation-sidebar">
          <h4>Your Annotations ({annotations.length})</h4>
          {annotations.map(ann => {
            const colorDef = COLORS.find(c => c.key === ann.color) || COLORS[0];
            return (
              <div
                key={ann.id}
                class={`annotation-sidebar-item${activeAnnotation === ann.id ? ' active' : ''}`}
                onClick={() => setActiveAnnotation(ann.id)}
              >
                <span class="annotation-sidebar-color" style={{ backgroundColor: colorDef.marker }} />
                <span class="annotation-sidebar-text">{ann.noteText || '(no text)'}</span>
                {ann.sharedWithAuthor && <span class="annotation-shared-badge-mini">Shared</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}