import { useState, useCallback, useRef } from 'react';
import type { Loop, NoteEvent } from '../types';
import './IntensityView.css';

// 9 intensity presets + 1 random
const INTENSITY_PRESETS = [
  { id: 1, name: 'Whisper', velocities: [0.2, 0.2, 0.2, 0.2] },
  { id: 2, name: 'Soft', velocities: [0.3, 0.35, 0.3, 0.35] },
  { id: 3, name: 'Gentle', velocities: [0.4, 0.45, 0.5, 0.45] },
  { id: 4, name: 'Medium', velocities: [0.6, 0.65, 0.6, 0.65] },
  { id: 5, name: 'Strong', velocities: [0.7, 0.75, 0.8, 0.75] },
  { id: 6, name: 'Loud', velocities: [0.85, 0.9, 0.85, 0.9] },
  { id: 7, name: 'Crescendo', velocities: [0.3, 0.5, 0.7, 0.9] },
  { id: 8, name: 'Decrescendo', velocities: [0.9, 0.7, 0.5, 0.3] },
  { id: 9, name: 'Accent', velocities: [1.0, 0.5, 0.7, 0.5] },
];

export type IntensityViewMode = 'show' | 'edit' | 'hide';

interface IntensityViewProps {
  loop: Loop;
  mode: IntensityViewMode;
  onPatternChange?: (loopId: string, pattern: NoteEvent[]) => void;
  currentBar?: number;
}

export function IntensityView({ loop, mode, onPatternChange, currentBar = 0 }: IntensityViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  if (mode === 'hide' || loop.pattern.length === 0) {
    return null;
  }

  const beatsPerBar = 4;
  const totalBeats = loop.bars * beatsPerBar;
  const phase = (currentBar % loop.bars) / loop.bars;

  // Handle drag to adjust velocity
  const handleMouseDown = (index: number, e: React.MouseEvent) => {
    if (mode !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    setDraggingIndex(index);
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingIndex === null || mode !== 'edit' || !containerRef.current || !onPatternChange) return;

    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const height = rect.height;

    // Invert because Y increases downward
    const newVelocity = Math.max(0.1, Math.min(1.0, 1 - (relativeY / height)));

    const newPattern = [...loop.pattern];
    newPattern[draggingIndex] = { ...newPattern[draggingIndex], velocity: newVelocity };
    onPatternChange(loop.id, newPattern);
  }, [draggingIndex, mode, loop, onPatternChange]);

  const handleMouseUp = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  // Apply preset
  const applyPreset = (presetIndex: number) => {
    if (!onPatternChange) return;

    let newPattern: NoteEvent[];

    if (presetIndex === 0) {
      // Random preset
      newPattern = loop.pattern.map(note => ({
        ...note,
        velocity: 0.2 + Math.random() * 0.8
      }));
    } else {
      const preset = INTENSITY_PRESETS[presetIndex - 1];
      newPattern = loop.pattern.map((note, i) => ({
        ...note,
        velocity: preset.velocities[i % preset.velocities.length]
      }));
    }

    onPatternChange(loop.id, newPattern);
  };

  return (
    <div
      className={`intensity-view mode-${mode}`}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Playhead indicator */}
      <div
        className="intensity-playhead"
        style={{ left: `${phase * 100}%` }}
      />

      {/* Pattern bars with intensity behind */}
      <div className="intensity-bars">
        {loop.pattern.map((note, index) => {
          const position = (note.time / totalBeats) * 100;
          const velocity = note.velocity || 0.8;
          const barWidth = 100 / (totalBeats * 2); // Each bar takes 1/16th note width

          return (
            <div
              key={index}
              className={`intensity-bar-group ${draggingIndex === index ? 'dragging' : ''}`}
              style={{
                left: `${position}%`,
                width: `${barWidth}%`,
              }}
              onMouseDown={(e) => handleMouseDown(index, e)}
            >
              {/* Intensity bar (behind, same color but opaque) */}
              <div
                className="intensity-bar-bg"
                style={{
                  height: `${velocity * 100}%`,
                  backgroundColor: loop.color,
                  opacity: 0.3,
                }}
              />
              {/* MIDI bar (front) */}
              <div
                className="intensity-bar-fg"
                style={{
                  height: `${velocity * 100}%`,
                  backgroundColor: loop.color,
                }}
              />
              {/* Velocity indicator on hover/edit */}
              {mode === 'edit' && (
                <div className="velocity-indicator">
                  {Math.round(velocity * 100)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Preset buttons (only in edit mode) */}
      {mode === 'edit' && (
        <div className="intensity-presets">
          <button
            className="preset-btn random"
            onClick={() => applyPreset(0)}
            title="Random"
          >
            ?
          </button>
          {INTENSITY_PRESETS.map((preset, i) => (
            <button
              key={preset.id}
              className="preset-btn"
              onClick={() => applyPreset(i + 1)}
              title={preset.name}
            >
              {preset.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact version for inside loop pads
interface MiniIntensityViewProps {
  loop: Loop;
  showIntensity: boolean;
}

export function MiniIntensityView({ loop, showIntensity }: MiniIntensityViewProps) {
  if (!showIntensity || loop.pattern.length === 0) {
    return null;
  }

  const beatsPerBar = 4;
  const totalBeats = loop.bars * beatsPerBar;

  return (
    <div className="mini-intensity-view">
      {loop.pattern.map((note, index) => {
        const position = (note.time / totalBeats) * 100;
        const velocity = note.velocity || 0.8;
        const barWidth = Math.max(2, 100 / (totalBeats * 2));

        return (
          <div
            key={index}
            className="mini-bar"
            style={{
              left: `${position}%`,
              width: `${barWidth}%`,
              height: `${velocity * 100}%`,
              backgroundColor: loop.color,
              opacity: 0.3 + (velocity * 0.5),
            }}
          />
        );
      })}
    </div>
  );
}
