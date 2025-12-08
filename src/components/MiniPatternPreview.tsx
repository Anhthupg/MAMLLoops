import { useMemo } from 'react';
import type { NoteEvent } from '../types';

interface MiniPatternPreviewProps {
  pattern: NoteEvent[];
  bars: number;
  width?: number;
  height?: number;
  color?: string;
  isSelected?: boolean;
  onClick?: () => void;
  label?: string;
}

// Convert note string to MIDI pitch for positioning
function noteToPitch(note: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
  };
  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return 60;
  const noteName = match[1];
  const octave = parseInt(match[2]);
  return (octave + 1) * 12 + noteMap[noteName];
}

export function MiniPatternPreview({
  pattern,
  bars,
  width = 40,
  height = 20,
  color = '#4ade80',
  isSelected = false,
  onClick,
  label,
}: MiniPatternPreviewProps) {
  // Debug log
  console.log('[MiniPatternPreview] Rendering with pattern:', pattern?.length, 'notes, bars:', bars, 'color:', color);

  // Calculate note positions - simplified grid visualization
  const notePositions = useMemo(() => {
    if (!pattern || pattern.length === 0) {
      console.log('[MiniPatternPreview] Empty pattern!');
      return [];
    }
    console.log('[MiniPatternPreview] Calculating positions for', pattern.length, 'notes');

    const beatsPerBar = 4;
    const totalBeats = bars * beatsPerBar;
    const padding = 3;
    const innerWidth = width - padding * 2;
    const innerHeight = height - padding * 2;

    // Find pitch range for this pattern - use fixed range for consistency
    const pitches = pattern.map(n => noteToPitch(n.note));
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    // Use a minimum range of 24 semitones (2 octaves) for visual clarity
    const pitchRange = Math.max(maxPitch - minPitch, 24);
    const centerPitch = (minPitch + maxPitch) / 2;
    const effectiveMinPitch = centerPitch - pitchRange / 2;

    return pattern.map(note => {
      const pitch = noteToPitch(note.note);
      // X position based on time
      const x = padding + (note.time / totalBeats) * innerWidth;
      // Y position based on pitch (inverted - high notes at top)
      const pitchNorm = Math.max(0, Math.min(1, (pitch - effectiveMinPitch) / pitchRange));
      const y = padding + (1 - pitchNorm) * (innerHeight - 4) + 1;

      // Duration affects width
      const durationBeats = note.duration === '32n' ? 0.125 :
                           note.duration === '16n' ? 0.25 :
                           note.duration === '8n' ? 0.5 :
                           note.duration === '4n' ? 1 :
                           note.duration === '2n' ? 2 :
                           note.duration === '1n' ? 4 : 0.5;
      const noteWidth = Math.max(3, (durationBeats / totalBeats) * innerWidth * 0.9);

      return { x, y, width: noteWidth };
    });
  }, [pattern, bars, width, height]);

  return (
    <div
      onClick={onClick}
      style={{
        width,
        height,
        background: isSelected ? `${color}22` : '#1a1a2e',
        border: `1px solid ${isSelected ? color : '#444'}`,
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
      }}
      title={label || `${pattern.length} notes`}
    >
      {/* Grid lines for visual reference */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Vertical beat lines */}
        {Array.from({ length: bars * 4 + 1 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={2 + (i / (bars * 4)) * (width - 4)}
            y1={2}
            x2={2 + (i / (bars * 4)) * (width - 4)}
            y2={height - 2}
            stroke={i % 4 === 0 ? '#333' : '#222'}
            strokeWidth={i % 4 === 0 ? 0.5 : 0.25}
          />
        ))}

        {/* Notes */}
        {notePositions.map((pos, i) => (
          <rect
            key={i}
            x={pos.x}
            y={pos.y}
            width={Math.max(3, pos.width)}
            height={3}
            fill={color}
            opacity={isSelected ? 1 : 0.9}
            rx={1}
          />
        ))}
      </svg>

      {/* Show note count if pattern exists */}
      {pattern.length > 0 && (
        <span style={{
          position: 'absolute',
          bottom: 0,
          right: 1,
          fontSize: 6,
          color: '#666',
          fontFamily: 'monospace',
          lineHeight: 1,
        }}>
          {pattern.length}
        </span>
      )}

      {/* Show label if no pattern */}
      {pattern.length === 0 && (
        <span style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          fontSize: 7,
          color: '#555',
          fontFamily: 'monospace',
        }}>
          {label || '—'}
        </span>
      )}
    </div>
  );
}

// Dropdown-style pattern selector with previews
interface PatternSelectorProps {
  variations: NoteEvent[][];
  currentVariation: number;
  bars: number;
  color: string;
  onSelect: (variation: number) => void;
}

export function PatternSelector({
  variations,
  currentVariation,
  bars,
  color,
  onSelect,
}: PatternSelectorProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      background: '#0a0a0f',
      padding: 4,
      borderRadius: 4,
      border: '1px solid #333',
      maxHeight: 200,
      overflowY: 'auto',
    }}>
      {variations.map((pattern, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{
            fontSize: 9,
            color: i === currentVariation ? color : '#666',
            fontFamily: 'monospace',
            width: 12,
            textAlign: 'right',
          }}>
            {i + 1}
          </span>
          <MiniPatternPreview
            pattern={pattern}
            bars={bars}
            width={50}
            height={16}
            color={color}
            isSelected={i === currentVariation}
            onClick={() => onSelect(i)}
          />
        </div>
      ))}
    </div>
  );
}
