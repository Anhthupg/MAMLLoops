import { useRef, useEffect, useCallback } from 'react';
import type { Loop } from '../types';

interface OrbitalViewProps {
  loops: Loop[];
  currentBar: number;
  isPlaying: boolean;
  tempo: number;
  realignmentBar: number;
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

export function OrbitalView({
  loops,
  currentBar,
  isPlaying,
  tempo,
  realignmentBar,
}: OrbitalViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

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

      // Draw unified rings for each loop - ALL same size, ALL same divisions
      const ringSpacing = 35;
      const baseRadius = maxRadius - (loops.length - 1) * ringSpacing;

      loops.forEach((loop, index) => {
        const radius = baseRadius + index * ringSpacing;
        const isActive = !loop.muted;

        // Draw the ring with cycle divisions (all rings have same number of divisions)
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isActive ? `${loop.color}30` : '#333';
        ctx.lineWidth = 24;
        ctx.stroke();

        // Draw measure markers on the ring (same for all rings)
        const markerInterval = Math.max(1, Math.floor(cycleLength / 40)); // Don't draw too many
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

        // Draw loop restart markers (where this loop starts over within the cycle)
        for (let i = 0; i < cycleLength; i += loop.bars) {
          const angle = (i / cycleLength) * Math.PI * 2 - Math.PI / 2;
          const markerX = centerX + Math.cos(angle) * radius;
          const markerY = centerY + Math.sin(angle) * radius;

          // Draw restart marker (triangle pointing inward)
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

        // Draw progress arc (how far through the cycle)
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

        // Glow
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

        // Dot
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
          height - 25
        );
      }

      // Legend at bottom
      ctx.fillStyle = '#555';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('▲ = loop restart point', centerX, height - 8);

      animationRef.current = requestAnimationFrame(draw);
    },
    [loops, currentBar, isPlaying, tempo, realignmentBar]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
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
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        background: '#0a0a0f',
      }}
    />
  );
}
