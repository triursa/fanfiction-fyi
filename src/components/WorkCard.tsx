import { h } from 'preact';

/**
 * WorkCard — M3 Outlined Card for search/browse results.
 * Displays work title, author, summary, meta info, and color-coded tag chips.
 */

interface WorkTag {
  id: number;
  name: string;
  type: string; // fandom | character | relationship | freeform | rating | warning | category
}

interface WorkCardProps {
  id: number;
  title: string;
  pseud_name?: string | null;
  summary?: string | null;
  word_count: number;
  complete: number;
  published_at?: string | null;
  tags: WorkTag[];
}

// Tag type display order and metadata
const TAG_META: Record<string, { label: string; cssClass: string; icon: string }> = {
  fandom:       { label: 'Fandom',       cssClass: 'work-tag--fandom',       icon: '📚' },
  character:    { label: 'Characters',   cssClass: 'work-tag--character',    icon: '👤' },
  relationship: { label: 'Relationships', cssClass: 'work-tag--relationship', icon: '❤️' },
  freeform:    { label: 'Tags',         cssClass: 'work-tag--freeform',     icon: '🏷️' },
  rating:       { label: 'Rating',       cssClass: 'work-tag--rating',       icon: '⭐' },
  warning:      { label: 'Warnings',     cssClass: 'work-tag--warning',      icon: '⚠️' },
  category:     { label: 'Category',     cssClass: 'work-tag--category',     icon: '📂' },
};

const TAG_DISPLAY_ORDER = ['rating', 'warning', 'category', 'fandom', 'relationship', 'character', 'freeform'];

export default function WorkCard({ id, title, pseud_name, summary, word_count, complete, published_at, tags }: WorkCardProps) {
  // Group and order tags
  const grouped: Record<string, WorkTag[]> = {};
  for (const tag of tags) {
    if (!grouped[tag.type]) grouped[tag.type] = [];
    grouped[tag.type].push(tag);
  }

  const visibleGroups = TAG_DISPLAY_ORDER.filter(type => grouped[type]?.length > 0);

  // Truncate summary
  const truncatedSummary = summary
    ? (summary.length > 280 ? summary.slice(0, 280) + '…' : summary)
    : null;

  // Format date
  const dateStr = published_at
    ? new Date(published_at + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Unpublished';

  // Word count formatting
  const formattedWords = word_count?.toLocaleString() ?? '0';

  return (
    <article class="work-card">
      <div class="work-card__header">
        <a href={`/works/${id}`} class="work-card__title">{title}</a>
        {pseud_name && <span class="work-card__author">by {pseud_name}</span>}
      </div>

      {truncatedSummary && (
        <p class="work-card__summary">{truncatedSummary}</p>
      )}

      <div class="work-card__meta">
        <span class="work-card__meta-item">{formattedWords} words</span>
        <span class="work-card__meta-sep">·</span>
        <span class="work-card__meta-item">{complete ? 'Complete' : 'WIP'}</span>
        <span class="work-card__meta-sep">·</span>
        <span class="work-card__meta-item">{dateStr}</span>
      </div>

      {visibleGroups.length > 0 && (
        <div class="work-card__tags">
          {visibleGroups.map(type => {
            const meta = TAG_META[type];
            const groupTags = grouped[type];
            return (
              <span class={`work-tag-group ${meta.cssClass}`} key={type}>
                {groupTags.map((tag, i) => (
                  <a
                    href={`/search?q=&type=${tag.type}`}
                    class={`work-tag ${meta.cssClass}`}
                    key={tag.id}
                    title={`${tag.name} (${meta.label})`}
                  >
                    {tag.name}
                  </a>
                ))}
              </span>
            );
          })}
        </div>
      )}
    </article>
  );
}