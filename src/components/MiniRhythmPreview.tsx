// Mini preview showing rhythm pattern - vertical lines at beat positions
interface MiniRhythmPreviewProps {
  beats: number[]; // Beat positions where notes occur
  bars: number; // Total bars for normalization
  width?: number;
  height?: number;
  color?: string;
  isSelected?: boolean;
  onClick?: () => void;
  label?: string;
}

export function MiniRhythmPreview({
  beats,
  bars,
  width = 80,
  height = 18,
  color = '#3b82f6',
  isSelected = false,
  onClick,
  label,
}: MiniRhythmPreviewProps) {
  const padding = 2;
  const innerWidth = width - padding * 2;
  const totalBeats = bars * 4; // 4 beats per bar
  const noteCount = beats.length;

  return (
    <div
      onClick={onClick}
      style={{
        width,
        height,
        background: isSelected ? `${color}22` : '#1a1a2a',
        border: `2px solid ${isSelected ? color : `${color}44`}`,
        borderRadius: 3,
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
        {/* Bar grid lines for reference */}
        {Array.from({ length: bars + 1 }, (_, i) => (
          <line
            key={`grid-${i}`}
            x1={padding + (i / bars) * innerWidth}
            y1={padding}
            x2={padding + (i / bars) * innerWidth}
            y2={height - padding}
            stroke="#333"
            strokeWidth={i === 0 ? 0.5 : 0.3}
          />
        ))}
        {/* Notes as thin vertical lines at their beat positions */}
        {noteCount > 0 ? (
          beats.map((beat, i) => {
            const x = padding + (beat / totalBeats) * innerWidth;
            // Thin line (2px wide) at exact beat position
            return (
              <line
                key={i}
                x1={x}
                y1={padding + 1}
                x2={x}
                y2={height - padding - 1}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
              />
            );
          })
        ) : (
          // Empty - show dashed line
          <line
            x1={padding}
            y1={height / 2}
            x2={width - padding}
            y2={height / 2}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="3,3"
            opacity={0.4}
          />
        )}
      </svg>
    </div>
  );
}
