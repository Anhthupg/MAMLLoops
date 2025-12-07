import type { Loop } from '../types';
import './LoopPad.css';

interface LoopPadProps {
  loop: Loop;
  currentBar: number;
  onToggle: (loopId: string, active: boolean) => void;
}

export function LoopPad({ loop, currentBar, onToggle }: LoopPadProps) {
  const isActive = !loop.muted;
  const phase = (currentBar % loop.bars) / loop.bars;
  const currentLoopBar = (currentBar % loop.bars) + 1;

  return (
    <button
      className={`loop-pad ${isActive ? 'active' : ''}`}
      style={{
        '--loop-color': loop.color,
        '--phase': phase,
      } as React.CSSProperties}
      onClick={() => onToggle(loop.id, !isActive)}
    >
      <div className="loop-pad-progress" />
      <div className="loop-pad-content">
        <span className="loop-pad-name">{loop.name}</span>
        <span className="loop-pad-bars">{loop.bars} bars</span>
        <span className="loop-pad-position">
          {isActive ? `${currentLoopBar}/${loop.bars}` : 'OFF'}
        </span>
      </div>
      <div className="loop-pad-ring">
        {Array.from({ length: loop.bars }).map((_, i) => (
          <div
            key={i}
            className={`ring-segment ${i < currentLoopBar && isActive ? 'filled' : ''}`}
            style={{
              transform: `rotate(${(i / loop.bars) * 360}deg)`,
            }}
          />
        ))}
      </div>
    </button>
  );
}

interface LoopPadGridProps {
  loops: Loop[];
  currentBar: number;
  onToggle: (loopId: string, active: boolean) => void;
  playerName: string;
  playerColor: string;
}

export function LoopPadGrid({
  loops,
  currentBar,
  onToggle,
  playerName,
  playerColor,
}: LoopPadGridProps) {
  return (
    <div className="loop-pad-grid">
      <div className="player-header" style={{ borderColor: playerColor }}>
        <div
          className="player-dot"
          style={{ backgroundColor: playerColor }}
        />
        <span>{playerName}</span>
      </div>
      <div className="pads-container">
        {loops.map((loop) => (
          <LoopPad
            key={loop.id}
            loop={loop}
            currentBar={currentBar}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
