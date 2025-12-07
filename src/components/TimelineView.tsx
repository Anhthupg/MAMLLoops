import { useRef, useEffect, useCallback, useState } from 'react';
import * as Tone from 'tone';
import type { Loop, NoteEvent, InstrumentType } from '../types';
import { VARIATION_LABELS, INSTRUMENT_INFO } from '../types';
import { patternGenerators } from '../sync/SyncManager';

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
  onVariationChange?: (loopId: string, variation: number, newPattern: NoteEvent[]) => void;
  onVolumeChange?: (loopId: string, volume: number) => void;
  onTransposeChange?: (loopId: string, transpose: number) => void;
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
  onVariationChange,
  onVolumeChange,
  onTransposeChange,
  editableLoopIds = [],
  queuedChanges = [],
}: TimelineViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);
  const [subdivision, setSubdivision] = useState<typeof SUBDIVISIONS[number]>(SUBDIVISIONS[1]); // Default 1/8
  const [previewingLoopId, setPreviewingLoopId] = useState<string | null>(null);

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

      // Current position within THIS loop
      const loopPosition = cycleBeats % loopBeats;
      const loopBar = Math.floor(loopPosition / BEATS_PER_BAR) + 1;
      ctx.fillStyle = isActive ? loop.color : '#444';
      ctx.font = '9px monospace';
      ctx.fillText(`${loopBar}/${loop.bars}`, 6, trackY + 40);

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
            const beatWidth = timelineWidth / motherLoopBeats;
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
    ctx.fillText('Click to add/remove notes • Orange = pending', trackLabelWidth + 5, height - 4);

    animationRef.current = requestAnimationFrame(draw);
  }, [loops, isPlaying, tempo, motherLoopBars, motherLoopBeats, editableLoopIds, hoveredTrack, queuedChanges, getQueuedPattern, BEATS_PER_BAR, subdivision]);

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
  // Fixed minimum track height ensures enough space for vertical volume slider
  const headerHeight = 40;
  const MIN_TRACK_HEIGHT = 70; // Fixed height per track for controls
  const trackHeight = loops.length > 0 ? Math.max(MIN_TRACK_HEIGHT, (300 - headerHeight) / loops.length) : MIN_TRACK_HEIGHT;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
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

      {/* Track controls overlay - positioned in the track label area (left side) */}
      {loops.map((loop, index) => {
        const isEditable = editableLoopIds.includes(loop.id);
        const hasQueued = queuedChanges.some(c => c.loopId === loop.id);
        const isPreviewing = previewingLoopId === loop.id;
        const instrumentInfo = INSTRUMENT_INFO[loop.instrument];

        if (!isEditable) return null;

        const handleVariationSelect = (newVariation: number) => {
          if (onVariationChange && loop.instrument) {
            const generator = patternGenerators[loop.instrument as InstrumentType];
            if (generator) {
              const newPattern = generator(loop.bars, newVariation);
              onVariationChange(loop.id, newVariation, newPattern);
            }
          }
        };

        // Calculate track position - controls go at BOTTOM of track label area
        // Track label area: 80px wide, starts at headerHeight (40px)
        // Text labels in canvas: name at +16, bars at +28, position at +40
        // Controls should go below the text, at the bottom of the track
        const trackTop = headerHeight + index * trackHeight;
        const controlsTop = trackTop + 44; // Below the text labels

        return (
          <div key={`controls-${loop.id}`} style={{
            position: 'absolute',
            left: 4,
            top: controlsTop,
            width: 72, // Fit within the 80px track label area
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            zIndex: 10,
          }}>
            {/* Row 1: Variation dropdown + Preview + Volume label */}
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {/* Variation dropdown */}
              <select
                value={loop.variation ?? 0}
                onChange={(e) => handleVariationSelect(parseInt(e.target.value))}
                style={{
                  width: 28,
                  height: 16,
                  background: '#1a1a2e',
                  color: instrumentInfo?.color || '#fff',
                  border: `1px solid ${instrumentInfo?.color || '#444'}`,
                  borderRadius: 2,
                  fontSize: 9,
                  fontFamily: 'monospace',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  textAlign: 'center',
                  padding: 0,
                }}
                title={`Pattern variation (${VARIATION_LABELS.join(', ')})`}
              >
                {VARIATION_LABELS.map((label, i) => (
                  <option key={label} value={i}>{label}</option>
                ))}
              </select>

              {/* Preview button */}
              <button
                onClick={() => isPreviewing ? handleStopPreview() : handlePreview(loop.id)}
                style={{
                  width: 16,
                  height: 16,
                  background: isPreviewing ? '#f59e0b' : hasQueued ? '#3b82f6' : '#252542',
                  color: isPreviewing ? '#000' : '#fff',
                  border: 'none',
                  borderRadius: 2,
                  fontSize: 7,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: loop.pattern.length > 0 || hasQueued ? 1 : 0.3,
                }}
                title={isPreviewing ? 'Stop preview' : 'Preview pattern'}
                disabled={loop.pattern.length === 0 && !hasQueued}
              >
                {isPreviewing ? '■' : '▶'}
              </button>

              {/* Volume value */}
              <span style={{
                fontSize: 8,
                fontFamily: 'monospace',
                color: instrumentInfo?.color || '#666',
                marginLeft: 2,
              }}>
                {loop.volume <= 0 ? '0' : loop.volume >= 2 ? '2x' : `${Math.round(loop.volume * 100)}%`}
              </span>
            </div>

            {/* Vertical volume slider */}
            <input
              type="range"
              className="slim-slider"
              min="0"
              max="2"
              step="0.05"
              value={loop.volume}
              onChange={(e) => onVolumeChange?.(loop.id, parseFloat(e.target.value))}
              style={{
                width: 36,
                color: instrumentInfo?.color || '#3b82f6',
                cursor: 'pointer',
                transform: 'rotate(-90deg)',
                transformOrigin: 'left center',
                marginTop: 18,
                marginLeft: 30,
              }}
              title={`Volume: ${Math.round(loop.volume * 100)}%`}
            />

            {/* Transpose slider */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginLeft: 4,
              gap: 1,
            }}>
              <span style={{
                fontSize: 7,
                color: '#666',
                fontWeight: 600,
              }}>
                T
              </span>
              <input
                type="range"
                className="slim-slider"
                min="-12"
                max="12"
                step="1"
                value={loop.transpose}
                onChange={(e) => onTransposeChange?.(loop.id, parseInt(e.target.value))}
                style={{
                  width: 36,
                  color: loop.transpose === 0 ? '#666' : loop.transpose > 0 ? '#4ade80' : '#f472b6',
                  cursor: 'pointer',
                  transform: 'rotate(-90deg)',
                  transformOrigin: 'left center',
                  marginTop: 18,
                  marginLeft: 30,
                }}
                title={`Transpose: ${loop.transpose > 0 ? '+' : ''}${loop.transpose} semitones`}
              />
              <span style={{
                fontSize: 8,
                fontFamily: 'monospace',
                color: loop.transpose === 0 ? '#666' : loop.transpose > 0 ? '#4ade80' : '#f472b6',
                fontWeight: loop.transpose === 0 ? 'normal' : 'bold',
              }}>
                {loop.transpose === 0 ? '0' : loop.transpose > 0 ? `+${loop.transpose}` : loop.transpose}
              </span>
            </div>
          </div>
        );
      })}

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
    </div>
  );
}
