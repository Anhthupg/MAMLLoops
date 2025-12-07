import { useRef, useEffect, useCallback, useState } from 'react';
import type { Loop, NoteEvent } from '../types';

interface TimelineViewProps {
  loops: Loop[];
  currentBar: number;
  currentBeat: number;
  isPlaying: boolean;
  tempo: number;
  onPatternChange?: (loopId: string, pattern: NoteEvent[]) => void;
  editableLoopIds?: string[];
}

// MIDI note range for display
const MIN_PITCH = 36; // C2
const MAX_PITCH = 84; // C6
const PITCH_RANGE = MAX_PITCH - MIN_PITCH;

// Note names for piano keys
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Convert note string to MIDI pitch
function noteToPitch(note: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11
  };
  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return 60; // Default C4
  const noteName = match[1];
  const octave = parseInt(match[2]);
  return (octave + 1) * 12 + noteMap[noteName];
}

// Convert pitch to note string
function pitchToNote(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  const noteName = NOTE_NAMES[pitch % 12];
  return `${noteName}${octave}`;
}

// Calculate LCM
function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}

function lcmArray(arr: number[]): number {
  if (arr.length === 0) return 1;
  return arr.reduce((acc, val) => lcm(acc, val), arr[0]);
}

// Check if note is a black key
function isBlackKey(pitch: number): boolean {
  const note = pitch % 12;
  return [1, 3, 6, 8, 10].includes(note);
}

export function TimelineView({
  loops,
  currentBar,
  currentBeat,
  isPlaying,
  tempo,
  onPatternChange,
  editableLoopIds = [],
}: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);

  // Calculate mother loop (LCM of all loop lengths)
  const activeLoops = loops.filter(l => !l.muted);
  const loopBars = activeLoops.length > 0
    ? activeLoops.map(l => l.bars)
    : loops.map(l => l.bars);
  const motherLoopBars = loopBars.length > 0 ? lcmArray(loopBars) : 1;
  const beatsPerBar = 4;
  const motherLoopBeats = motherLoopBars * beatsPerBar;

  // Current position
  const currentPosition = currentBar * beatsPerBar + currentBeat;
  const cyclePosition = currentPosition % motherLoopBeats;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const pianoWidth = 50;
    const headerHeight = 60;
    const trackLabelWidth = 80;
    const timelineWidth = width - pianoWidth - trackLabelWidth;
    const timelineHeight = height - headerHeight;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // === HEADER: Mother loop progress bar ===
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, headerHeight);

    // Mother loop label
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('MOTHER LOOP', 10, 18);
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.fillText(`${motherLoopBars} bars (LCM)`, 10, 32);

    // Progress bar background
    const progressBarX = pianoWidth + trackLabelWidth;
    const progressBarY = 15;
    const progressBarHeight = 30;
    ctx.fillStyle = '#252542';
    ctx.fillRect(progressBarX, progressBarY, timelineWidth, progressBarHeight);

    // Progress bar fill
    const progress = cyclePosition / motherLoopBeats;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(progressBarX, progressBarY, timelineWidth * progress, progressBarHeight);

    // Bar markers on progress bar
    for (let bar = 0; bar <= motherLoopBars; bar++) {
      const x = progressBarX + (bar / motherLoopBars) * timelineWidth;
      ctx.beginPath();
      ctx.moveTo(x, progressBarY);
      ctx.lineTo(x, progressBarY + progressBarHeight);
      ctx.strokeStyle = bar === 0 ? '#fff' : '#444';
      ctx.lineWidth = bar % 4 === 0 ? 2 : 1;
      ctx.stroke();

      // Bar number
      if (bar < motherLoopBars && bar % Math.max(1, Math.floor(motherLoopBars / 20)) === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${bar + 1}`, x + (timelineWidth / motherLoopBars / 2), progressBarY + progressBarHeight + 12);
      }
    }

    // Playhead on progress bar
    const playheadX = progressBarX + progress * timelineWidth;
    ctx.beginPath();
    ctx.moveTo(playheadX, progressBarY - 5);
    ctx.lineTo(playheadX - 5, progressBarY - 12);
    ctx.lineTo(playheadX + 5, progressBarY - 12);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Current position text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'right';
    const currentBarInCycle = Math.floor(cyclePosition / beatsPerBar) + 1;
    ctx.fillText(`${currentBarInCycle} / ${motherLoopBars}`, width - 10, 28);

    // Tempo
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.fillText(`${tempo} BPM`, width - 10, 44);

    // Playing indicator
    if (isPlaying) {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(width - 80, 36, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // === PIANO ROLL on left side ===
    const trackHeight = loops.length > 0 ? timelineHeight / loops.length : timelineHeight;

    // Draw piano keys (simplified, just for the first track area)
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, headerHeight, pianoWidth, timelineHeight);

    // Piano key labels (show every octave)
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const y = headerHeight + timelineHeight - ((pitch - MIN_PITCH) / PITCH_RANGE) * timelineHeight;

      if (pitch % 12 === 0) { // C notes
        ctx.fillStyle = '#555';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(pitchToNote(pitch), pianoWidth - 5, y + 3);
      }

      // Draw key indicator
      const keyHeight = timelineHeight / PITCH_RANGE;
      if (isBlackKey(pitch)) {
        ctx.fillStyle = '#333';
      } else {
        ctx.fillStyle = '#444';
      }
      ctx.fillRect(0, y - keyHeight / 2, pianoWidth - 10, keyHeight - 1);
    }

    // === TRACKS ===
    loops.forEach((loop, trackIndex) => {
      const trackY = headerHeight + trackIndex * trackHeight;
      const isActive = !loop.muted;
      const isEditable = editableLoopIds.includes(loop.id);
      const isHovered = hoveredTrack === loop.id;

      // Track background
      ctx.fillStyle = isHovered ? '#1e1e3a' : '#151525';
      ctx.fillRect(pianoWidth, trackY, trackLabelWidth + timelineWidth, trackHeight);

      // Track separator
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pianoWidth, trackY + trackHeight);
      ctx.lineTo(width, trackY + trackHeight);
      ctx.stroke();

      // Track label area
      ctx.fillStyle = isActive ? '#1a1a2e' : '#121220';
      ctx.fillRect(pianoWidth, trackY, trackLabelWidth, trackHeight);

      // Track name
      ctx.fillStyle = isActive ? loop.color : '#555';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(loop.name, pianoWidth + 8, trackY + 18);

      // Loop info
      ctx.fillStyle = '#666';
      ctx.font = '9px monospace';
      ctx.fillText(`${loop.bars} bars`, pianoWidth + 8, trackY + 32);
      ctx.fillText(`${loop.pattern?.length || 0} notes`, pianoWidth + 8, trackY + 44);

      // Editable indicator
      if (isEditable) {
        ctx.fillStyle = loop.color;
        ctx.fillRect(pianoWidth, trackY, 3, trackHeight);
      }

      // === TIMELINE GRID ===
      const timelineX = pianoWidth + trackLabelWidth;

      // Draw beat grid
      for (let beat = 0; beat <= motherLoopBeats; beat++) {
        const x = timelineX + (beat / motherLoopBeats) * timelineWidth;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + trackHeight);

        if (beat % beatsPerBar === 0) {
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = '#1a1a2a';
          ctx.lineWidth = 0.5;
        }
        ctx.stroke();
      }

      // Draw loop boundary markers
      for (let rep = 0; rep <= Math.ceil(motherLoopBars / loop.bars); rep++) {
        const loopStartBeat = rep * loop.bars * beatsPerBar;
        if (loopStartBeat >= motherLoopBeats) break;

        const x = timelineX + (loopStartBeat / motherLoopBeats) * timelineWidth;
        ctx.strokeStyle = isActive ? loop.color : '#444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + trackHeight);
        ctx.stroke();

        // Loop number
        if (rep > 0) {
          ctx.fillStyle = isActive ? `${loop.color}88` : '#44444488';
          ctx.font = '8px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`rep ${rep + 1}`, x + 3, trackY + 12);
        }
      }

      // === DRAW NOTES ===
      if (loop.pattern && loop.pattern.length > 0) {
        const loopBeats = loop.bars * beatsPerBar;
        const repetitions = Math.ceil(motherLoopBeats / loopBeats);

        for (let rep = 0; rep < repetitions; rep++) {
          const repStartBeat = rep * loopBeats;
          const isSeedLoop = rep === 0;

          loop.pattern.forEach((note: NoteEvent) => {
            const noteBeat = repStartBeat + note.time;
            if (noteBeat >= motherLoopBeats) return;

            const pitch = noteToPitch(note.note);
            if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;

            // Note position
            const noteX = timelineX + (noteBeat / motherLoopBeats) * timelineWidth;
            const noteY = trackY + trackHeight - ((pitch - MIN_PITCH + 0.5) / PITCH_RANGE) * trackHeight;

            // Note duration in pixels
            const durationBeats = note.duration === '8n' ? 0.5 :
                                  note.duration === '4n' ? 1 :
                                  note.duration === '2n' ? 2 :
                                  note.duration === '1n' ? 4 : 0.5;
            const noteWidth = Math.max(4, (durationBeats / motherLoopBeats) * timelineWidth);
            const noteH = Math.max(2, trackHeight / PITCH_RANGE * 0.8);

            // Color based on seed vs repeated
            if (isSeedLoop) {
              // Full color, full saturation for seed loop
              ctx.fillStyle = isActive ? loop.color : '#666';
              ctx.globalAlpha = isActive ? 1 : 0.5;
            } else {
              // Greyed out for repeated loops
              ctx.fillStyle = isActive ? '#666' : '#444';
              ctx.globalAlpha = isActive ? 0.4 : 0.2;
            }

            // Draw note rectangle
            ctx.fillRect(noteX, noteY - noteH / 2, noteWidth, noteH);

            // Note border for seed notes
            if (isSeedLoop && isActive) {
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 0.5;
              ctx.strokeRect(noteX, noteY - noteH / 2, noteWidth, noteH);
            }

            ctx.globalAlpha = 1;
          });
        }
      }

      // === PLAYHEAD for this track ===
      const trackPlayheadX = timelineX + (cyclePosition / motherLoopBeats) * timelineWidth;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trackPlayheadX, trackY);
      ctx.lineTo(trackPlayheadX, trackY + trackHeight);
      ctx.stroke();

      // Playhead glow
      const gradient = ctx.createLinearGradient(trackPlayheadX - 10, 0, trackPlayheadX + 10, 0);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.2)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(trackPlayheadX - 10, trackY, 20, trackHeight);
    });

    // === LEGEND ===
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Seed pattern = full color | Repeated = grey', pianoWidth + trackLabelWidth + 10, height - 5);

    animationRef.current = requestAnimationFrame(draw);
  }, [loops, currentBar, currentBeat, isPlaying, tempo, motherLoopBars, motherLoopBeats, cyclePosition, editableLoopIds, hoveredTrack, beatsPerBar]);

  // Handle mouse move for track hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || loops.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const headerHeight = 60;
    const trackHeight = (canvas.height - headerHeight) / loops.length;

    if (y < headerHeight) {
      setHoveredTrack(null);
      return;
    }

    const trackIndex = Math.floor((y - headerHeight) / trackHeight);
    if (trackIndex >= 0 && trackIndex < loops.length) {
      setHoveredTrack(loops[trackIndex].id);
    } else {
      setHoveredTrack(null);
    }
  }, [loops]);

  const handleMouseLeave = useCallback(() => {
    setHoveredTrack(null);
  }, []);

  // Handle click for editing
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onPatternChange) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const pianoWidth = 50;
    const headerHeight = 60;
    const trackLabelWidth = 80;
    const timelineWidth = canvas.width - pianoWidth - trackLabelWidth;
    const trackHeight = loops.length > 0 ? (canvas.height - headerHeight) / loops.length : 0;

    // Check if click is in timeline area
    if (x < pianoWidth + trackLabelWidth || y < headerHeight) return;

    // Find which track was clicked
    const trackIndex = Math.floor((y - headerHeight) / trackHeight);
    if (trackIndex < 0 || trackIndex >= loops.length) return;

    const loop = loops[trackIndex];
    if (!editableLoopIds.includes(loop.id)) return;

    // Calculate beat position (only in first loop cycle)
    const timelineX = x - pianoWidth - trackLabelWidth;
    const beatPosition = (timelineX / timelineWidth) * motherLoopBeats;
    const loopBeats = loop.bars * beatsPerBar;
    const beatInLoop = beatPosition % loopBeats;
    const quantizedBeat = Math.round(beatInLoop * 2) / 2; // Quantize to 8th notes

    // Calculate pitch from Y position
    const trackY = headerHeight + trackIndex * trackHeight;
    const relativeY = y - trackY;
    const pitchNormalized = 1 - (relativeY / trackHeight);
    const pitch = Math.round(MIN_PITCH + pitchNormalized * PITCH_RANGE);
    const note = pitchToNote(Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch)));

    // Check if there's an existing note at this position
    const existingIndex = loop.pattern.findIndex(n =>
      Math.abs(n.time - quantizedBeat) < 0.25 &&
      noteToPitch(n.note) === pitch
    );

    let newPattern: NoteEvent[];
    if (existingIndex >= 0) {
      // Remove note
      newPattern = loop.pattern.filter((_, i) => i !== existingIndex);
    } else {
      // Add note
      newPattern = [...loop.pattern, {
        note,
        time: quantizedBeat,
        duration: '8n',
        velocity: 0.8
      }].sort((a, b) => a.time - b.time);
    }

    onPatternChange(loop.id, newPattern);
  }, [loops, editableLoopIds, onPatternChange, motherLoopBeats, beatsPerBar]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    };

    resize();
    window.addEventListener('resize', resize);
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        minHeight: 0,
        display: 'block',
        background: '#0a0a0f',
        cursor: editableLoopIds.length > 0 ? 'crosshair' : 'default',
      }}
    />
  );
}
