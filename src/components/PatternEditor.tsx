import { useState } from 'react';
import type { Loop, NoteEvent } from '../types';
import './PatternEditor.css';

// Available notes for the pattern editor
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [2, 3, 4, 5, 6];

interface PatternEditorProps {
  loop: Loop;
  onPatternChange: (loopId: string, pattern: NoteEvent[]) => void;
  onClose: () => void;
}

export function PatternEditor({ loop, onPatternChange, onClose }: PatternEditorProps) {
  const [pattern, setPattern] = useState<NoteEvent[]>([...loop.pattern]);
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
                        return (
                          <div
                            key={time}
                            className={`grid-cell ${isActive ? 'active' : ''} ${isBarStart ? 'bar-start' : ''} ${isBeatStart ? 'beat-start' : ''}`}
                            style={{ backgroundColor: isActive ? loop.color : undefined }}
                            onClick={() => handleCellClick(time, note, octave)}
                          />
                        );
                      })}
                    </div>
                  ))
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Pattern preview */}
        <div className="pattern-preview">
          <h3>Pattern ({pattern.length} notes)</h3>
          <div className="note-sequence">
            {pattern.map((note, i) => (
              <span key={i} className="note-chip" style={{ backgroundColor: loop.color }}>
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
