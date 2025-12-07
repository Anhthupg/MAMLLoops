import type { Loop } from '../types';
import { INSTRUMENT_INFO } from '../types';
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

  // Get instrument info
  const instrumentInfo = INSTRUMENT_INFO[loop.instrument] || INSTRUMENT_INFO.arpeggio;

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
      className={`loop-pad ${isActive ? 'active' : ''}`}
      style={{
        '--loop-color': loop.color,
        '--phase': phase,
      } as React.CSSProperties}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${loop.name} (${instrumentInfo.label}) - ${loop.bars} bar${loop.bars > 1 ? 's' : ''}`}
    >
      <div className="loop-pad-progress" />
      <span className="loop-pad-emoji">{instrumentInfo.emoji}</span>
      <span className="loop-pad-label">{loop.name}</span>
      <span className="loop-pad-status">
        {isActive ? `${currentLoopBar}/${loop.bars}` : `${loop.bars}b`}
      </span>
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
