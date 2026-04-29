import { h } from 'preact';

interface GenrePieProps {
  data: { name: string; count: number }[];
  size?: number;
}

const PALETTE = [
  '#7B8FA8', '#94A7BC', '#6B7D94', '#8FA3B8', '#A3B5C8',
  '#5F7289', '#8396AC', '#98ABBE', '#6E8398', '#B0C0D0',
];

export default function GenrePie({ data, size = 100 }: GenrePieProps) {
  if (!data.length) return null;

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  let cumulativeAngle = -90; // start from top
  const slices: { name: string; count: number; startAngle: number; endAngle: number; color: string }[] = [];

  data.forEach((d, i) => {
    const angle = (d.count / total) * 360;
    slices.push({
      name: d.name,
      count: d.count,
      startAngle: cumulativeAngle,
      endAngle: cumulativeAngle + angle,
      color: PALETTE[i % PALETTE.length],
    });
    cumulativeAngle += angle;
  });

  function polarToCartesian(angle: number): { x: number; y: number } {
    const rad = (angle * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function arcPath(startAngle: number, endAngle: number): string {
    if (endAngle - startAngle >= 359.9) {
      // Full circle — draw two arcs
      const mid = startAngle + 180;
      const s1 = polarToCartesian(startAngle);
      const m = polarToCartesian(mid);
      const e = polarToCartesian(endAngle);
      return `M ${cx} ${cy} L ${s1.x} ${s1.y} A ${r} ${r} 0 1 1 ${m.x} ${m.y} A ${r} ${r} 0 1 1 ${e.x} ${e.y} Z`;
    }
    const s = polarToCartesian(startAngle);
    const e = polarToCartesian(endAngle);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y} Z`;
  }

  return (
    <div class="genre-pie-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s, i) => (
          <path
            key={i}
            d={arcPath(s.startAngle, s.endAngle)}
            fill={s.color}
            stroke="var(--md-sys-color-surface, #1a1a2e)"
            stroke-width="1"
          />
        ))}
      </svg>
      <div class="genre-pie-legend">
        {slices.map((s, i) => (
          <div key={i} class="genre-pie-legend-item">
            <span class="genre-pie-dot" style={{ background: s.color }} />
            <span class="genre-pie-label">{s.name}</span>
            <span class="genre-pie-count">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}