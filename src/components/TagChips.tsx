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
  /** Pre-selected tags (for edit mode) */
  initialTags?: Tag[];
  /** Called when the selected tags change */
  onChange?: (tags: Tag[]) => void;
}

export default function TagChips({ type, label, placeholder, initialTags = [], onChange }: TagChipsProps) {
  const [selected, setSelected] = useState<Tag[]>(initialTags);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<Tag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Notify parent of changes
  useEffect(() => {
    onChange?.(selected);
  }, [selected]);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tags?type=${type}&name=${encodeURIComponent(q)}&limit=8`);
        if (res.ok) {
          const tags = await res.json();
          setSuggestions(tags.filter((t: Tag) => !selected.some(s => s.id === t.id)));
        }
      } catch {
        // Silently fail — network errors don't break the input
      }
    }, 300);
  }, [type, selected]);

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

  function addTag(tag: Tag) {
    if (!selected.some(t => t.id === tag.id)) {
      setSelected(prev => [...prev, tag]);
    }
    setInputValue('');
    setSuggestions([]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  function removeTag(id: number) {
    setSelected(prev => prev.filter(t => t.id !== id));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Backspace' && inputValue === '' && selected.length > 0) {
      // Remove last tag on backspace with empty input
      setSelected(prev => prev.slice(0, -1));
    } else if (e.key === 'Enter' && !isComposing) {
      e.preventDefault();
      if (inputValue.trim()) {
        // Create a new freeform tag if type allows it
        const trimmed = inputValue.trim();
        // For freeform, character, relationship types — allow free entry
        // For fandom, require selection from suggestions
        if (type === 'freeform' || type === 'character' || type === 'relationship') {
          // Check if it matches an existing suggestion
          const match = suggestions.find(s => s.name.toLowerCase() === trimmed.toLowerCase());
          if (match) {
            addTag(match);
          } else {
            // Create as new — server will handle tag creation
            // Use negative temp IDs to indicate new tags
            const tempId = -Date.now();
            addTag({ id: tempId, name: trimmed });
          }
        }
        // fandom requires selection from dropdown (no free entry)
        if (type === 'fandom') {
          const match = suggestions.find(s => s.name.toLowerCase() === trimmed.toLowerCase());
          if (match) {
            addTag(match);
          }
          // If no match, do nothing — user must select from suggestions
        }
      }
    }
  }

  return (
    <div class="tag-chips-field" ref={wrapperRef}>
      <label class="tag-chips-label">{label}</label>
      <div class="tag-chips-input-wrapper" onClick={() => inputRef.current?.focus()}>
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
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div class="tag-chips-dropdown" role="listbox">
          {suggestions.map(tag => (
            <button
              type="button"
              class="tag-chips-suggestion"
              role="option"
              key={tag.id}
              onClick={() => addTag(tag)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}
      {/* Hidden input for form submission */}
      {selected.map(tag => (
        <input type="hidden" name={`tag_${type}`} value={tag.id} key={`hidden-${tag.id}`} />
      ))}
    </div>
  );
}