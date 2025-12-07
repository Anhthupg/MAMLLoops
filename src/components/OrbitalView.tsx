import { useRef, useEffect, useCallback } from 'react';
import type { Loop } from '../types';

interface OrbitalViewProps {
  loops: Loop[];
  currentBar: number;
  isPlaying: boolean;
  tempo: number;
  realignmentBar: number;
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
  const lastTimeRef = useRef<number>(0);

  const draw = useCallback(
    (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Update time tracking
      lastTimeRef.current = timestamp;

      // Clear canvas
      const { width, height } = canvas;
      const centerX = width / 2;
      const centerY = height / 2;
      const maxRadius = Math.min(width, height) / 2 - 40;

      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Draw center point
      ctx.beginPath();
      ctx.arc(centerX, centerY, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Draw realignment indicator
      if (realignmentBar > 0) {
        const barsUntilRealign = realignmentBar - (currentBar % realignmentBar);
        ctx.fillStyle = '#666';
        ctx.font = '14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `Realign in ${barsUntilRealign} bars`,
          centerX,
          height - 20
        );
      }

      // Sort loops by bar count for layering (larger orbits in back)
      const sortedLoops = [...loops].sort((a, b) => b.bars - a.bars);

      // Draw each loop as an orbital ring
      sortedLoops.forEach((loop, index) => {
        const radius = maxRadius * (0.3 + (index / (loops.length || 1)) * 0.6);
        const phase = (currentBar % loop.bars) / loop.bars;

        // Draw orbit ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `${loop.color}40`;
        ctx.lineWidth = 20;
        ctx.stroke();

        // Draw bar divisions on the ring
        for (let i = 0; i < loop.bars; i++) {
          const angle = (i / loop.bars) * Math.PI * 2 - Math.PI / 2;
          const innerX = centerX + Math.cos(angle) * (radius - 15);
          const innerY = centerY + Math.sin(angle) * (radius - 15);
          const outerX = centerX + Math.cos(angle) * (radius + 15);
          const outerY = centerY + Math.sin(angle) * (radius + 15);

          ctx.beginPath();
          ctx.moveTo(innerX, innerY);
          ctx.lineTo(outerX, outerY);
          ctx.strokeStyle = `${loop.color}80`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Draw progress arc
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + phase * Math.PI * 2;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.strokeStyle = loop.muted ? '#666' : loop.color;
        ctx.lineWidth = 20;
        ctx.stroke();

        // Draw playhead (bright dot on the ring)
        const playheadAngle = startAngle + phase * Math.PI * 2;
        const playheadX = centerX + Math.cos(playheadAngle) * radius;
        const playheadY = centerY + Math.sin(playheadAngle) * radius;

        // Glow effect
        const gradient = ctx.createRadialGradient(
          playheadX,
          playheadY,
          0,
          playheadX,
          playheadY,
          20
        );
        gradient.addColorStop(0, loop.muted ? '#666' : loop.color);
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.arc(playheadX, playheadY, 20, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Playhead dot
        ctx.beginPath();
        ctx.arc(playheadX, playheadY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // Loop label
        ctx.fillStyle = loop.muted ? '#666' : loop.color;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          `${loop.name} (${loop.bars} bars)`,
          centerX,
          centerY - radius - 25
        );
      });

      // Draw current bar count
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`Bar ${currentBar + 1}`, centerX, centerY + 5);

      // Draw tempo
      ctx.fillStyle = '#888';
      ctx.font = '14px monospace';
      ctx.fillText(`${tempo} BPM`, centerX, centerY + 25);

      // Draw playing indicator
      if (isPlaying) {
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(centerX - 30, centerY + 50, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4ade80';
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('PLAYING', centerX - 20, centerY + 54);
      } else {
        ctx.fillStyle = '#888';
        ctx.font = '12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('STOPPED', centerX, centerY + 54);
      }

      animationRef.current = requestAnimationFrame(draw);
    },
    [loops, currentBar, isPlaying, tempo, realignmentBar]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size
    const resize = () => {
      const container = canvas.parentElement;
      if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      }
    };

    resize();
    window.addEventListener('resize', resize);

    // Start animation loop
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
