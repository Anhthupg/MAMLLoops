import type { NoteEvent } from '../types';

// Combined preview showing pitch (Y position), rhythm (X position), and intensity (bar height/opacity)
interface CombinedPatternPreviewProps {
  pattern: NoteEvent[];
  bars: number;
  width?: number;
  height?: number;
  color?: string;
  label?: string;
}

// Convert note string to MIDI pitch number
function noteToPitch(note: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
  };
  const match = note.match(/^([A-G][#b]?)(\d+)$/);
  if (!match) return 60; // Default to C4
  const [, noteName, octave] = match;
  return noteMap[noteName] + (parseInt(octave) + 1) * 12;
}

export function CombinedPatternPreview({
  pattern,
  bars,
  width: providedWidth,
  height = 50,
  color = '#4ade80',
  label,
}: CombinedPatternPreviewProps) {
  // Width scales with bars: 14px per bar, min 56px
  const width = providedWidth ?? Math.max(56, bars * 14);
  const padding = 4;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const totalBeats = bars * 4;

  // Get pitch range - use a fixed reference range for consistent visualization
  const pitches = pattern.map(n => noteToPitch(n.note));
  const actualMin = pitches.length > 0 ? Math.min(...pitches) : 60;
  const actualMax = pitches.length > 0 ? Math.max(...pitches) : 72;
  const actualRange = actualMax - actualMin;

  // If all notes are same pitch or very close, center them and use fixed range
  // Otherwise, add padding around the actual range
  const minPitch = actualRange < 6 ? actualMin - 6 : actualMin - 2;
  const maxPitch = actualRange < 6 ? actualMax + 6 : actualMax + 2;
  const pitchRange = maxPitch - minPitch;

  return (
    <div
      style={{
        width,
        height,
        background: '#0a0a12',
        border: `2px solid ${color}44`,
        borderRadius: 4,
        position: 'relative',
        overflow: 'hidden',
      }}
      title={label || 'Current pattern'}
    >
      {/* Grid lines */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Vertical grid lines (beats) */}
        {Array.from({ length: bars + 1 }, (_, i) => (
          <line
            key={`v-${i}`}
            x1={padding + (i / bars) * innerWidth}
            y1={padding}
            x2={padding + (i / bars) * innerWidth}
            y2={height - padding}
            stroke="#333"
            strokeWidth={i === 0 ? 1 : 0.5}
          />
        ))}
        {/* Horizontal center line */}
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#333"
          strokeWidth={0.5}
        />

        {/* Notes */}
        {pattern.length > 0 ? (
          pattern.map((note, i) => {
            const pitch = noteToPitch(note.note);
            const time = note.time;
            const velocity = note.velocity ?? 0.8;

            // X position based on time
            const x = padding + (time / totalBeats) * innerWidth;

            // Y position based on pitch (higher pitch = higher on screen)
            const normalizedPitch = (pitch - minPitch) / pitchRange;
            const y = height - padding - normalizedPitch * innerHeight;

            // Bar width based on duration
            const durationBeats = note.duration === '4n' ? 1 :
                                  note.duration === '8n' ? 0.5 :
                                  note.duration === '16n' ? 0.25 :
                                  note.duration === '32n' ? 0.125 : 0.5;
            const noteWidth = Math.max(3, (durationBeats / totalBeats) * innerWidth);

            // Height and opacity based on velocity
            const barHeight = 4 + velocity * 8;

            return (
              <rect
                key={i}
                x={x}
                y={y - barHeight / 2}
                width={noteWidth}
                height={barHeight}
                fill={color}
                opacity={0.4 + velocity * 0.6}
                rx={1}
              />
            );
          })
        ) : (
          // Empty state
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fill="#444"
            fontSize={10}
          >
            No notes
          </text>
        )}
      </svg>

      {/* Labels */}
      <div style={{
        position: 'absolute',
        bottom: 2,
        left: 4,
        fontSize: 7,
        color: '#666',
        fontFamily: 'monospace',
      }}>
        {pattern.length}n
      </div>
      <div style={{
        position: 'absolute',
        top: 2,
        right: 4,
        fontSize: 7,
        color: '#666',
        fontFamily: 'monospace',
      }}>
        {bars}b
      </div>
    </div>
  );
}
