import type { Loop, InstrumentType } from '../types';
import { INSTRUMENT_INFO } from '../types';
import './LoopPad.css';

// Instrument order for matrix display
const INSTRUMENT_ORDER: InstrumentType[] = ['drums', 'bass', 'arpeggio', 'chord', 'lead', 'fx', 'vocal'];

interface LoopPadProps {
  loop: Loop;
  currentBar: number;
  onToggle: (loopId: string, active: boolean) => void;
  onEdit?: (loopId: string) => void;
  compact?: boolean;
}

export function LoopPad({ loop, currentBar, onToggle, onEdit, compact = false }: LoopPadProps) {
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
      className={`loop-pad ${isActive ? 'active' : ''} ${compact ? 'compact' : ''}`}
      style={{
        '--loop-color': loop.color,
        '--phase': phase,
      } as React.CSSProperties}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={`${instrumentInfo.label} ${loop.bars} bar${loop.bars > 1 ? 's' : ''}`}
    >
      <div className="loop-pad-progress" />
      {compact ? (
        <span className="loop-pad-label">{loop.name}</span>
      ) : (
        <>
          <span className="loop-pad-icon">{instrumentInfo.icon}</span>
          <span className="loop-pad-label">{loop.name}</span>
          <span className="loop-pad-status">
            {isActive ? `${currentLoopBar}/${loop.bars}` : `${loop.bars}b`}
          </span>
        </>
      )}
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
  // Group loops by instrument type
  const loopsByInstrument = INSTRUMENT_ORDER.map(instrument => ({
    instrument,
    info: INSTRUMENT_INFO[instrument],
    loops: loops
      .filter(l => l.instrument === instrument)
      .sort((a, b) => a.bars - b.bars) // Sort by bar count
  })).filter(group => group.loops.length > 0);

  // Count active loops
  const activeCount = loops.filter(l => !l.muted).length;

  return (
    <div className="loop-pad-matrix">
      <div className="player-header" style={{ borderColor: playerColor }}>
        <div
          className="player-dot"
          style={{ backgroundColor: playerColor }}
        />
        <span className="player-name">{playerName}</span>
        {activeCount > 0 && (
          <span className="active-count">{activeCount} active</span>
        )}
      </div>
      <div className="matrix-container">
        {/* Bar length header with descriptive labels */}
        <div className="matrix-header">
          <div className="matrix-label"></div>
          {[1, 2, 3, 4, 5, 6, 7, 8].map(bars => (
            <div key={bars} className="matrix-bar-label" title={`${bars} bar${bars > 1 ? 's' : ''} loop`}>
              <span className="bar-number">{bars}</span>
            </div>
          ))}
        </div>
        {/* Header subtitle */}
        <div className="matrix-header-subtitle">
          <div className="matrix-label"></div>
          <div className="bars-hint">← short loops | long loops →</div>
        </div>
        {/* Instrument rows with full labels */}
        {loopsByInstrument.map(({ instrument, info, loops: instrumentLoops }) => {
          const activeInRow = instrumentLoops.filter(l => !l.muted).length;
          return (
            <div key={instrument} className="matrix-row" style={{ '--row-color': info.color } as React.CSSProperties}>
              <div className="matrix-label" style={{ color: info.color }} title={info.label}>
                <span className="matrix-icon">{info.icon}</span>
                <span className="matrix-label-text">{info.label}</span>
                {activeInRow > 0 && <span className="row-active-dot" style={{ backgroundColor: info.color }} />}
              </div>
              <div className="matrix-cells">
                {[1, 2, 3, 4, 5, 6, 7, 8].map(bars => {
                  const loop = instrumentLoops.find(l => l.bars === bars);
                  if (!loop) return <div key={bars} className="matrix-cell-empty" title={`No ${info.label} ${bars}-bar loop`} />;
                  return (
                    <LoopPad
                      key={loop.id}
                      loop={loop}
                      currentBar={currentBar}
                      onToggle={onToggle}
                      onEdit={onEdit}
                      compact
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="matrix-footer">
        <span className="matrix-hint">Click to toggle • Shift+click to edit</span>
      </div>
    </div>
  );
}
