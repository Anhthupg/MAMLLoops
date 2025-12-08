import { useRef, useEffect, useCallback, useState } from 'react';
import * as Tone from 'tone';
import type { Loop, NoteEvent } from '../types';
import { INSTRUMENT_INFO } from '../types';
import { MiniIntensityPreview } from './MiniIntensityPreview';
import { MiniPitchPreview } from './MiniPitchPreview';
import { MiniRhythmPreview } from './MiniRhythmPreview';
import { CombinedPatternPreview } from './CombinedPatternPreview';

// ==========================================
// PATTERN GENERATION UTILITIES
// ==========================================

// Generate intensity presets (velocity patterns) - noteCount × 4
interface IntensityPreset {
  id: number;
  velocities: number[];
}

function generateIntensityPresets(noteCount: number): IntensityPreset[] {
  if (noteCount === 0) return [];
  const presetCount = noteCount * 4;
  const presets: IntensityPreset[] = [];

  for (let i = 0; i < presetCount; i++) {
    const progress = i / (presetCount - 1);
    const patternType = i % 8;
    const velocities: number[] = [];

    for (let j = 0; j < noteCount; j++) {
      const noteProgress = j / Math.max(1, noteCount - 1);
      let velocity: number;

      switch (patternType) {
        case 0: velocity = 0.2 + progress * 0.75; break;
        case 1: velocity = 0.2 + noteProgress * (0.3 + progress * 0.5); break;
        case 2: velocity = 0.95 - noteProgress * (0.3 + progress * 0.5); break;
        case 3: velocity = 0.5 + Math.sin(noteProgress * Math.PI * (2 + i * 0.5)) * (0.2 + progress * 0.25); break;
        case 4: { const acc = Math.max(2, Math.floor(4 - progress * 3)); velocity = j % acc === 0 ? 0.9 : 0.3 + progress * 0.3; break; }
        case 5: velocity = (j % 2 === 0) ? 0.3 + noteProgress * 0.6 * (0.5 + progress * 0.5) : 0.9 - noteProgress * 0.6 * (0.5 + progress * 0.5); break;
        case 6: { const pw = 0.2 + progress * 0.3; velocity = (noteProgress % 0.5 < pw) ? 0.8 + progress * 0.2 : 0.3 + progress * 0.2; break; }
        case 7: { const seed = (i * 1000 + j * 7) % 100 / 100; velocity = 0.3 + seed * 0.6 + progress * 0.1; break; }
        default: velocity = 0.7;
      }
      velocities.push(Math.max(0.1, Math.min(1.0, velocity)));
    }
    presets.push({ id: i, velocities });
  }

  // Add random preset at the end
  presets.push({
    id: presetCount,
    velocities: Array.from({ length: noteCount }, () => 0.2 + Math.random() * 0.8)
  });

  return presets;
}

// 10 rhythm presets (timing patterns)
interface RhythmPreset {
  id: number;
  label: string;
  getBeats: (bars: number) => number[];
}

const RHYTHM_PRESETS: RhythmPreset[] = [
  // Basic subdivisions
  { id: 0, label: '1/4', getBeats: (bars) => {
    const b: number[] = []; for (let i = 0; i < bars * 4; i++) b.push(i); return b;
  }},
  { id: 1, label: 'Swng', getBeats: (bars) => {
    // Swing 8ths - offbeats delayed to 2/3 of beat (triplet feel)
    const b: number[] = [];
    for (let i = 0; i < bars * 4; i++) {
      b.push(i);         // Downbeat at exact beat
      b.push(i + 0.67);  // Offbeat swung to 2/3 of beat
    }
    return b;
  }},
  { id: 2, label: '1/8', getBeats: (bars) => {
    // Straight 8ths
    const b: number[] = []; for (let i = 0; i < bars * 8; i++) b.push(i * 0.5); return b;
  }},
  { id: 9, label: '1/16', getBeats: (bars) => {
    const b: number[] = []; for (let i = 0; i < bars * 16; i++) b.push(i * 0.25); return b;
  }},
  // Syncopated - emphasize off-beats
  { id: 3, label: 'Funk', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.5, i*4+1.5, i*4+2, i*4+2.75, i*4+3.5);
    }
    return b;
  }},
  // Dotted - 3+3+2 pattern (tresillo)
  { id: 4, label: 'Tres', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.75, i*4+1.5, i*4+2, i*4+2.75, i*4+3.5);
    }
    return b;
  }},
  // Triplet feel
  { id: 5, label: 'Trip', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars * 4; i++) {
      b.push(i, i + 0.33, i + 0.67);
    }
    return b;
  }},
  // Clave pattern (Son clave 3-2)
  { id: 6, label: 'Clav', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i += 2) {
      b.push(i*4, i*4+1.5, i*4+3);
      if (i + 1 < bars) {
        b.push((i+1)*4+1, (i+1)*4+2.5);
      }
    }
    return b;
  }},
  // Polyrhythm 3 over 4
  { id: 7, label: '3:4', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+1.33, i*4+2.67);
    }
    return b;
  }},
  // Polyrhythm 5 over 4
  { id: 8, label: '5:4', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.8, i*4+1.6, i*4+2.4, i*4+3.2);
    }
    return b;
  }},
  // Breakbeat pattern
  { id: 9, label: 'Brk', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.25, i*4+1, i*4+1.5, i*4+2.5, i*4+3, i*4+3.25, i*4+3.75);
    }
    return b;
  }},
  // Sparse/ambient - less is more
  { id: 10, label: 'Air', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      if (i % 2 === 0) b.push(i*4, i*4+2.5);
      else b.push(i*4+1, i*4+3);
    }
    return b;
  }},
  // Amen break style
  { id: 11, label: 'Amen', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.5, i*4+1, i*4+1.5, i*4+2.25, i*4+2.75, i*4+3, i*4+3.5);
    }
    return b;
  }},
  // Swing feel
  { id: 12, label: 'Swng', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars * 4; i++) {
      b.push(i, i + 0.67); // Swing 8ths
    }
    return b;
  }},
  // Half-time
  { id: 13, label: 'Half', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+2);
    }
    return b;
  }},
  // Shuffle
  { id: 14, label: 'Shuf', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars * 4; i++) {
      b.push(i, i + 0.5, i + 0.75);
    }
    return b;
  }},
  // Bo Diddley beat
  { id: 15, label: 'BoDd', getBeats: (bars) => {
    const b: number[] = [];
    for (let i = 0; i < bars; i++) {
      b.push(i*4, i*4+0.5, i*4+1.5, i*4+2, i*4+3);
    }
    return b;
  }},
];

// 10 pitch presets (melodic contour patterns)
interface PitchPreset {
  id: number;
  label: string;
  getOffsets: (noteCount: number) => number[];
}

const PITCH_PRESETS: PitchPreset[] = [
  { id: 0, label: 'Flat', getOffsets: (n) => Array(n).fill(0) },
  { id: 1, label: 'Up', getOffsets: (n) => Array.from({ length: n }, (_, i) => Math.round((i / Math.max(1, n - 1)) * 12)) },
  { id: 2, label: 'Down', getOffsets: (n) => Array.from({ length: n }, (_, i) => Math.round((1 - i / Math.max(1, n - 1)) * 12) - 6) },
  { id: 3, label: 'Wave', getOffsets: (n) => Array.from({ length: n }, (_, i) => Math.round(Math.sin((i / Math.max(1, n - 1)) * Math.PI * 2) * 6)) },
  { id: 4, label: 'Saw', getOffsets: (n) => Array.from({ length: n }, (_, i) => (i % 4) * 3 - 6) },
  { id: 5, label: 'Oct', getOffsets: (n) => Array.from({ length: n }, (_, i) => i % 2 === 0 ? 0 : 12) },
  { id: 6, label: '5th', getOffsets: (n) => Array.from({ length: n }, (_, i) => i % 2 === 0 ? 0 : 7) },
  { id: 7, label: 'Inv', getOffsets: (n) => Array.from({ length: n }, (_, i) => -Math.round((i / Math.max(1, n - 1)) * 12)) },
  { id: 8, label: 'Arp', getOffsets: (n) => Array.from({ length: n }, (_, i) => [0, 4, 7, 12][i % 4]) },
  { id: 9, label: 'Rnd', getOffsets: (n) => Array.from({ length: n }, () => Math.round(Math.random() * 12 - 6)) },
];

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
  onPreviewPattern?: (pattern: NoteEvent[], bars: number) => void;
  onStopPreview?: () => void;
  onPreviewNote?: (note: string) => void;
  onVolumeChange?: (loopId: string, volume: number) => void;
  onTransposeChange?: (loopId: string, transpose: number) => void;
  onSoloChange?: (loopId: string, solo: boolean) => void;
  soloedLoopId?: string | null;
  editableLoopIds?: string[];
  queuedChanges?: QueuedPatternChange[];
}

// MIDI note range for display (extended to include drum notes at C1/D1/E1)
const MIN_PITCH = 24; // C1 (for drums)
const MAX_PITCH = 96; // C7
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

// Subdivision options for note duration
const SUBDIVISIONS = [
  { label: '1/4', value: '4n', beats: 1, quantize: 1 },
  { label: '1/8', value: '8n', beats: 0.5, quantize: 2 },
  { label: '1/16', value: '16n', beats: 0.25, quantize: 4 },
  { label: '1/32', value: '32n', beats: 0.125, quantize: 8 },
] as const;

export function TimelineView({
  loops,
  currentBar: _currentBar,
  currentBeat: _currentBeat,
  isPlaying,
  tempo,
  onPatternChange,
  onPreviewPattern,
  onStopPreview,
  onPreviewNote,
  onVolumeChange,
  onTransposeChange,
  onSoloChange,
  soloedLoopId,
  editableLoopIds = [],
  queuedChanges = [],
}: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);
  const [subdivision, setSubdivision] = useState<typeof SUBDIVISIONS[number]>(SUBDIVISIONS[1]); // Default 1/8
  const [previewingLoopId, setPreviewingLoopId] = useState<string | null>(null);

  // Track which track has expanded pattern options
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);

  // Track previously seen active loop IDs to detect newly added tracks
  const prevActiveLoopIdsRef = useRef<Set<string>>(new Set());

  // Auto-expand newly activated tracks (only for current player's editable loops)
  useEffect(() => {
    // Get IDs of active loops that are editable by the current player
    const activeEditableLoopIds = loops
      .filter(loop => editableLoopIds.includes(loop.id))
      .map(loop => loop.id);

    const currentIds = new Set(activeEditableLoopIds);
    const prevIds = prevActiveLoopIdsRef.current;

    // Find any new loop IDs that weren't in the previous set
    const newLoopIds = activeEditableLoopIds.filter(id => !prevIds.has(id));

    // If there's a new active editable loop, auto-expand it
    if (newLoopIds.length > 0) {
      // Expand the most recently added one (last in array)
      setExpandedTrackId(newLoopIds[newLoopIds.length - 1]);
    }

    // Update the ref for next comparison
    prevActiveLoopIdsRef.current = currentIds;
  }, [loops, editableLoopIds]);

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
      const isExpanded = expandedTrackId === loop.id;
      const loopBeats = loop.bars * BEATS_PER_BAR;
      const instrumentInfo = INSTRUMENT_INFO[loop.instrument];

      // Check for queued pattern
      const queuedChange = getQueuedPattern(loop.id);
      const hasQueuedChange = !!queuedChange;

      // Track background
      ctx.fillStyle = isExpanded ? '#1a1825' : (isHovered && isEditable ? '#1a1a2e' : '#111118');
      ctx.fillRect(0, trackY, width, trackHeight);

      // Track separator
      ctx.strokeStyle = '#252542';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, trackY + trackHeight);
      ctx.lineTo(width, trackY + trackHeight);
      ctx.stroke();

      // Track label area
      ctx.fillStyle = isExpanded ? '#1f1a28' : (hasQueuedChange ? '#1a1520' : '#151520');
      ctx.fillRect(0, trackY, trackLabelWidth, trackHeight);

      // Selection border for expanded track
      if (isExpanded) {
        ctx.strokeStyle = instrumentInfo?.color || '#4ade80';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, trackY + 1, trackLabelWidth - 2, trackHeight - 2);
      }

      // Track name + bars + position (all in one line)
      const loopPosition = cycleBeats % loopBeats;
      const loopBar = Math.floor(loopPosition / BEATS_PER_BAR) + 1;
      ctx.fillStyle = isActive ? loop.color : '#555';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${loop.name} ${loopBar}/${loop.bars}`, 6, trackY + 14);

      // Queued change indicator with countdown
      if (hasQueuedChange) {
        // Calculate bars until change applies
        const currentGlobalBar = Math.floor(totalBeats / BEATS_PER_BAR);
        const barsUntilChange = Math.max(0, queuedChange.applyAtBar - currentGlobalBar);

        // Pulsing effect
        const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 9px monospace';
        ctx.fillText(`IN ${barsUntilChange}`, 6, trackY + trackHeight - 6);
        ctx.globalAlpha = 1;
      }

      // === GRID ===
      // Draw subdivision grid lines (faint lines between beats)
      if (subdivision.quantize > 1) {
        ctx.strokeStyle = '#151520';
        ctx.lineWidth = 0.3;
        for (let beat = 0; beat < motherLoopBeats; beat++) {
          for (let sub = 1; sub < subdivision.quantize; sub++) {
            const subBeat = beat + (sub / subdivision.quantize);
            const x = trackLabelWidth + (subBeat / motherLoopBeats) * timelineWidth;
            ctx.beginPath();
            ctx.moveTo(x, trackY);
            ctx.lineTo(x, trackY + trackHeight);
            ctx.stroke();
          }
        }
      }

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
        const beatWidth = timelineWidth / motherLoopBeats;

        // === DRAW INTENSITY BARS FIRST (BEHIND PITCH BARS) - always show ===
        {
          for (let rep = 0; rep < repetitions; rep++) {
            const repStartBeat = rep * loopBeats;
            const isSeedLoop = rep === 0;

            patternToDraw.forEach((note: NoteEvent) => {
              const noteBeatInMother = repStartBeat + note.time;
              if (noteBeatInMother >= motherLoopBeats) return;

              const velocity = note.velocity ?? 0.8;
              const noteX = trackLabelWidth + (noteBeatInMother / motherLoopBeats) * timelineWidth;

              // Intensity bar: width based on note duration, height based on velocity
              const durationBeats = note.duration === '32n' ? 0.125 :
                                    note.duration === '16n' ? 0.25 :
                                    note.duration === '8n' ? 0.5 :
                                    note.duration === '4n' ? 1 :
                                    note.duration === '2n' ? 2 : 0.5;
              const barWidth = Math.max(6, durationBeats * beatWidth);
              const barHeight = velocity * (trackHeight - 4);

              // Draw intensity bar from bottom
              ctx.fillStyle = loop.color;
              ctx.globalAlpha = isSeedLoop ? (isActive ? 0.25 : 0.1) : 0.05;
              ctx.fillRect(
                noteX - 1,
                trackY + trackHeight - barHeight - 2,
                barWidth,
                barHeight
              );
              ctx.globalAlpha = 1;

              // In expanded mode, show velocity percentage on seed loop notes
              if (isExpanded && isSeedLoop && isEditable) {
                ctx.fillStyle = '#fff';
                ctx.globalAlpha = 0.6;
                ctx.font = '7px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(
                  `${Math.round(velocity * 100)}`,
                  noteX + barWidth / 2,
                  trackY + trackHeight - barHeight - 6
                );
                ctx.globalAlpha = 1;
              }
            });
          }
        }

        // === DRAW PITCH/MIDI BARS (ON TOP) ===
        for (let rep = 0; rep < repetitions; rep++) {
          const repStartBeat = rep * loopBeats;
          const isSeedLoop = rep === 0;

          patternToDraw.forEach((note: NoteEvent) => {
            // note.time is in beats within the loop (0 to loopBeats)
            // We need to place it at repStartBeat + note.time within the mother loop
            const noteBeatInMother = repStartBeat + note.time;
            if (noteBeatInMother >= motherLoopBeats) return;

            const pitch = noteToPitch(note.note);
            if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;

            // Calculate X position - note.time is relative to the loop, not the mother
            const noteX = trackLabelWidth + (noteBeatInMother / motherLoopBeats) * timelineWidth;
            const pitchNormalized = (pitch - MIN_PITCH) / PITCH_RANGE;
            const noteY = trackY + trackHeight * (1 - pitchNormalized) - 2;

            const durationBeats = note.duration === '32n' ? 0.125 :
                                  note.duration === '16n' ? 0.25 :
                                  note.duration === '8n' ? 0.5 :
                                  note.duration === '4n' ? 1 :
                                  note.duration === '2n' ? 2 : 0.5;
            // Scale note width - use beat width as reference for better visibility
            const noteWidth = Math.max(4, durationBeats * beatWidth);
            const noteHeight = Math.max(4, trackHeight / PITCH_RANGE * 0.8);

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
    ctx.fillText('Click to add/remove notes • Click ▼ for presets • Orange = pending', trackLabelWidth + 5, height - 4);

    animationRef.current = requestAnimationFrame(draw);
  }, [loops, isPlaying, tempo, motherLoopBars, motherLoopBeats, editableLoopIds, hoveredTrack, queuedChanges, getQueuedPattern, BEATS_PER_BAR, subdivision, expandedTrackId]);

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


  // Click to add/remove notes or select loop for intensity editing
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

    // Handle header clicks - ignore
    if (y < headerHeight) return;

    // Find track
    const trackIndex = Math.floor((y - headerHeight) / trackHeight);
    if (trackIndex < 0 || trackIndex >= loops.length) return;

    const loop = loops[trackIndex];

    // Must be in timeline area for note editing (track labels have their own buttons now)
    if (x < trackLabelWidth) return;

    if (!editableLoopIds.includes(loop.id)) return;

    const loopBeats = loop.bars * BEATS_PER_BAR;

    // Calculate beat position within the mother loop
    const timelineX = x - trackLabelWidth;
    const motherBeat = (timelineX / timelineWidth) * motherLoopBeats;
    // Convert to position within this loop's pattern (modulo loop length)
    const beatInLoop = motherBeat % loopBeats;
    // Quantize based on current subdivision
    const quantizedBeat = Math.round(beatInLoop * subdivision.quantize) / subdivision.quantize;

    // Calculate pitch from Y position
    const trackY = headerHeight + trackIndex * trackHeight;
    const relativeY = y - trackY;
    const pitchNormalized = 1 - (relativeY / trackHeight);
    const pitch = Math.round(MIN_PITCH + pitchNormalized * PITCH_RANGE);
    const clampedPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
    const clickedNote = pitchToNote(clampedPitch);

    // Use queued pattern if exists, otherwise current pattern
    const queuedChange = getQueuedPattern(loop.id);
    const basePattern = queuedChange ? queuedChange.pattern : (loop.pattern || []);

    // Toggle note - look for existing note at this time/pitch
    // Use subdivision-based time tolerance (half of one grid unit)
    const timeTolerance = (1 / subdivision.quantize) * 0.6;
    const pitchTolerance = 6; // Allow some vertical tolerance (semitones)

    const existingIndex = basePattern.findIndex(n => {
      const noteTime = n.time;
      const notePitch = noteToPitch(n.note);
      const timeDiff = Math.abs(noteTime - quantizedBeat);
      const pitchDiff = Math.abs(notePitch - clampedPitch);
      return timeDiff < timeTolerance && pitchDiff < pitchTolerance;
    });

    console.log('Click:', {
      quantizedBeat,
      clickedNote,
      clampedPitch,
      existingIndex,
      subdivisionValue: subdivision.value,
      subdivisionBeats: subdivision.beats,
      basePatternLength: basePattern.length
    });

    let newPattern: NoteEvent[];
    if (existingIndex >= 0) {
      // Remove the existing note
      console.log('Removing note at index', existingIndex, 'note:', basePattern[existingIndex]);
      newPattern = basePattern.filter((_, i) => i !== existingIndex);
    } else {
      // Add a new note with the selected subdivision's duration
      const newNote: NoteEvent = {
        note: clickedNote,
        time: quantizedBeat,
        duration: subdivision.value,
        velocity: 0.8
      };
      console.log('Adding note with duration:', subdivision.value, 'full note:', newNote);
      newPattern = [...basePattern, newNote].sort((a, b) => a.time - b.time);
    }

    onPatternChange(loop.id, newPattern);

    // Play the note for audition feedback
    if (onPreviewNote && existingIndex < 0) {
      onPreviewNote(clickedNote);
    }
  }, [loops, editableLoopIds, onPatternChange, motherLoopBeats, getQueuedPattern, BEATS_PER_BAR, subdivision, onPreviewNote]);

  // Preview a loop's queued pattern
  const handlePreview = useCallback((loopId: string) => {
    const loop = loops.find(l => l.id === loopId);
    if (!loop || !onPreviewPattern) return;

    const queuedChange = getQueuedPattern(loopId);
    const patternToPreview = queuedChange ? queuedChange.pattern : loop.pattern;

    if (patternToPreview && patternToPreview.length > 0) {
      setPreviewingLoopId(loopId);
      onPreviewPattern(patternToPreview, loop.bars);

      // Auto-stop preview after one cycle
      const cycleDurationMs = (loop.bars * BEATS_PER_BAR * 60 * 1000) / tempo;
      setTimeout(() => {
        setPreviewingLoopId(null);
      }, cycleDurationMs + 100);
    }
  }, [loops, onPreviewPattern, getQueuedPattern, BEATS_PER_BAR, tempo]);

  const handleStopPreview = useCallback(() => {
    if (onStopPreview) {
      onStopPreview();
    }
    setPreviewingLoopId(null);
  }, [onStopPreview]);

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

  // Calculate track positions for controls
  // Increased minimum track height for 3-row presets
  const headerHeight = 40;
  const MIN_TRACK_HEIGHT = 110; // Increased height for 3 rows of presets
  const trackHeight = loops.length > 0 ? Math.max(MIN_TRACK_HEIGHT, (300 - headerHeight) / loops.length) : MIN_TRACK_HEIGHT;

  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', flex: 1 }}
    >
      {/* Canvas is rendered first, controls overlay on top */}
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{
          width: '100%',
          height: loops.length > 0 ? headerHeight + loops.length * MIN_TRACK_HEIGHT : 300,
          minHeight: 300,
          display: 'block',
          background: '#0a0a0f',
          cursor: editableLoopIds.length > 0 ? 'crosshair' : 'default',
        }}
      />

      {/* Subdivision selector */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 120,
        display: 'flex',
        gap: 4,
        zIndex: 10,
        background: 'rgba(10, 10, 15, 0.9)',
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid #252542',
      }}>
        <span style={{ fontSize: 10, color: '#666', marginRight: 4, alignSelf: 'center' }}>Grid:</span>
        {SUBDIVISIONS.map(sub => (
          <button
            key={sub.value}
            onClick={() => setSubdivision(sub)}
            style={{
              background: subdivision.value === sub.value ? '#4ade80' : '#252542',
              color: subdivision.value === sub.value ? '#000' : '#999',
              border: 'none',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 11,
              fontFamily: 'monospace',
              cursor: 'pointer',
              fontWeight: subdivision.value === sub.value ? 'bold' : 'normal',
            }}
          >
            {sub.label}
          </button>
        ))}
      </div>

      {/* Track controls - positioned at the right edge of the track area */}
      {loops.map((loop, index) => {
        const isEditable = editableLoopIds.includes(loop.id);
        const hasQueued = queuedChanges.some(c => c.loopId === loop.id);
        const isPreviewing = previewingLoopId === loop.id;
        const instrumentInfo = INSTRUMENT_INFO[loop.instrument];

        if (!isEditable) return null;

        const trackTop = headerHeight + index * trackHeight;
        const isExpanded = expandedTrackId === loop.id;
        const noteCount = loop.pattern.length;

        // Helper to apply pitch preset
        const applyPitchPreset = (preset: PitchPreset) => {
          if (!onPatternChange || noteCount === 0) return;
          const offsets = preset.getOffsets(noteCount);
          const basePattern = loop.pattern;
          // Get the base pitch from the first note
          const basePitch = noteToPitch(basePattern[0]?.note || 'C4');
          const newPattern: NoteEvent[] = basePattern.map((note, i) => ({
            ...note,
            note: pitchToNote(basePitch + offsets[i])
          }));
          onPatternChange(loop.id, newPattern);
        };

        // Helper to apply rhythm preset
        const applyRhythmPreset = (preset: RhythmPreset) => {
          if (!onPatternChange) return;
          const beats = preset.getBeats(loop.bars);
          // Keep existing pitches and velocities, just redistribute timing
          const oldPattern = loop.pattern;
          const duration = beats.length > 8 ? '16n' : beats.length > 16 ? '32n' : '8n';
          const newPattern: NoteEvent[] = beats.map((time, i) => ({
            note: oldPattern[i % oldPattern.length]?.note || 'C4',
            time,
            duration,
            velocity: oldPattern[i % oldPattern.length]?.velocity || 0.8
          }));
          onPatternChange(loop.id, newPattern);
        };

        // Helper to apply intensity preset
        const applyIntensityPreset = (preset: IntensityPreset, isRandom: boolean) => {
          if (!onPatternChange || noteCount === 0) return;
          const velocities = isRandom
            ? Array.from({ length: noteCount }, () => 0.2 + Math.random() * 0.8)
            : preset.velocities;
          const newPattern: NoteEvent[] = loop.pattern.map((note, j) => ({
            ...note,
            velocity: velocities[j]
          }));
          onPatternChange(loop.id, newPattern);
        };

        return (
          <div key={`controls-${loop.id}`} style={{
            position: 'absolute',
            right: 8,
            top: trackTop + 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: isExpanded ? 100 : 20,
            background: 'rgba(10, 10, 15, 0.95)',
            padding: 4,
            borderRadius: 6,
            border: `1px solid ${instrumentInfo?.color || '#333'}${isExpanded ? '88' : '33'}`,
            boxShadow: isExpanded ? '0 4px 20px rgba(0,0,0,0.6)' : 'none',
          }}>
            {/* Row 1: Controls always visible on top */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {/* Volume */}
              <input
                type="range"
                min="0" max="2" step="0.05"
                value={loop.volume}
                onChange={(e) => onVolumeChange?.(loop.id, parseFloat(e.target.value))}
                style={{ width: isExpanded ? 60 : 40, height: 3, cursor: 'pointer' }}
                title={`Vol: ${Math.round(loop.volume * 100)}%`}
              />

              {/* Transpose */}
              <button onClick={() => onTransposeChange?.(loop.id, loop.transpose - 1)} disabled={loop.transpose <= -12}
                style={{ width: 14, height: 14, background: '#252542', color: '#888', border: 'none', borderRadius: 2, fontSize: 9, cursor: 'pointer', opacity: loop.transpose <= -12 ? 0.3 : 1 }}>−</button>
              <span style={{ fontSize: 8, fontFamily: 'monospace', width: 18, textAlign: 'center', color: loop.transpose === 0 ? '#555' : '#4ade80' }}>
                {loop.transpose > 0 ? `+${loop.transpose}` : loop.transpose}
              </span>
              <button onClick={() => onTransposeChange?.(loop.id, loop.transpose + 1)} disabled={loop.transpose >= 12}
                style={{ width: 14, height: 14, background: '#252542', color: '#888', border: 'none', borderRadius: 2, fontSize: 9, cursor: 'pointer', opacity: loop.transpose >= 12 ? 0.3 : 1 }}>+</button>

              {/* Expand/collapse button */}
              <button
                onClick={(e) => { e.stopPropagation(); setExpandedTrackId(isExpanded ? null : loop.id); }}
                style={{
                  width: 18, height: 14,
                  background: isExpanded ? instrumentInfo?.color || '#4ade80' : '#252542',
                  color: isExpanded ? '#000' : '#888',
                  border: 'none', borderRadius: 2,
                  fontSize: 8, cursor: 'pointer', fontWeight: 'bold',
                }}
                title={isExpanded ? 'Hide presets' : 'Show presets'}
              >{isExpanded ? '▲' : '▼'}</button>

              {/* Solo */}
              <button
                onClick={() => onSoloChange?.(loop.id, soloedLoopId !== loop.id)}
                style={{
                  width: 18, height: 14,
                  background: soloedLoopId === loop.id ? '#eab308' : '#252542',
                  color: soloedLoopId === loop.id ? '#000' : '#888',
                  border: 'none', borderRadius: 2,
                  fontSize: 8, cursor: 'pointer',
                  fontWeight: 'bold',
                }}
                title={soloedLoopId === loop.id ? 'Unsolo' : 'Solo this track'}
              >S</button>

              {/* Preview */}
              <button
                onClick={() => isPreviewing ? handleStopPreview() : handlePreview(loop.id)}
                style={{
                  width: 18, height: 14,
                  background: isPreviewing ? '#f59e0b' : hasQueued ? '#3b82f6' : '#252542',
                  color: isPreviewing ? '#000' : '#fff',
                  border: 'none', borderRadius: 2,
                  fontSize: 8, cursor: 'pointer',
                  opacity: loop.pattern.length > 0 || hasQueued ? 1 : 0.3,
                }}
                title={isPreviewing ? 'Stop' : 'Preview'}
              >{isPreviewing ? '■' : '▶'}</button>
            </div>

            {/* Expanded: Combined preview + 3 scrollable rows */}
            {isExpanded && (() => {
              // Different heights for each row type
              const pitchRowHeight = 24;   // Pitch contour
              const rhythmRowHeight = 20;  // Taller rhythm bars for visibility
              const intensityRowHeight = 24; // Intensity bars
              const previewWidth = 48;     // Preview width for P and I
              const combinedHeight = 68;   // Combined preview height

              // Use queued pattern if exists, otherwise current pattern
              const queuedForThisLoop = queuedChanges.find(c => c.loopId === loop.id);
              const activePattern = queuedForThisLoop ? queuedForThisLoop.pattern : loop.pattern;
              const activeNoteCount = activePattern.length;

              // Create a hash key that changes when pattern changes (for live update)
              const patternKey = activePattern.map(n => `${n.note}-${n.time}-${n.velocity?.toFixed(2)}`).join('|');

              // Detect which presets match the ACTIVE pattern (queued or current)
              // For pitch: compare pitch offsets from base note
              const currentPitchOffsets = activeNoteCount > 0 ? (() => {
                const basePitch = noteToPitch(activePattern[0]?.note || 'C4');
                return activePattern.map(n => noteToPitch(n.note) - basePitch);
              })() : [];

              const matchingPitchPresetId = PITCH_PRESETS.find(preset => {
                if (preset.label === 'Rnd') return false; // Random never matches
                const presetOffsets = preset.getOffsets(activeNoteCount);
                if (presetOffsets.length !== currentPitchOffsets.length) return false;
                return presetOffsets.every((off, i) => Math.abs(off - currentPitchOffsets[i]) < 1);
              })?.id;

              // For rhythm: compare beat timings
              const currentBeats = activePattern.map(n => n.time);
              const matchingRhythmPresetId = RHYTHM_PRESETS.find(preset => {
                const presetBeats = preset.getBeats(loop.bars);
                if (presetBeats.length !== currentBeats.length) return false;
                return presetBeats.every((beat, i) => Math.abs(beat - currentBeats[i]) < 0.1);
              })?.id;

              // For intensity: compare velocities
              const currentVelocities = activePattern.map(n => n.velocity ?? 0.8);
              // Regenerate intensity presets based on active note count
              const activeIntensityPresets = generateIntensityPresets(activeNoteCount);
              const matchingIntensityPresetId = activeIntensityPresets.findIndex(preset => {
                if (preset.velocities.length !== currentVelocities.length) return false;
                return preset.velocities.every((vel, i) => Math.abs(vel - currentVelocities[i]) < 0.05);
              });

              return (
                <div style={{ display: 'flex', gap: 8, borderTop: `1px solid ${instrumentInfo?.color}44`, paddingTop: 4, marginTop: 2, width: 520 }}>
                  {/* Combined preview on left - shows queued pattern if exists, otherwise current */}
                  {(() => {
                    // Check if there's a queued pattern for this loop
                    const queuedChange = queuedChanges.find(c => c.loopId === loop.id);
                    const displayPattern = queuedChange ? queuedChange.pattern : loop.pattern;
                    const displayKey = queuedChange
                      ? displayPattern.map(n => `${n.note}-${n.time}-${n.velocity?.toFixed(2)}`).join('|')
                      : patternKey;
                    return (
                      <CombinedPatternPreview
                        key={displayKey}
                        pattern={displayPattern}
                        bars={loop.bars}
                        height={combinedHeight}
                        color={instrumentInfo?.color || '#4ade80'}
                        label={queuedChange ? 'Pending pattern' : 'Current pattern'}
                      />
                    );
                  })()}

                  {/* 3 scrollable rows on right - no maxWidth, allow scrolling */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                    {/* Row 1: Pitch presets - taller, scrollable */}
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: pitchRowHeight }}>
                      <span style={{ fontSize: 8, color: '#4ade80', width: 12, fontWeight: 'bold', flexShrink: 0 }}>P</span>
                      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', flex: 1, scrollbarWidth: 'thin', paddingBottom: 2 }}>
                        {PITCH_PRESETS.map(preset => {
                          const offsets = preset.getOffsets(8);
                          return (
                            <MiniPitchPreview
                              key={preset.id}
                              offsets={offsets}
                              width={previewWidth}
                              height={pitchRowHeight - 4}
                              color="#4ade80"
                              isRandom={preset.label === 'Rnd'}
                              isSelected={matchingPitchPresetId === preset.id}
                              onClick={() => applyPitchPreset(preset)}
                              label={preset.label}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Row 2: Rhythm presets - slim but wider, scrollable */}
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: rhythmRowHeight }}>
                      <span style={{ fontSize: 8, color: '#3b82f6', width: 12, fontWeight: 'bold', flexShrink: 0 }}>R</span>
                      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', flex: 1, scrollbarWidth: 'thin', paddingBottom: 2 }}>
                        {RHYTHM_PRESETS.map(preset => {
                          const beats = preset.getBeats(loop.bars);
                          return (
                            <MiniRhythmPreview
                              key={preset.id}
                              beats={beats.slice(0, 64)}
                              bars={loop.bars}
                              width={72}
                              height={rhythmRowHeight - 2}
                              color="#3b82f6"
                              isSelected={matchingRhythmPresetId === preset.id}
                              onClick={() => applyRhythmPreset(preset)}
                              label={preset.label}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Row 3: Intensity presets - taller, scrollable */}
                    <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: intensityRowHeight }}>
                      <span style={{ fontSize: 8, color: '#f472b6', width: 12, fontWeight: 'bold', flexShrink: 0 }}>I</span>
                      <div style={{ display: 'flex', gap: 3, overflowX: 'auto', flex: 1, scrollbarWidth: 'thin', paddingBottom: 2 }}>
                        {activeIntensityPresets.map((preset, i) => {
                          const isRandom = i === activeIntensityPresets.length - 1;
                          return (
                            <MiniIntensityPreview
                              key={preset.id}
                              velocities={preset.velocities}
                              width={previewWidth}
                              height={intensityRowHeight - 4}
                              color="#f472b6"
                              isRandom={isRandom}
                              isSelected={matchingIntensityPresetId === i}
                              onClick={() => applyIntensityPreset(preset, isRandom)}
                              label={isRandom ? 'Random' : `Preset ${i + 1}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        );
      })}
    </div>
  );
}
