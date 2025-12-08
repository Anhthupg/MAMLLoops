import { useState, useCallback } from 'react';
import type { Loop, NoteEvent } from '../types';
import './PatternEditor.css';

// Available notes for the pattern editor
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [2, 3, 4, 5, 6];

// Velocity presets for quick selection
const VELOCITY_PRESETS = [
  { label: 'pp', value: 0.2 },
  { label: 'p', value: 0.4 },
  { label: 'mp', value: 0.6 },
  { label: 'mf', value: 0.8 },
  { label: 'f', value: 0.9 },
  { label: 'ff', value: 1.0 },
];

interface PatternEditorProps {
  loop: Loop;
  onPatternChange: (loopId: string, pattern: NoteEvent[]) => void;
  onClose: () => void;
}

export function PatternEditor({ loop, onPatternChange, onClose }: PatternEditorProps) {
  const [pattern, setPattern] = useState<NoteEvent[]>([...loop.pattern]);
  const [selectedNoteIndex, setSelectedNoteIndex] = useState<number | null>(null);
  const beatsPerBar = 4;
  const totalBeats = loop.bars * beatsPerBar;

  // Get note at a specific time position
  const getNoteAtTime = (time: number): NoteEvent | undefined => {
    return pattern.find(n => Math.abs(n.time - time) < 0.01);
  };

  // Toggle or change note at position
  const handleCellClick = (time: number, note: string, octave: number) => {
    const fullNote = `${note}${octave}`;
    const existingIndex = pattern.findIndex(n => Math.abs(n.time - time) < 0.01);

    let newPattern: NoteEvent[];
    if (existingIndex >= 0) {
      const existing = pattern[existingIndex];
      if (existing.note === fullNote) {
        // Same note - remove it
        newPattern = pattern.filter((_, i) => i !== existingIndex);
      } else {
        // Different note - replace it
        newPattern = [...pattern];
        newPattern[existingIndex] = { ...existing, note: fullNote };
      }
    } else {
      // Add new note
      newPattern = [...pattern, { note: fullNote, time, duration: '8n', velocity: 0.8 }];
      newPattern.sort((a, b) => a.time - b.time);
    }

    setPattern(newPattern);
  };

  // Check if a cell is active
  const isCellActive = (time: number, note: string, octave: number): boolean => {
    const fullNote = `${note}${octave}`;
    const noteEvent = getNoteAtTime(time);
    return noteEvent?.note === fullNote;
  };

  const handleSave = () => {
    onPatternChange(loop.id, pattern);
    onClose();
  };

  const handleClear = () => {
    setPattern([]);
    setSelectedNoteIndex(null);
  };

  // Update velocity of a specific note
  const updateNoteVelocity = useCallback((noteIndex: number, velocity: number) => {
    setPattern(prev => {
      const newPattern = [...prev];
      newPattern[noteIndex] = { ...newPattern[noteIndex], velocity };
      return newPattern;
    });
  }, []);

  // Randomize all velocities within a range
  const randomizeVelocities = useCallback((minVel: number = 0.3, maxVel: number = 1.0) => {
    setPattern(prev => prev.map(note => ({
      ...note,
      velocity: minVel + Math.random() * (maxVel - minVel)
    })));
  }, []);

  // Humanize velocities - add slight random variation to existing values
  const humanizeVelocities = useCallback(() => {
    setPattern(prev => prev.map(note => {
      const currentVel = note.velocity || 0.8;
      const variation = (Math.random() - 0.5) * 0.2; // +/- 10%
      return {
        ...note,
        velocity: Math.max(0.1, Math.min(1.0, currentVel + variation))
      };
    }));
  }, []);

  // Reset all velocities to default
  const resetVelocities = useCallback(() => {
    setPattern(prev => prev.map(note => ({ ...note, velocity: 0.8 })));
  }, []);

  // Get note index at a specific time position
  const getNoteIndexAtTime = (time: number): number => {
    return pattern.findIndex(n => Math.abs(n.time - time) < 0.01);
  };

  // Generate time slots (every 8th note = 0.5 beats)
  const timeSlots: number[] = [];
  for (let i = 0; i < totalBeats; i += 0.5) {
    timeSlots.push(i);
  }

  return (
    <div className="pattern-editor-overlay" onClick={onClose}>
      <div className="pattern-editor" onClick={e => e.stopPropagation()}>
        <div className="editor-header">
          <h2>Edit Pattern: {loop.name}</h2>
          <span className="loop-info">{loop.bars} bars, {totalBeats} beats</span>
        </div>

        <div className="piano-roll-container">
          <div className="piano-roll">
            {/* Y-axis: Notes */}
            <div className="note-labels">
              {OCTAVES.slice().reverse().map(octave => (
                NOTES.slice().reverse().map(note => (
                  <div
                    key={`${note}${octave}`}
                    className={`note-label ${note.includes('#') ? 'sharp' : ''}`}
                  >
                    {note}{octave}
                  </div>
                ))
              ))}
            </div>

            {/* Grid */}
            <div className="grid-container">
              {/* Bar markers */}
              <div className="bar-markers">
                {Array.from({ length: loop.bars }, (_, i) => (
                  <div key={i} className="bar-marker" style={{ left: `${(i / loop.bars) * 100}%` }}>
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Note grid */}
              <div className="note-grid">
                {OCTAVES.slice().reverse().map(octave => (
                  NOTES.slice().reverse().map(note => (
                    <div key={`row-${note}${octave}`} className={`grid-row ${note.includes('#') ? 'sharp-row' : ''}`}>
                      {timeSlots.map(time => {
                        const isActive = isCellActive(time, note, octave);
                        const isBarStart = time % beatsPerBar === 0;
                        const isBeatStart = time % 1 === 0;
                        const noteIndex = getNoteIndexAtTime(time);
                        const noteEvent = isActive ? pattern[noteIndex] : null;
                        const velocity = noteEvent?.velocity || 0.8;
                        const isSelected = noteIndex === selectedNoteIndex;
                        return (
                          <div
                            key={time}
                            className={`grid-cell ${isActive ? 'active' : ''} ${isBarStart ? 'bar-start' : ''} ${isBeatStart ? 'beat-start' : ''} ${isSelected ? 'selected' : ''}`}
                            style={{
                              backgroundColor: isActive ? loop.color : undefined,
                              opacity: isActive ? 0.4 + (velocity * 0.6) : undefined,
                            }}
                            onClick={() => {
                              if (isActive) {
                                // If clicking an active note, select it for velocity editing
                                setSelectedNoteIndex(noteIndex === selectedNoteIndex ? null : noteIndex);
                              } else {
                                handleCellClick(time, note, octave);
                              }
                            }}
                            onDoubleClick={() => {
                              // Double-click removes the note
                              if (isActive) {
                                handleCellClick(time, note, octave);
                                setSelectedNoteIndex(null);
                              }
                            }}
                            title={isActive ? `${noteEvent?.note} - Velocity: ${Math.round(velocity * 100)}%` : 'Click to add note'}
                          >
                            {isActive && (
                              <div
                                className="velocity-bar"
                                style={{
                                  height: `${velocity * 100}%`,
                                  backgroundColor: loop.color,
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Velocity Controls Panel */}
        <div className="velocity-controls">
          <div className="velocity-header">
            <h3>Velocity / Intensity</h3>
            <div className="velocity-actions">
              <button className="btn-small" onClick={() => randomizeVelocities()} title="Random velocities">
                Random
              </button>
              <button className="btn-small" onClick={humanizeVelocities} title="Add slight variation">
                Humanize
              </button>
              <button className="btn-small" onClick={resetVelocities} title="Reset to default">
                Reset
              </button>
            </div>
          </div>

          {selectedNoteIndex !== null && pattern[selectedNoteIndex] && (
            <div className="selected-note-velocity">
              <span className="selected-note-label">
                {pattern[selectedNoteIndex].note} @ beat {pattern[selectedNoteIndex].time}
              </span>
              <div className="velocity-slider-container">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((pattern[selectedNoteIndex].velocity || 0.8) * 100)}
                  onChange={(e) => updateNoteVelocity(selectedNoteIndex, Number(e.target.value) / 100)}
                  className="velocity-slider"
                />
                <span className="velocity-value">{Math.round((pattern[selectedNoteIndex].velocity || 0.8) * 100)}%</span>
              </div>
              <div className="velocity-presets">
                {VELOCITY_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    className={`preset-btn ${Math.abs((pattern[selectedNoteIndex]?.velocity || 0.8) - preset.value) < 0.05 ? 'active' : ''}`}
                    onClick={() => updateNoteVelocity(selectedNoteIndex, preset.value)}
                    title={`${preset.label} (${Math.round(preset.value * 100)}%)`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedNoteIndex === null && pattern.length > 0 && (
            <div className="velocity-hint">
              Click a note to adjust its velocity
            </div>
          )}
        </div>

        {/* Pattern preview */}
        <div className="pattern-preview">
          <h3>Pattern ({pattern.length} notes)</h3>
          <div className="note-sequence">
            {pattern.map((note, i) => (
              <span
                key={i}
                className={`note-chip ${i === selectedNoteIndex ? 'selected' : ''}`}
                style={{
                  backgroundColor: loop.color,
                  opacity: 0.4 + ((note.velocity || 0.8) * 0.6)
                }}
                onClick={() => setSelectedNoteIndex(i === selectedNoteIndex ? null : i)}
                title={`Velocity: ${Math.round((note.velocity || 0.8) * 100)}%`}
              >
                {note.note} @ {note.time}
              </span>
            ))}
            {pattern.length === 0 && <span className="empty-message">Click grid to add notes</span>}
          </div>
        </div>

        <div className="editor-actions">
          <button className="btn-clear" onClick={handleClear}>Clear All</button>
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save Pattern</button>
        </div>
      </div>
    </div>
  );
}
