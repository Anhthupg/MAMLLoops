interface MiniIntensityPreviewProps {
  velocities: number[];
  width?: number;
  height?: number;
  color?: string;
  isSelected?: boolean;
  onClick?: () => void;
  label?: string;
  isRandom?: boolean;
}

export function MiniIntensityPreview({
  velocities,
  width = 48,
  height = 20,
  color = '#f472b6',
  isSelected = false,
  onClick,
  label,
  isRandom = false,
}: MiniIntensityPreviewProps) {
  const padding = 3;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const barCount = velocities.length;
  // Ensure minimum bar width of 3px for visibility
  const barWidth = Math.max(3, (innerWidth - Math.max(0, barCount - 1) * 1) / barCount);
  const gap = barCount > 1 ? Math.max(1, (innerWidth - barWidth * barCount) / (barCount - 1)) : 0;

  return (
    <div
      onClick={onClick}
      style={{
        width,
        height,
        background: isRandom ? 'rgba(139, 92, 246, 0.25)' : (isSelected ? `${color}22` : '#1a1a2e'),
        border: `1px solid ${isRandom ? '#8b5cf6' : (isSelected ? color : '#555')}`,
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      title={label}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Baseline reference line */}
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="#333"
          strokeWidth={0.5}
        />
        {isRandom ? (
          // Random icon - show question mark
          <text
            x={width / 2}
            y={height / 2 + 4}
            textAnchor="middle"
            fill="#a78bfa"
            fontSize={11}
            fontFamily="monospace"
            fontWeight="bold"
          >
            ?
          </text>
        ) : (
          // Draw intensity bars with gradient effect
          velocities.map((velocity, i) => {
            const barHeight = Math.max(2, velocity * innerHeight);
            const x = padding + i * (barWidth + gap);
            const y = height - padding - barHeight;

            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
                opacity={0.5 + velocity * 0.5}
                rx={1}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}
