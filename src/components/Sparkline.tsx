import { h } from 'preact';

interface SparklineProps {
  data: { month: string; words: number }[];
  width?: number;
  height?: number;
}

export default function Sparkline({ data, width = 200, height = 40 }: SparklineProps) {
  if (!data.length) return null;

  const maxVal = Math.max(...data.map(d => d.words), 1);
  const padding = 2;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const step = data.length > 1 ? chartW / (data.length - 1) : chartW;

  const points = data.map((d, i) => ({
    x: padding + i * step,
    y: padding + chartH - (d.words / maxVal) * chartH,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Fill area under the line
  const areaD = `${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  return (
    <div class="sparkline-container">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--md-sys-color-primary, #7B8FA8)" stop-opacity="0.3" />
            <stop offset="100%" stop-color="var(--md-sys-color-primary, #7B8FA8)" stop-opacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#sparkline-grad)" />
        <path d={pathD} fill="none" stroke="var(--md-sys-color-primary, #7B8FA8)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
  );
}