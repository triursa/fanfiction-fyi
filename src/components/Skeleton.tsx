import { h } from 'preact';

/**
 * Skeleton — M3-styled loading placeholder with shimmer animation.
 *
 * Variants:
 *   - text:    multi-line text block (default)
 *   - card:   card-sized rectangle (for work cards, browse items)
 *   - avatar:  circular avatar placeholder
 *   - circle:  generic circle (for icons, badges)
 *
 * Uses MD3 design tokens for colours and shape.
 * Shimmer animation defined in theme.css via @keyframes shimmer.
 */

interface SkeletonProps {
  variant?: 'text' | 'card' | 'avatar' | 'circle';
  width?: string;
  height?: string;
  lines?: number; // for text variant
  className?: string;
}

const VARIANT_STYLES: Record<string, { borderRadius: string; defaultWidth: string; defaultHeight: string }> = {
  text:   { borderRadius: 'var(--md-sys-shape-corner-small)',  defaultWidth: '100%', defaultHeight: '1em' },
  card:   { borderRadius: 'var(--md-sys-shape-corner-medium)', defaultWidth: '100%', defaultHeight: '200px' },
  avatar: { borderRadius: '50%',                              defaultWidth: '48px', defaultHeight: '48px' },
  circle: { borderRadius: '50%',                              defaultWidth: '40px', defaultHeight: '40px' },
};

export default function Skeleton({ variant = 'text', width, height, lines = 3, className }: SkeletonProps) {
  const vs = VARIANT_STYLES[variant] || VARIANT_STYLES.text;
  const w = width || vs.defaultWidth;
  const h = height || vs.defaultHeight;

  // For text variant, render multiple line blocks
  if (variant === 'text') {
    const lineElements = Array.from({ length: lines }, (_, i) => {
      const isLast = i === lines - 1;
      const lineWidth = isLast ? '60%' : '100%';
      return (
        <div
          class={`skeleton skeleton-line ${className || ''}`}
          style={{
            width: lineWidth,
            height: h,
            borderRadius: vs.borderRadius,
            marginBottom: '0.5em',
          }}
        />
      );
    });
    return <div class="skeleton-text-block">{lineElements}</div>;
  }

  // For card/variant, render a single block
  return (
    <div
      class={`skeleton ${className || ''}`}
      style={{
        width: w,
        height: h,
        borderRadius: vs.borderRadius,
      }}
      role="status"
      aria-label="Loading…"
    />
  );
}

/**
 * SkeletonCard — convenience wrapper that renders a work-card-shaped skeleton.
 * Matches the layout of WorkCard for seamless swap-in during loading.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <article class={`skeleton-card ${className || ''}`}>
      <div class="skeleton skeleton-card-title" />
      <div class="skeleton skeleton-card-author" />
      <div class="skeleton skeleton-card-summary" style={{ width: '90%' }} />
      <div class="skeleton skeleton-card-summary" style={{ width: '70%' }} />
      <div class="skeleton skeleton-card-meta" />
      <div class="skeleton skeleton-card-tags" />
    </article>
  );
}

/**
 * SkeletonChapter — skeleton for chapter content during initial page paint.
 * Matches the layout of the reading-chapter section.
 */
export function SkeletonChapter({ className }: { className?: string }) {
  return (
    <div class={`skeleton-chapter ${className || ''}`}>
      <div class="skeleton skeleton-chapter-number" />
      <div class="skeleton skeleton-chapter-title" />
      <div class="skeleton skeleton-chapter-meta" />
      <div class="skeleton-chapter-prose">
        <div class="skeleton skeleton-prose-line" style={{ width: '100%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '100%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '85%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '100%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '60%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '100%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '90%' }} />
        <div class="skeleton skeleton-prose-line" style={{ width: '75%' }} />
      </div>
    </div>
  );
}

/**
 * SkeletonProfile — skeleton for pseud/profile page loading state.
 * Matches the layout of PseudPortfolio's profile header.
 */
export function SkeletonProfile({ className }: { className?: string }) {
  return (
    <div class={`skeleton-profile ${className || ''}`}>
      <div class="skeleton skeleton-profile-banner" />
      <div class="skeleton-profile-header">
        <div class="skeleton skeleton-profile-avatar" />
        <div class="skeleton-profile-info">
          <div class="skeleton skeleton-profile-name" />
          <div class="skeleton skeleton-profile-desc" style={{ width: '80%' }} />
          <div class="skeleton skeleton-profile-desc" style={{ width: '50%' }} />
        </div>
      </div>
      <div class="skeleton-profile-stats">
        <div class="skeleton skeleton-profile-stat" />
        <div class="skeleton skeleton-profile-stat" />
        <div class="skeleton skeleton-profile-stat" />
        <div class="skeleton skeleton-profile-stat" />
      </div>
    </div>
  );
}