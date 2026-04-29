import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

interface HeatmapProps {
  activity: Record<string, number>; // YYYY-MM-DD → count
  year?: number;
}

const CELL_SIZE = 12;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const WEEKS = 53;
const DAYS = 7;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getColor(count: number, maxCount: number): string {
  if (count === 0) return 'var(--md-sys-color-surface-container)';
  const ratio = maxCount > 0 ? count / maxCount : 0;
  if (ratio < 0.25) return 'var(--md-sys-color-primary-container, rgba(123,143,168,0.2))';
  if (ratio < 0.5) return 'var(--md-sys-color-primary, rgba(123,143,168,0.4))';
  if (ratio < 0.75) return 'var(--md-sys-color-primary, rgba(123,143,168,0.65))';
  return 'var(--md-sys-color-primary, rgba(123,143,168,0.9))';
}

export default function ActivityHeatmap({ activity, year }: HeatmapProps) {
  const currentYear = year ?? new Date().getFullYear();
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build grid data: 53 weeks × 7 days starting from Jan 1
  const startDate = new Date(currentYear, 0, 1);
  // Shift to Sunday start
  const startDay = startDate.getDay();
  const gridStart = new Date(currentYear, 0, 1 - startDay);

  const maxCount = Math.max(1, ...Object.values(activity));
  const cells: { date: string; count: number; week: number; day: number }[] = [];

  for (let week = 0; week < WEEKS; week++) {
    for (let day = 0; day < DAYS; day++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + week * 7 + day);
      const dateStr = d.toISOString().substring(0, 10);
      const count = activity[dateStr] || 0;
      if (d.getFullYear() === currentYear) {
        cells.push({ date: dateStr, count, week, day });
      }
    }
  }

  // Month labels positioning
  const monthPositions: { label: string; week: number }[] = [];
  let lastMonth = -1;
  for (const cell of cells) {
    const d = new Date(cell.date);
    const month = d.getMonth();
    if (month !== lastMonth && cell.day === 0) {
      monthPositions.push({ label: MONTH_LABELS[month], week: cell.week });
      lastMonth = month;
    }
  }

  const handleMouseEnter = (e: MouseEvent, cell: typeof cells[0]) => {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    const text = cell.count > 0
      ? `${cell.count} publication${cell.count > 1 ? 's' : ''} on ${cell.date}`
      : `No publications on ${cell.date}`;
    setTooltip({
      text,
      x: rect.left - containerRect.left + CELL_SIZE / 2,
      y: rect.top - containerRect.top - 8,
    });
  };

  const handleMouseLeave = () => setTooltip(null);

  const totalPublications = Object.values(activity).reduce((a, b) => a + b, 0);
  const activeDays = Object.values(activity).filter(v => v > 0).length;

  return (
    <div class="heatmap-container" ref={containerRef}>
      <div class="heatmap-header">
        <span class="heatmap-title">Activity</span>
        <span class="heatmap-summary">{totalPublications} publications in {activeDays} days</span>
      </div>
      <div class="heatmap-chart" style={{ position: 'relative' }}>
        <svg
          width={WEEKS * CELL_STEP + 30}
          height={DAYS * CELL_STEP + 20}
          style={{ overflow: 'visible' }}
        >
          {/* Day labels */}
          {DAY_LABELS.map((label, i) =>
            label ? (
              <text
                key={i}
                x={0}
                y={i * CELL_STEP + CELL_SIZE}
                fill="var(--md-sys-color-on-surface-variant)"
                font-size="9"
                font-family="Inter, sans-serif"
              >
                {label}
              </text>
            ) : null
          )}
          {/* Month labels */}
          {monthPositions.map((m, i) => (
            <text
              key={`m-${i}`}
              x={30 + m.week * CELL_STEP}
              y={-2}
              fill="var(--md-sys-color-on-surface-variant)"
              font-size="9"
              font-family="Inter, sans-serif"
            >
              {m.label}
            </text>
          ))}
          {/* Cells */}
          {cells.map((cell) => (
            <rect
              key={cell.date}
              x={30 + cell.week * CELL_STEP}
              y={cell.day * CELL_STEP}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={getColor(cell.count, maxCount)}
              onMouseEnter={(e: any) => handleMouseEnter(e, cell)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>
        {tooltip && (
          <div
            class="heatmap-tooltip"
            style={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
      <div class="heatmap-legend">
        <span class="heatmap-legend-label">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
          <svg key={i} width={CELL_SIZE} height={CELL_SIZE}>
            <rect
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={getColor(ratio * maxCount, maxCount)}
            />
          </svg>
        ))}
        <span class="heatmap-legend-label">More</span>
      </div>
    </div>
  );
}