import type { Loop } from '../types';
import './LoopPad.css';

interface LoopPadProps {
  loop: Loop;
  currentBar: number;
  onToggle: (loopId: string, active: boolean) => void;
  onEdit?: (loopId: string) => void;
}

export function LoopPad({ loop, currentBar, onToggle, onEdit }: LoopPadProps) {
  const isActive = !loop.muted;
  const phase = (currentBar % loop.bars) / loop.bars;
  const currentLoopBar = (currentBar % loop.bars) + 1;

  const handleClick = (e: React.MouseEvent) => {
    // If shift-click or right-click, open editor
    if (e.shiftKey && onEdit) {
      e.preventDefault();
      onEdit(loop.id);
      return;
    }
    onToggle(loop.id, !isActive);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (onEdit) {
      e.preventDefault();
      onEdit(loop.id);
    }
  };

  return (
    <button
      className={`loop-pad ${isActive ? 'active' : ''} ${onEdit ? 'editable' : ''}`}
      style={{
        '--loop-color': loop.color,
        '--phase': phase,
      } as React.CSSProperties}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <div className="loop-pad-progress" />
      <div className="loop-pad-content">
        <span className="loop-pad-name">{loop.name}</span>
        <span className="loop-pad-bars">{loop.bars} bars</span>
        <span className="loop-pad-position">
          {isActive ? `${currentLoopBar}/${loop.bars}` : 'OFF'}
        </span>
        <span className="loop-pad-notes">{loop.pattern?.length || 0} notes</span>
      </div>
      {onEdit && (
        <button
          className="edit-button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(loop.id);
          }}
          title="Edit pattern"
        >
          ✎
        </button>
      )}
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
  onEdit?: (loopId: string) => void;
  playerName: string;
  playerColor: string;
}

export function LoopPadGrid({
  loops,
  currentBar,
  onToggle,
  onEdit,
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
        {onEdit && <span className="edit-hint">Click ✎ or Shift+Click to edit</span>}
      </div>
      <div className="pads-container">
        {loops.map((loop) => (
          <LoopPad
            key={loop.id}
            loop={loop}
            currentBar={currentBar}
            onToggle={onToggle}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}
