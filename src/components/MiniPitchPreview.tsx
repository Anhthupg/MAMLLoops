// Mini preview showing pitch contour (high/low dots)
interface MiniPitchPreviewProps {
  offsets: number[]; // Pitch offsets from base note
  width?: number;
  height?: number;
  color?: string;
  isRandom?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  label?: string;
}

export function MiniPitchPreview({
  offsets,
  width = 24,
  height = 14,
  color = '#4ade80',
  isRandom = false,
  isSelected = false,
  onClick,
  label,
}: MiniPitchPreviewProps) {
  const padding = 2;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const noteCount = offsets.length;

  // Find min/max for normalization
  const minOffset = Math.min(...offsets, -6);
  const maxOffset = Math.max(...offsets, 6);
  const range = Math.max(1, maxOffset - minOffset);

  return (
    <div
      onClick={onClick}
      style={{
        width,
        height,
        background: isRandom ? 'rgba(74, 222, 128, 0.15)' : (isSelected ? `${color}22` : '#1a2a1a'),
        border: `2px solid ${isRandom ? '#4ade80' : (isSelected ? color : `${color}44`)}`,
        borderRadius: 2,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: isSelected ? `0 0 6px ${color}66` : 'none',
      }}
      title={label}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {isRandom ? (
          // Random icon - show "?"
          <text
            x={width / 2}
            y={height / 2 + 3}
            textAnchor="middle"
            fill={color}
            fontSize={9}
            fontFamily="monospace"
            fontWeight="bold"
          >
            ?
          </text>
        ) : noteCount > 0 ? (
          // Draw pitch contour as connected dots
          <>
            {/* Line connecting dots */}
            <polyline
              points={offsets.map((offset, i) => {
                const x = padding + (i / Math.max(1, noteCount - 1)) * innerWidth;
                const normalizedY = 1 - (offset - minOffset) / range;
                const y = padding + normalizedY * innerHeight;
                return `${x},${y}`;
              }).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={1}
              opacity={0.5}
            />
            {/* Dots at each point */}
            {offsets.map((offset, i) => {
              const x = padding + (i / Math.max(1, noteCount - 1)) * innerWidth;
              const normalizedY = 1 - (offset - minOffset) / range;
              const y = padding + normalizedY * innerHeight;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={1.5}
                  fill={color}
                />
              );
            })}
          </>
        ) : (
          // Empty - show flat line
          <line
            x1={padding}
            y1={height / 2}
            x2={width - padding}
            y2={height / 2}
            stroke={color}
            strokeWidth={1}
            opacity={0.3}
          />
        )}
      </svg>
    </div>
  );
}
