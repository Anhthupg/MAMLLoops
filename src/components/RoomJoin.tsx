import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getTracksPerPlayer } from '../sync/SyncManager';
import './RoomJoin.css';

const PLAYER_COLORS = [
  '#f472b6', // Pink
  '#60a5fa', // Blue
  '#4ade80', // Green
  '#fbbf24', // Yellow
  '#a78bfa', // Purple
  '#fb923c', // Orange
];

interface RoomJoinProps {
  onJoin: (name: string, color: string, roomId?: string) => void;
  initialRoomId?: string | null;
}

export function RoomJoin({ onJoin, initialRoomId }: RoomJoinProps) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PLAYER_COLORS[0]);
  const [roomId, setRoomId] = useState(initialRoomId || '');
  // Auto-switch to join mode if room ID is provided via URL
  const [mode, setMode] = useState<'create' | 'join'>(initialRoomId ? 'join' : 'create');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onJoin(name.trim(), selectedColor, mode === 'join' ? roomId : undefined);
    }
  };

  return (
    <div className="room-join">
      <div className="join-header">
        <h1>MAML Loops</h1>
        <p>Polymetric Collaborative Music</p>
      </div>

      <div className="mode-toggle">
        <button
          className={mode === 'create' ? 'active' : ''}
          onClick={() => setMode('create')}
        >
          Create Room
        </button>
        <button
          className={mode === 'join' ? 'active' : ''}
          onClick={() => setMode('join')}
        >
          Join Room
        </button>
      </div>

      <form onSubmit={handleSubmit} className="join-form">
        <div className="form-group">
          <label>Your Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            maxLength={20}
            required
          />
        </div>

        <div className="form-group">
          <label>Your Color</label>
          <div className="color-picker">
            {PLAYER_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-option ${selectedColor === color ? 'selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
              />
            ))}
          </div>
        </div>

        {mode === 'join' && (
          <div className="form-group">
            <label>
              Room Code
              {initialRoomId && <span className="from-qr"> (from link)</span>}
            </label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              maxLength={8}
              required
              readOnly={!!initialRoomId}
              className={initialRoomId ? 'prefilled' : ''}
            />
          </div>
        )}

        <button type="submit" className="join-button">
          {mode === 'create' ? 'Create Room' : 'Join Room'}
        </button>
      </form>

      <div className="glass-quote">
        <p>"Music is a place"</p>
        <span>— Philip Glass</span>
      </div>
    </div>
  );
}

interface RoomShareProps {
  roomId: string;
  playerCount: number;
  connectionStatus?: {
    connected: boolean;
    peerCount: number;
    isHost: boolean;
  };
}

export function RoomShare({ roomId, playerCount, connectionStatus }: RoomShareProps) {
  // Use hash-based URL for better GitHub Pages compatibility
  // Ensure pathname ends without index.html and with trailing slash
  let basePath = window.location.pathname;
  if (basePath.endsWith('index.html')) {
    basePath = basePath.slice(0, -10);
  }
  if (!basePath.endsWith('/')) {
    basePath = basePath + '/';
  }
  const shareUrl = `${window.location.origin}${basePath}#room=${roomId}`;
  const [copied, setCopied] = useState(false);
  const trackInfo = getTracksPerPlayer(playerCount);

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="room-share">
      <div className="share-info">
        <span className="room-code">{roomId}</span>
        <span className="player-count">{playerCount} player{playerCount !== 1 ? 's' : ''}</span>
        <span className="track-allocation" title={`${trackInfo.total} total tracks shared among all players`}>
          {trackInfo.perPlayer} tracks/person
        </span>
        {connectionStatus && (
          <span
            className={`connection-status ${connectionStatus.connected ? 'connected' : 'disconnected'}`}
            title={`${connectionStatus.isHost ? 'Host' : 'Client'} - ${connectionStatus.peerCount} peers`}
          >
            {connectionStatus.connected ? '●' : '○'} {connectionStatus.isHost ? 'Host' : 'Client'}
            {connectionStatus.peerCount > 0 && ` (${connectionStatus.peerCount})`}
          </span>
        )}
      </div>

      <div className="share-actions">
        <button onClick={copyLink} className="copy-button">
          {copied ? 'Copied!' : 'Copy Link'}
        </button>

        <div className="qr-container">
          <QRCodeSVG
            value={shareUrl}
            size={64}
            bgColor="transparent"
            fgColor="#ffffff"
          />
        </div>
      </div>
    </div>
  );
}
