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
  isPending?: boolean; // True if loop is queued to start at next cycle
  isPendingStop?: boolean; // True if loop is scheduled to stop at next cycle
}

export function LoopPad({ loop, currentBar, onToggle, onEdit, compact = false, isPending = false, isPendingStop = false }: LoopPadProps) {
  const isActive = !loop.muted;
  const phase = (currentBar % loop.bars) / loop.bars;
  const currentLoopBar = (currentBar % loop.bars) + 1;
  const barsRemaining = loop.bars - (currentBar % loop.bars);

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

  // Determine title based on state
  let title = `${instrumentInfo.label} ${loop.bars} bar${loop.bars > 1 ? 's' : ''}`;
  if (isPending) {
    title = `${instrumentInfo.label} - Queued (starting next cycle)`;
  } else if (isPendingStop) {
    title = `${instrumentInfo.label} - Ending in ${barsRemaining} bar${barsRemaining > 1 ? 's' : ''}`;
  }

  // Determine status text
  let statusText = isActive ? `${currentLoopBar}/${loop.bars}` : `${loop.bars}b`;
  if (isPending) {
    statusText = 'Queued';
  } else if (isPendingStop) {
    statusText = `Out ${barsRemaining}`;
  }

  return (
    <button
      className={`loop-pad ${isActive ? 'active' : ''} ${compact ? 'compact' : ''} ${isPending ? 'pending' : ''} ${isPendingStop ? 'pending-stop' : ''}`}
      style={{
        '--loop-color': loop.color,
        '--phase': phase,
      } as React.CSSProperties}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={title}
    >
      <div className="loop-pad-progress" />
      {compact ? (
        <>
          <span className="loop-pad-label">{loop.name}</span>
          {isPending && <span className="pending-indicator">...</span>}
          {isPendingStop && <span className="pending-indicator">⏹</span>}
        </>
      ) : (
        <>
          <span className="loop-pad-icon">{instrumentInfo.icon}</span>
          <span className="loop-pad-label">{loop.name}</span>
          <span className="loop-pad-status">{statusText}</span>
        </>
      )}
    </button>
  );
}

interface InOutEvent {
  loopName: string;
  type: 'in' | 'out';
  instrument: string;
}

interface LoopPadGridProps {
  loops: Loop[];
  currentBar: number;
  onToggle: (loopId: string, active: boolean) => void;
  onEdit?: (loopId: string) => void;
  playerName: string;
  playerColor: string;
  pendingLoopIds?: string[]; // IDs of loops that are queued to start
  pendingStopLoopIds?: string[]; // IDs of loops that are queued to stop
}

export function LoopPadGrid({
  loops,
  currentBar,
  onToggle,
  onEdit,
  playerName,
  playerColor,
  pendingLoopIds = [],
  pendingStopLoopIds = [],
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

  // Build in/out event list
  const inOutEvents: InOutEvent[] = [];

  // "In" events - loops pending to start
  pendingLoopIds.forEach(loopId => {
    const loop = loops.find(l => l.id === loopId);
    if (loop) {
      const info = INSTRUMENT_INFO[loop.instrument] || INSTRUMENT_INFO.arpeggio;
      inOutEvents.push({
        loopName: loop.name,
        type: 'in',
        instrument: info.icon
      });
    }
  });

  // "Out" events - loops pending to stop
  pendingStopLoopIds.forEach(loopId => {
    const loop = loops.find(l => l.id === loopId);
    if (loop) {
      const info = INSTRUMENT_INFO[loop.instrument] || INSTRUMENT_INFO.arpeggio;
      inOutEvents.push({
        loopName: loop.name,
        type: 'out',
        instrument: info.icon
      });
    }
  });

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
        {/* In/Out event signals */}
        {inOutEvents.length > 0 && (
          <div className="in-out-events">
            {inOutEvents.map((event, idx) => (
              <span
                key={`${event.type}-${event.loopName}-${idx}`}
                className={`in-out-event ${event.type}`}
                title={`${event.loopName} ${event.type === 'in' ? 'coming in' : 'going out'}`}
              >
                <span className="event-icon">{event.instrument}</span>
                <span className="event-type">{event.type}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="matrix-container">
        {/* Header hint */}
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
                    <div key={loop.id} className="loop-pad-wrapper">
                      <LoopPad
                        loop={loop}
                        currentBar={currentBar}
                        onToggle={onToggle}
                        onEdit={onEdit}
                        compact
                        isPending={pendingLoopIds.includes(loop.id)}
                        isPendingStop={pendingStopLoopIds.includes(loop.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="matrix-footer">
        <span className="matrix-hint">
          Click to toggle • Shift+click to edit
        </span>
      </div>
    </div>
  );
}
