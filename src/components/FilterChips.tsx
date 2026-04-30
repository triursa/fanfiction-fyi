import { h } from 'preact';
import { useRef } from 'preact/hooks';

/**
 * FilterChips — Horizontal scrolling row of M3 Filter Chips for search facets.
 * Supports: tag type filters, completion status, and word count ranges.
 */

interface FilterState {
  type: string;
  complete: string; // '' | '1' | '0'
  word_min: number;
  word_max: number;
}

interface FilterChipsProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

const TYPE_CHIPS = [
  { value: '', label: 'All' },
  { value: 'fandom', label: 'Fandom' },
  { value: 'character', label: 'Characters' },
  { value: 'relationship', label: 'Relationships' },
  { value: 'freeform', label: 'Freeform' },
  { value: 'rating', label: 'Rating' },
  { value: 'warning', label: 'Warnings' },
  { value: 'category', label: 'Category' },
];

const STATUS_CHIPS = [
  { value: '', label: 'Any Status' },
  { value: '1', label: 'Complete' },
  { value: '0', label: 'WIP' },
];

const WORD_CHIPS = [
  { value: { min: 0, max: 0 }, label: 'Any Length' },
  { value: { min: 0, max: 10000 }, label: '< 10k' },
  { value: { min: 10000, max: 50000 }, label: '10k–50k' },
  { value: { min: 50000, max: 100000 }, label: '50k–100k' },
  { value: { min: 100000, max: 0 }, label: '100k+' },
];

export default function FilterChips({ filters, onChange }: FilterChipsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function handleTypeChange(value: string) {
    onChange({ ...filters, type: value });
  }

  function handleStatusChange(value: string) {
    onChange({ ...filters, complete: value });
  }

  function handleWordChange(min: number, max: number) {
    onChange({ ...filters, word_min: min, word_max: max });
  }

  // Determine active word chip
  const activeWordChip = WORD_CHIPS.findIndex(w =>
    w.value.min === filters.word_min && w.value.max === filters.word_max
  );

  return (
    <div class="filter-chips-container">
      {/* Tag Type Filter Row */}
      <div class="filter-row">
        <span class="filter-row__label">Type</span>
        <div class="filter-row__chips" ref={scrollRef}>
          {TYPE_CHIPS.map(chip => (
            <button
              type="button"
              class={`filter-chip${filters.type === chip.value ? ' filter-chip--active' : ''}`}
              onClick={() => handleTypeChange(chip.value)}
              aria-pressed={filters.type === chip.value}
              key={chip.value}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Status Filter Row */}
      <div class="filter-row">
        <span class="filter-row__label">Status</span>
        <div class="filter-row__chips">
          {STATUS_CHIPS.map(chip => (
            <button
              type="button"
              class={`filter-chip${filters.complete === chip.value ? ' filter-chip--active' : ''}`}
              onClick={() => handleStatusChange(chip.value)}
              aria-pressed={filters.complete === chip.value}
              key={chip.value}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Word Count Filter Row */}
      <div class="filter-row">
        <span class="filter-row__label">Length</span>
        <div class="filter-row__chips">
          {WORD_CHIPS.map((chip, i) => (
            <button
              type="button"
              class={`filter-chip${activeWordChip === i ? ' filter-chip--active' : ''}`}
              onClick={() => handleWordChange(chip.value.min, chip.value.max)}
              aria-pressed={activeWordChip === i}
              key={i}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}