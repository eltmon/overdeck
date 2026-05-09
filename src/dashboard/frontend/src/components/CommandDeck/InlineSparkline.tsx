interface InlineSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  className?: string;
}

export function InlineSparkline({
  data,
  width = 60,
  height = 12,
  color = 'var(--primary)',
  fillOpacity = 0.2,
  className,
}: InlineSparklineProps) {
  if (!data || data.length === 0) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x},${y}`;
  });

  const polylinePoints = points.join(' ');
  const fillPoints = `0,${height} ${polylinePoints} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <polygon points={fillPoints} fill={color} fillOpacity={fillOpacity} />
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
