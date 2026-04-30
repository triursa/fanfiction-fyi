import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { h } from 'preact';

interface Tag {
  id: number;
  name: string;
}

interface TagChipsProps {
  /** Tag type for autocomplete lookups: fandom, character, relationship, freeform */
  type: string;
  /** Label displayed above the input */
  label: string;
  /** Placeholder text for the input */
  placeholder: string;
  /** Maximum number of tags allowed (0 = unlimited) */
  maxTags?: number;
  /** Pre-selected tags (for edit mode) */
  initialTags?: Tag[];
  /** Called when the selected tags change */
  onChange?: (tags: Tag[]) => void;
}

/** DISPLAY_ORDER defines the visual priority order for tag types in the cluster */
const TAG_TYPE_ORDER = ['relationship', 'character', 'fandom', 'freeform', 'rating', 'warning', 'category'];

export default function TagChips({ type, label, placeholder, maxTags = 0, initialTags = [], onChange }: TagChipsProps) {
  const [selected, setSelected] = useState<Tag[]>(initialTags);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const atMaxTags = maxTags > 0 && selected.length >= maxTags;

  // Notify parent of changes
  useEffect(() => {
    onChange?.(selected);
  }, [selected]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setHighlightIndex(-1);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setSuggestions([]);
      setHighlightIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?type=${type}&name=${encodeURIComponent(q)}&limit=8`);
        if (res.ok) {
          const tags = await res.json();
          const filtered = tags.filter((t: Tag) => !selected.some(s => s.id === t.id));
          setSuggestions(filtered);
          setHighlightIndex(filtered.length > 0 ? 0 : -1);
        }
      } catch {
        // Silently fail — network errors don't break the input
      }
    }, 300);
  }, [type, selected]);

  function commitInput() {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Check if it matches an existing suggestion exactly
    const match = suggestions.find(s => s.name.toLowerCase() === trimmed.toLowerCase());

    if (type === 'fandom') {
      // Fandom: require exact match from dropdown (no free entry)
      if (match) {
        addTag(match);
      }
      // If no match, do nothing — user must select from suggestions
    } else {
      // freeform, character, relationship: allow free entry
      if (match) {
        addTag(match);
      } else {
        // Create as new — server will handle tag creation
        // Use negative temp IDs to indicate new tags
        const tempId = -Date.now();
        addTag({ id: tempId, name: trimmed });
      }
    }
  }

  function addTag(tag: Tag) {
    if (atMaxTags) return;
    if (!selected.some(t => t.id === tag.id)) {
      setSelected(prev => [...prev, tag]);
    }
    setInputValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightIndex(-1);
    inputRef.current?.focus();
  }

  function removeTag(id: number) {
    setSelected(prev => prev.filter(t => t.id !== id));
    inputRef.current?.focus();
  }

  function handleInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    setInputValue(value);
    if (!isComposing) {
      fetchSuggestions(value);
      setShowSuggestions(true);
    }
  }

  function handleCompositionStart() {
    setIsComposing(true);
  }

  function handleCompositionEnd(e: Event) {
    setIsComposing(false);
    const value = (e.target as HTMLInputElement).value;
    setInputValue(value);
    fetchSuggestions(value);
    setShowSuggestions(true);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isComposing) return;

    // Arrow keys for dropdown navigation
    if (e.key === 'ArrowDown' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIndex(prev => Math.min(prev + 1, suggestions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' && showSuggestions && suggestions.length > 0) {
      e.preventDefault();
      setHighlightIndex(prev => Math.max(prev - 1, 0));
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setShowSuggestions(false);
      setHighlightIndex(-1);
      return;
    }

    // Enter: tokenize input or select highlighted suggestion
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showSuggestions && highlightIndex >= 0 && highlightIndex < suggestions.length) {
        addTag(suggestions[highlightIndex]);
      } else {
        commitInput();
      }
      return;
    }

    // Tab: tokenize input (if there's text) or move focus
    if (e.key === 'Tab') {
      if (inputValue.trim()) {
        e.preventDefault();
        if (showSuggestions && highlightIndex >= 0 && highlightIndex < suggestions.length) {
          addTag(suggestions[highlightIndex]);
        } else {
          commitInput();
        }
      }
      return;
    }

    // Comma: tokenize and clear (comma itself is not part of the tag)
    if (e.key === ',') {
      e.preventDefault();
      commitInput();
      return;
    }

    // Backspace: remove last tag when input is empty
    if (e.key === 'Backspace' && inputValue === '' && selected.length > 0) {
      setSelected(prev => prev.slice(0, -1));
      return;
    }
  }

  /** Highlight matching substring in suggestion text */
  function renderSuggestion(name: string, query: string) {
    if (!query) return name;
    const idx = name.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return name;
    return (
      <>
        {name.slice(0, idx)}
        <strong>{name.slice(idx, idx + query.length)}</strong>
        {name.slice(idx + query.length)}
      </>
    );
  }

  return (
    <div class="tag-chips-field" ref={wrapperRef}>
      <label class="tag-chips-label">
        {label}
        {maxTags > 0 && <span class="tag-chips-count">{selected.length}/{maxTags}</span>}
      </label>
      <div class={`tag-chips-input-wrapper${atMaxTags ? ' tag-chips-at-max' : ''}`} onClick={() => inputRef.current?.focus()}>
        {selected.map(tag => (
          <span class="tag-chip" key={tag.id}>
            <span class="tag-chip-text">{tag.name}</span>
            <button
              type="button"
              class="tag-chip-remove"
              onClick={(e) => { e.stopPropagation(); removeTag(tag.id); }}
              aria-label={`Remove ${tag.name}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          class="tag-chips-input"
          placeholder={selected.length === 0 ? placeholder : ''}
          value={inputValue}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onFocus={() => { if (inputValue.length >= 2) setShowSuggestions(true); }}
          disabled={atMaxTags}
          aria-expanded={showSuggestions}
          aria-autocomplete="list"
          aria-controls={`${type}-tag-suggestions`}
          role="combobox"
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div class="tag-chips-dropdown" role="listbox" id={`${type}-tag-suggestions`}>
          {suggestions.map((tag, i) => (
            <button
              type="button"
              class={`tag-chips-suggestion${i === highlightIndex ? ' tag-chips-suggestion-highlighted' : ''}`}
              role="option"
              aria-selected={i === highlightIndex}
              key={tag.id}
              onClick={() => addTag(tag)}
              onMouseEnter={() => setHighlightIndex(i)}
            >
              {renderSuggestion(tag.name, inputValue)}
            </button>
          ))}
        </div>
      )}
      {/* Hidden inputs for form submission — split into tag_ids (existing) and tag_names (new) */}
      {selected.map(tag => {
        if (tag.id > 0) {
          return <input type="hidden" name={`tag_id`} value={tag.id} key={`id-${tag.id}`} />;
        } else {
          // New tags: output as JSON name+type pair
          return <input type="hidden" name={`tag_name`} value={JSON.stringify({ name: tag.name, type })} key={`name-${tag.id}`} />;
        }
      })}
    </div>
  );
}

/**
 * TagCluster — server-side Preact component for displaying tags grouped by type
 * on work detail and reading pages. Each tag links to the browse page filtered by that tag.
 */
export function getTagTypeOrder() {
  return TAG_TYPE_ORDER;
}