import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

/**
 * TagCluster — displays work tags grouped by type in a visual hierarchy.
 * Each tag is a clickable chip linking to the browse page filtered by that tag.
 *
 * Visual order: Relationships → Characters → Fandom → Additional Tags → Rating → Warnings → Category
 * Relationships get a distinct accent border; characters get a subtle highlight.
 */

interface ClusterTag {
  id: number;
  name: string;
  type: string; // 'fandom' | 'character' | 'relationship' | 'freeform' | 'rating' | 'warning' | 'category'
}

interface TagClusterProps {
  tags: ClusterTag[];
  /** Heading text above the cluster (default: "Tags") */
  heading?: string;
  /** Whether to render in compact mode (reading page) vs sidebar mode (work detail) */
  compact?: boolean;
}

// Display order for tag groups (matches AO3 convention with relationships first)
const GROUP_ORDER = [
  { type: 'relationship', label: 'Relationships', cssClass: 'tag-type-relationship' },
  { type: 'character', label: 'Characters', cssClass: 'tag-type-character' },
  { type: 'fandom', label: 'Fandom', cssClass: 'tag-type-fandom' },
  { type: 'freeform', label: 'Additional Tags', cssClass: 'tag-type-freeform' },
  { type: 'rating', label: 'Rating', cssClass: 'tag-type-rating' },
  { type: 'warning', label: 'Warnings', cssClass: 'tag-type-warning' },
  { type: 'category', label: 'Category', cssClass: 'tag-type-category' },
];

export default function TagCluster({ tags, heading = 'Tags', compact = false }: TagClusterProps) {
  // Group tags by type
  const grouped: Record<string, ClusterTag[]> = {};
  for (const tag of tags) {
    if (!grouped[tag.type]) grouped[tag.type] = [];
    grouped[tag.type].push(tag);
  }

  // Filter to only groups that have tags, in display order
  const visibleGroups = GROUP_ORDER.filter(g => grouped[g.type]?.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <div class={`tag-cluster${compact ? ' tag-cluster--compact' : ''}`}>
      <h4 class="tag-cluster__heading">{heading}</h4>
      {visibleGroups.map(group => {
        const groupTags = grouped[group.type];
        return (
          <div class="tag-cluster__group" key={group.type}>
            <span class="tag-cluster__label">{group.label}:</span>
            <div class="tag-cluster__chips">
              {groupTags.map(tag => (
                <a
                  href={`/tags?type=${tag.type}&q=${encodeURIComponent(tag.name)}`}
                  class={`tag-cluster__chip ${group.cssClass}`}
                  key={tag.id}
                  title={`${tag.name} (${group.label})`}
                >
                  {tag.name}
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}