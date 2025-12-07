import { useRef, useEffect, useCallback, useState } from 'react';
import * as Tone from 'tone';
import type { Loop, NoteEvent } from '../types';

// Queued pattern change type
interface QueuedPatternChange {
  loopId: string;
  pattern: NoteEvent[];
  applyAtBar: number;
}

interface TimelineViewProps {
  loops: Loop[];
  currentBar: number;
  currentBeat: number;
  isPlaying: boolean;
  tempo: number;
  onPatternChange?: (loopId: string, pattern: NoteEvent[]) => void;
  editableLoopIds?: string[];
  queuedChanges?: QueuedPatternChange[];
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
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

function lcmArray(arr: number[]): number {
  if (arr.length === 0) return 1;
  return arr.reduce((acc, val) => lcm(acc, val), arr[0]);
}

export function TimelineView({
  loops,
  currentBar: _currentBar,
  currentBeat: _currentBeat,
  isPlaying,
  tempo,
  onPatternChange,
  editableLoopIds = [],
  queuedChanges = [],
}: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);

  // Constants
  const BEATS_PER_BAR = 4;

  // Calculate mother loop (LCM of all loop lengths)
  const activeLoops = loops.filter(l => !l.muted);
  const loopBars = activeLoops.length > 0
    ? activeLoops.map(l => l.bars)
    : loops.map(l => l.bars);
  const motherLoopBars = loopBars.length > 0 ? lcmArray(loopBars) : 1;
  const motherLoopBeats = motherLoopBars * BEATS_PER_BAR;

  // Get queued pattern for a loop
  const getQueuedPattern = useCallback((loopId: string) => {
    return queuedChanges.find(c => c.loopId === loopId);
  }, [queuedChanges]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const headerHeight = 40;
    const trackLabelWidth = 80;
    const timelineWidth = width - trackLabelWidth;
    const timelineHeight = height - headerHeight;

    // Get current position directly from Tone.js Transport
    const transportSeconds = Tone.getTransport().seconds;
    const bpm = Tone.getTransport().bpm.value;
    const totalBeats = transportSeconds * (bpm / 60);
    const cycleBeats = totalBeats % motherLoopBeats;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);

    // === HEADER ===
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, headerHeight);

    // Title and info
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Cycle: ${motherLoopBars} bars`, 10, 15);

    // Current position
    const currentBarDisplay = Math.floor(cycleBeats / BEATS_PER_BAR) + 1;
    const currentBeatDisplay = Math.floor(cycleBeats % BEATS_PER_BAR) + 1;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${currentBarDisplay}.${currentBeatDisplay}`, 10, 32);

    // Tempo and playing status
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(bpm)} BPM`, width - 10, 15);

    if (isPlaying) {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(width - 50, 28, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.textAlign = 'left';
      ctx.fillText('PLAY', width - 42, 32);
    }

    // Queued changes indicator
    if (queuedChanges.length > 0) {
      ctx.fillStyle = '#f59e0b';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${queuedChanges.length} pending change(s)`, width / 2, 28);
    }

    // === PROGRESS BAR ===
    const progressBarY = headerHeight - 4;
    const progressBarHeight = 3;
    ctx.fillStyle = '#252542';
    ctx.fillRect(trackLabelWidth, progressBarY, timelineWidth, progressBarHeight);

    const progress = cycleBeats / motherLoopBeats;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(trackLabelWidth, progressBarY, timelineWidth * progress, progressBarHeight);

    // === TRACKS ===
    if (loops.length === 0) {
      ctx.fillStyle = '#666';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Activate loops to see them here', width / 2, height / 2);
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const trackHeight = timelineHeight / loops.length;

    loops.forEach((loop, trackIndex) => {
      const trackY = headerHeight + trackIndex * trackHeight;
      const isActive = !loop.muted;
      const isHovered = hoveredTrack === loop.id;
      const isEditable = editableLoopIds.includes(loop.id);
      const loopBeats = loop.bars * BEATS_PER_BAR;

      // Check for queued pattern
      const queuedChange = getQueuedPattern(loop.id);
      const hasQueuedChange = !!queuedChange;

      // Track background
      ctx.fillStyle = isHovered && isEditable ? '#1a1a2e' : '#111118';
      ctx.fillRect(0, trackY, width, trackHeight);

      // Track separator
      ctx.strokeStyle = '#252542';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, trackY + trackHeight);
      ctx.lineTo(width, trackY + trackHeight);
      ctx.stroke();

      // Track label area
      ctx.fillStyle = hasQueuedChange ? '#1a1520' : '#151520';
      ctx.fillRect(0, trackY, trackLabelWidth, trackHeight);

      // Track name
      ctx.fillStyle = isActive ? loop.color : '#555';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(loop.name, 6, trackY + 16);

      // Loop info
      ctx.fillStyle = '#555';
      ctx.font = '9px monospace';
      ctx.fillText(`${loop.bars}b`, 6, trackY + 28);

      // Queued change indicator
      if (hasQueuedChange) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '8px monospace';
        ctx.fillText('QUEUED', 6, trackY + trackHeight - 6);
      }

      // Current position within THIS loop
      const loopPosition = cycleBeats % loopBeats;
      const loopBar = Math.floor(loopPosition / BEATS_PER_BAR) + 1;
      ctx.fillStyle = isActive ? loop.color : '#444';
      ctx.font = '9px monospace';
      ctx.fillText(`${loopBar}/${loop.bars}`, 6, trackY + 40);

      // === GRID ===
      // Draw beat grid lines
      for (let beat = 0; beat <= motherLoopBeats; beat++) {
        const x = trackLabelWidth + (beat / motherLoopBeats) * timelineWidth;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + trackHeight);

        if (beat % BEATS_PER_BAR === 0) {
          ctx.strokeStyle = '#2a2a3a';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = '#1a1a25';
          ctx.lineWidth = 0.5;
        }
        ctx.stroke();
      }

      // Draw loop restart markers
      for (let rep = 0; rep <= Math.ceil(motherLoopBeats / loopBeats); rep++) {
        const loopStartBeat = rep * loopBeats;
        if (loopStartBeat > motherLoopBeats) break;

        const x = trackLabelWidth + (loopStartBeat / motherLoopBeats) * timelineWidth;
        ctx.strokeStyle = isActive ? loop.color : '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, trackY);
        ctx.lineTo(x, trackY + trackHeight);
        ctx.stroke();

        // Repetition label
        if (rep > 0 && loopStartBeat < motherLoopBeats) {
          ctx.fillStyle = `${loop.color}66`;
          ctx.font = '8px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`${rep + 1}`, x + 2, trackY + 10);
        }
      }

      // === DRAW NOTES ===
      // Decide which pattern to use for drawing
      const patternToDraw = hasQueuedChange ? queuedChange.pattern : loop.pattern;
      const currentPattern = loop.pattern;

      if (patternToDraw && patternToDraw.length > 0) {
        const repetitions = Math.ceil(motherLoopBeats / loopBeats);

        for (let rep = 0; rep < repetitions; rep++) {
          const repStartBeat = rep * loopBeats;
          const isSeedLoop = rep === 0;

          patternToDraw.forEach((note: NoteEvent) => {
            const noteBeatInMother = repStartBeat + note.time;
            if (noteBeatInMother >= motherLoopBeats) return;

            const pitch = noteToPitch(note.note);
            if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;

            const noteX = trackLabelWidth + (noteBeatInMother / motherLoopBeats) * timelineWidth;
            const pitchNormalized = (pitch - MIN_PITCH) / PITCH_RANGE;
            const noteY = trackY + trackHeight * (1 - pitchNormalized) - 2;

            const durationBeats = note.duration === '8n' ? 0.5 :
                                  note.duration === '4n' ? 1 :
                                  note.duration === '2n' ? 2 : 0.5;
            const noteWidth = Math.max(3, (durationBeats / motherLoopBeats) * timelineWidth);
            const noteHeight = Math.max(3, trackHeight / PITCH_RANGE * 0.7);

            // Check if this note is new (in queued but not in current)
            const isNewNote = hasQueuedChange && !currentPattern.some(n =>
              Math.abs(n.time - note.time) < 0.1 && n.note === note.note
            );

            // Color based on state
            if (hasQueuedChange && isSeedLoop) {
              if (isNewNote) {
                // New note - show in orange/pending color
                ctx.fillStyle = '#f59e0b';
                ctx.globalAlpha = 0.9;
              } else {
                // Existing note
                ctx.fillStyle = isActive ? loop.color : '#666';
                ctx.globalAlpha = isActive ? 1 : 0.5;
              }
            } else if (isSeedLoop) {
              ctx.fillStyle = isActive ? loop.color : '#666';
              ctx.globalAlpha = isActive ? 1 : 0.5;
            } else {
              ctx.fillStyle = isActive ? '#444' : '#333';
              ctx.globalAlpha = isActive ? 0.4 : 0.2;
            }

            ctx.fillRect(noteX - 1, noteY - noteHeight / 2, noteWidth, noteHeight);
            ctx.globalAlpha = 1;
          });
        }
      }

      // Show notes that will be removed (in current but not in queued)
      if (hasQueuedChange && currentPattern.length > 0) {
        currentPattern.forEach((note: NoteEvent) => {
          const willBeRemoved = !queuedChange.pattern.some(n =>
            Math.abs(n.time - note.time) < 0.1 && n.note === note.note
          );

          if (willBeRemoved) {
            const pitch = noteToPitch(note.note);
            if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;

            const noteX = trackLabelWidth + (note.time / motherLoopBeats) * timelineWidth;
            const pitchNormalized = (pitch - MIN_PITCH) / PITCH_RANGE;
            const noteY = trackY + trackHeight * (1 - pitchNormalized) - 2;
            const noteWidth = Math.max(3, (0.5 / motherLoopBeats) * timelineWidth);

            // Draw with strikethrough to show removal
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 0.8;
            ctx.beginPath();
            ctx.moveTo(noteX - 3, noteY);
            ctx.lineTo(noteX + noteWidth + 3, noteY);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        });
      }

      // === PLAYHEAD ===
      const playheadX = trackLabelWidth + (cycleBeats / motherLoopBeats) * timelineWidth;

      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, trackY);
      ctx.lineTo(playheadX, trackY + trackHeight);
      ctx.stroke();

      // Playhead glow
      const gradient = ctx.createLinearGradient(playheadX - 10, 0, playheadX + 10, 0);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.08)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(playheadX - 10, trackY, 20, trackHeight);
    });

    // === LEGEND ===
    ctx.fillStyle = '#444';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Click to add/remove notes • Orange = pending', trackLabelWidth + 5, height - 4);

    animationRef.current = requestAnimationFrame(draw);
  }, [loops, isPlaying, tempo, motherLoopBars, motherLoopBeats, editableLoopIds, hoveredTrack, queuedChanges, getQueuedPattern, BEATS_PER_BAR]);

  // Mouse move for track hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || loops.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const headerHeight = 40;
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

  // Click to add/remove notes
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onPatternChange) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const headerHeight = 40;
    const trackLabelWidth = 80;
    const timelineWidth = canvas.width - trackLabelWidth;
    const trackHeight = loops.length > 0 ? (canvas.height - headerHeight) / loops.length : 0;

    // Must be in timeline area
    if (x < trackLabelWidth || y < headerHeight) return;

    // Find track
    const trackIndex = Math.floor((y - headerHeight) / trackHeight);
    if (trackIndex < 0 || trackIndex >= loops.length) return;

    const loop = loops[trackIndex];
    if (!editableLoopIds.includes(loop.id)) return;

    const loopBeats = loop.bars * 4;

    // Calculate beat position
    const timelineX = x - trackLabelWidth;
    const motherBeat = (timelineX / timelineWidth) * motherLoopBeats;
    const beatInLoop = motherBeat % loopBeats;
    const quantizedBeat = Math.round(beatInLoop * 2) / 2; // Quantize to 8th notes

    // Calculate pitch
    const trackY = headerHeight + trackIndex * trackHeight;
    const relativeY = y - trackY;
    const pitchNormalized = 1 - (relativeY / trackHeight);
    const pitch = Math.round(MIN_PITCH + pitchNormalized * PITCH_RANGE);
    const clampedPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
    const note = pitchToNote(clampedPitch);

    // Use queued pattern if exists, otherwise current pattern
    const queuedChange = getQueuedPattern(loop.id);
    const basePattern = queuedChange ? queuedChange.pattern : loop.pattern;

    // Toggle note
    const tolerance = 0.25;
    const existingIndex = basePattern.findIndex(n =>
      Math.abs(n.time - quantizedBeat) < tolerance &&
      Math.abs(noteToPitch(n.note) - clampedPitch) < 3
    );

    let newPattern: NoteEvent[];
    if (existingIndex >= 0) {
      newPattern = basePattern.filter((_, i) => i !== existingIndex);
    } else {
      newPattern = [...basePattern, {
        note,
        time: quantizedBeat,
        duration: '8n',
        velocity: 0.8
      }].sort((a, b) => a.time - b.time);
    }

    onPatternChange(loop.id, newPattern);
  }, [loops, editableLoopIds, onPatternChange, motherLoopBeats, getQueuedPattern]);

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
