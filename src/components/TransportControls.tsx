import './TransportControls.css';

interface TransportControlsProps {
  isPlaying: boolean;
  tempo: number;
  isLeader: boolean;
  onPlay: () => void;
  onStop: () => void;
  onTempoChange: (tempo: number) => void;
}

export function TransportControls({
  isPlaying,
  tempo,
  isLeader,
  onPlay,
  onStop,
  onTempoChange,
}: TransportControlsProps) {
  return (
    <div className="transport-controls">
      <button
        className={`transport-button play ${isPlaying ? 'active' : ''}`}
        onClick={isPlaying ? onStop : onPlay}
        disabled={!isLeader}
        title={isLeader ? '' : 'Only the leader can control playback'}
      >
        {isPlaying ? (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      <button
        className="transport-button stop"
        onClick={onStop}
        disabled={!isLeader || !isPlaying}
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" />
        </svg>
      </button>

      <div className="tempo-control">
        <label>BPM</label>
        <input
          type="range"
          min="60"
          max="180"
          value={tempo}
          onChange={(e) => onTempoChange(Number(e.target.value))}
          disabled={!isLeader}
        />
        <span className="tempo-value">{tempo}</span>
      </div>

      {!isLeader && (
        <div className="sync-indicator">
          <span className="sync-dot" />
          Synced
        </div>
      )}
    </div>
  );
}
