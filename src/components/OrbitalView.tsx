import { useRef, useEffect, useCallback, useState } from 'react';
import type { Loop, NoteEvent } from '../types';

interface OrbitalViewProps {
  loops: Loop[];
  currentBar: number;
  isPlaying: boolean;
  tempo: number;
  realignmentBar: number;
  onPatternChange?: (loopId: string, pattern: NoteEvent[]) => void;
  editableLoopIds?: string[]; // Which loops the current player can edit
}

// Convert note to pitch value (0-127, MIDI style)
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
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(pitch / 12) - 1;
  const noteName = noteNames[pitch % 12];
  return `${noteName}${octave}`;
}

// Normalize pitch to 0-1 range for visualization (C2=0, C6=1)
function normalizePitch(pitch: number): number {
  const minPitch = 36; // C2
  const maxPitch = 84; // C6
  return Math.max(0, Math.min(1, (pitch - minPitch) / (maxPitch - minPitch)));
}

// Denormalize 0-1 range back to pitch
function denormalizePitch(normalized: number): number {
  const minPitch = 36; // C2
  const maxPitch = 84; // C6
  return Math.round(minPitch + normalized * (maxPitch - minPitch));
}

// Calculate LCM of two numbers
function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}

// Calculate LCM of array of numbers
function lcmArray(arr: number[]): number {
  if (arr.length === 0) return 1;
  return arr.reduce((acc, val) => lcm(acc, val), arr[0]);
}

// Queued pattern change
interface QueuedChange {
  loopId: string;
  pattern: NoteEvent[];
  applyAtBar: number; // Bar number when change should apply
}

export function OrbitalView({
  loops,
  currentBar,
  isPlaying,
  tempo,
  realignmentBar,
  onPatternChange,
  editableLoopIds = [],
}: OrbitalViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [selectedLoop, setSelectedLoop] = useState<string | null>(null);
  const [queuedChanges, setQueuedChanges] = useState<QueuedChange[]>([]);
  const [pendingPattern, setPendingPattern] = useState<NoteEvent[] | null>(null);
  const lastAppliedBarRef = useRef<number>(-1);

  // Store layout info for click detection
  const layoutRef = useRef<{
    centerX: number;
    centerY: number;
    rings: { loopId: string; radius: number; bars: number }[];
    cycleLength: number;
  }>({ centerX: 0, centerY: 0, rings: [], cycleLength: 1 });

  // Apply queued changes when loop restarts
  useEffect(() => {
    if (queuedChanges.length === 0) return;

    const changesToApply = queuedChanges.filter(change => {
      const loop = loops.find(l => l.id === change.loopId);
      if (!loop) return false;
      // Check if we've crossed a loop boundary
      const loopPosition = currentBar % loop.bars;
      return loopPosition === 0 && lastAppliedBarRef.current !== currentBar;
    });

    if (changesToApply.length > 0) {
      changesToApply.forEach(change => {
        if (onPatternChange) {
          onPatternChange(change.loopId, change.pattern);
        }
      });

      // Remove applied changes
      setQueuedChanges(prev =>
        prev.filter(c => !changesToApply.some(applied => applied.loopId === c.loopId))
      );
      setPendingPattern(null);
      lastAppliedBarRef.current = currentBar;
    }
  }, [currentBar, queuedChanges, loops, onPatternChange]);

  // Handle click on canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { centerX, centerY, rings, cycleLength } = layoutRef.current;

    // Calculate distance from center and angle
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let angle = Math.atan2(dy, dx) + Math.PI / 2; // Adjust so 0 is at top
    if (angle < 0) angle += Math.PI * 2;

    // Find which ring was clicked
    const clickedRing = rings.find(ring =>
      Math.abs(distance - ring.radius) < 20 // Within ring width
    );

    if (!clickedRing) {
      setSelectedLoop(null);
      return;
    }

    // Check if this is an editable loop
    const isEditable = editableLoopIds.includes(clickedRing.loopId);
    if (editableLoopIds.length > 0 && !isEditable) {
      // Can't edit other players' loops
      setSelectedLoop(clickedRing.loopId);
      return;
    }

    setSelectedLoop(clickedRing.loopId);

    // Find the loop
    const loop = loops.find(l => l.id === clickedRing.loopId);
    if (!loop || !onPatternChange) return;

    // Calculate time position from angle (only for first repetition of loop)
    const cyclePos = angle / (Math.PI * 2);
    const beatInCycle = cyclePos * cycleLength * 4; // 4 beats per bar
    const beatInLoop = beatInCycle % (loop.bars * 4);
    const quantizedBeat = Math.round(beatInLoop * 2) / 2; // Quantize to 8th notes

    // Calculate pitch from radial offset
    const ringRadius = clickedRing.radius;
    const pitchOffset = (distance - ringRadius) / 16; // -1 to +1 range
    const normalizedPitch = 0.5 + pitchOffset;
    const pitch = denormalizePitch(Math.max(0, Math.min(1, normalizedPitch)));
    const note = pitchToNote(pitch);

    // Check if there's already a note at this position
    const currentPattern = pendingPattern || [...loop.pattern];
    const existingIndex = currentPattern.findIndex(n =>
      Math.abs(n.time - quantizedBeat) < 0.25
    );

    let newPattern: NoteEvent[];
    if (existingIndex >= 0) {
      // Remove existing note
      newPattern = currentPattern.filter((_, i) => i !== existingIndex);
    } else {
      // Add new note
      newPattern = [...currentPattern, {
        note,
        time: quantizedBeat,
        duration: '8n',
        velocity: 0.8
      }].sort((a, b) => a.time - b.time);
    }

    // Queue the change to apply at loop end
    if (isPlaying) {
      setPendingPattern(newPattern);
      setQueuedChanges(prev => {
        // Replace existing queued change for this loop
        const filtered = prev.filter(c => c.loopId !== loop.id);
        return [...filtered, {
          loopId: loop.id,
          pattern: newPattern,
          applyAtBar: Math.ceil(currentBar / loop.bars) * loop.bars
        }];
      });
    } else {
      // Not playing, apply immediately
      onPatternChange(loop.id, newPattern);
    }
  }, [loops, editableLoopIds, onPatternChange, isPlaying, currentBar, pendingPattern]);

  const draw = useCallback(
    () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width, height } = canvas;
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(width, height) / 2 - 60;

      // Clear canvas
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Calculate unified cycle length (LCM of all active loop lengths)
      const activeLoops = loops.filter(l => !l.muted);
      const loopBars = activeLoops.length > 0
        ? activeLoops.map(l => l.bars)
        : loops.map(l => l.bars);
      const cycleLength = loopBars.length > 0 ? lcmArray(loopBars) : 40;

      // Current position in the cycle
      const cyclePosition = currentBar % cycleLength;

      // Store layout for click detection
      const rings: { loopId: string; radius: number; bars: number }[] = [];
      const ringSpacing = 35;
      const baseRadius = maxRadius - (loops.length - 1) * ringSpacing;
      loops.forEach((loop, index) => {
        rings.push({
          loopId: loop.id,
          radius: baseRadius + index * ringSpacing,
          bars: loop.bars
        });
      });
      layoutRef.current = { centerX, centerY, rings, cycleLength };

      // Draw cycle info at top
      ctx.fillStyle = '#888';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Full cycle: ${cycleLength} bars`, centerX, 25);

      // Draw center info
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${cyclePosition + 1}`, centerX, centerY - 5);

      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText(`of ${cycleLength}`, centerX, centerY + 15);

      // Draw tempo
      ctx.fillStyle = '#888';
      ctx.font = '14px monospace';
      ctx.fillText(`${tempo} BPM`, centerX, centerY + 35);

      // Draw playing indicator
      if (isPlaying) {
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(centerX - 45, centerY + 55, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PLAYING', centerX - 35, centerY + 59);
      } else {
        ctx.fillStyle = '#666';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STOPPED', centerX, centerY + 59);
      }

      // Draw unified rings for each loop
      loops.forEach((loop, index) => {
        const radius = baseRadius + index * ringSpacing;
        const isActive = !loop.muted;
        const isSelected = selectedLoop === loop.id;
        const isEditable = editableLoopIds.includes(loop.id);
        const hasQueuedChange = queuedChanges.some(c => c.loopId === loop.id);

        // Draw the ring with cycle divisions
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isActive ? `${loop.color}30` : '#333';
        ctx.lineWidth = 24;
        ctx.stroke();

        // Highlight if selected/editable
        if (isSelected || isEditable) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.strokeStyle = isEditable ? `${loop.color}50` : `${loop.color}20`;
          ctx.lineWidth = 28;
          ctx.stroke();
        }

        // Draw measure markers on the ring
        const markerInterval = Math.max(1, Math.floor(cycleLength / 40));
        for (let i = 0; i < cycleLength; i += markerInterval) {
          const angle = (i / cycleLength) * Math.PI * 2 - Math.PI / 2;
          const innerR = radius - 12;
          const outerR = radius + 12;

          ctx.beginPath();
          ctx.moveTo(
            centerX + Math.cos(angle) * innerR,
            centerY + Math.sin(angle) * innerR
          );
          ctx.lineTo(
            centerX + Math.cos(angle) * outerR,
            centerY + Math.sin(angle) * outerR
          );
          ctx.strokeStyle = i === 0 ? '#fff' : '#444';
          ctx.lineWidth = i === 0 ? 3 : 1;
          ctx.stroke();
        }

        // Draw loop restart markers
        for (let i = 0; i < cycleLength; i += loop.bars) {
          const angle = (i / cycleLength) * Math.PI * 2 - Math.PI / 2;
          const markerX = centerX + Math.cos(angle) * radius;
          const markerY = centerY + Math.sin(angle) * radius;

          ctx.save();
          ctx.translate(markerX, markerY);
          ctx.rotate(angle + Math.PI / 2);

          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(-5, 2);
          ctx.lineTo(5, 2);
          ctx.closePath();
          ctx.fillStyle = isActive ? loop.color : '#555';
          ctx.fill();

          ctx.restore();
        }

        // Get pattern to display (pending if queued, otherwise current)
        const displayPattern = hasQueuedChange
          ? (pendingPattern || loop.pattern)
          : loop.pattern;

        // Draw note pattern visualization
        if (displayPattern && displayPattern.length > 0) {
          const beatsPerBar = 4;

          displayPattern.forEach((note: NoteEvent) => {
            for (let rep = 0; rep < cycleLength / loop.bars; rep++) {
              const baseBar = rep * loop.bars;
              const beatInCycle = baseBar * beatsPerBar + note.time;
              const cyclePos = beatInCycle / (cycleLength * beatsPerBar);

              const angle = cyclePos * Math.PI * 2 - Math.PI / 2;

              const pitch = noteToPitch(note.note);
              const normalizedPitch = normalizePitch(pitch);
              const pitchOffset = (normalizedPitch - 0.5) * 16;

              const noteRadius = radius + pitchOffset;
              const noteX = centerX + Math.cos(angle) * noteRadius;
              const noteY = centerY + Math.sin(angle) * noteRadius;

              // Draw note dot with transparency
              ctx.beginPath();
              ctx.arc(noteX, noteY, isActive ? 4 : 2, 0, Math.PI * 2);
              // Use different opacity for pending changes
              const alpha = hasQueuedChange ? '66' : 'aa';
              ctx.fillStyle = isActive ? `${loop.color}${alpha}` : '#66666666';
              ctx.fill();

              // Add pulsing effect for pending notes
              if (hasQueuedChange && isActive) {
                ctx.beginPath();
                ctx.arc(noteX, noteY, 6, 0, Math.PI * 2);
                ctx.strokeStyle = `${loop.color}44`;
                ctx.lineWidth = 1;
                ctx.stroke();
              }
            }
          });
        }

        // Draw progress arc
        const startAngle = -Math.PI / 2;
        const progressAngle = startAngle + (cyclePosition / cycleLength) * Math.PI * 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, progressAngle);
        ctx.strokeStyle = isActive ? loop.color : '#555';
        ctx.lineWidth = 24;
        ctx.stroke();

        // Draw playhead dot
        const playheadX = centerX + Math.cos(progressAngle) * radius;
        const playheadY = centerY + Math.sin(progressAngle) * radius;

        const gradient = ctx.createRadialGradient(
          playheadX, playheadY, 0,
          playheadX, playheadY, 20
        );
        gradient.addColorStop(0, isActive ? loop.color : '#555');
        gradient.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(playheadX, playheadY, 20, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(playheadX, playheadY, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // Loop label on the left
        ctx.fillStyle = isActive ? loop.color : '#555';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${loop.name}`,
          centerX - radius - 20,
          centerY + 4
        );
        ctx.font = '10px monospace';
        ctx.fillStyle = '#666';
        ctx.fillText(
          `${loop.bars}`,
          centerX - radius - 20,
          centerY + 16
        );

        // Show queued indicator
        if (hasQueuedChange) {
          ctx.fillStyle = '#f59e0b';
          ctx.font = '9px monospace';
          ctx.fillText(
            '⏳ queued',
            centerX - radius - 20,
            centerY + 28
          );
        }
      });

      // Draw "bars until realign" countdown
      if (activeLoops.length > 1) {
        const barsUntilRealign = cycleLength - cyclePosition;
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `↻ ${barsUntilRealign} bars to realign`,
          centerX,
          height - 40
        );
      }

      // Draw editing hint
      if (editableLoopIds.length > 0) {
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Click on your loop to add/remove notes', centerX, height - 22);
      }

      // Legend at bottom
      ctx.fillStyle = '#555';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ = loop restart point', centerX, height - 8);

      animationRef.current = requestAnimationFrame(draw);
    },
    [loops, currentBar, isPlaying, tempo, realignmentBar, selectedLoop, editableLoopIds, queuedChanges, pendingPattern]
  );

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
      onClick={handleCanvasClick}
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
