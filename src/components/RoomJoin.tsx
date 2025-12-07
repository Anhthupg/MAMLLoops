import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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
}

export function RoomJoin({ onJoin }: RoomJoinProps) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PLAYER_COLORS[0]);
  const [roomId, setRoomId] = useState('');
  const [mode, setMode] = useState<'create' | 'join'>('create');

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
            <label>Room Code</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toLowerCase())}
              placeholder="Enter room code"
              maxLength={8}
              required
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
}

export function RoomShare({ roomId, playerCount }: RoomShareProps) {
  const shareUrl = `${window.location.origin}?room=${roomId}`;
  const [copied, setCopied] = useState(false);

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
      </div>

      <div className="share-actions">
        <button onClick={copyLink} className="copy-button">
          {copied ? 'Copied!' : 'Copy Link'}
        </button>

        <div className="qr-container">
          <QRCodeSVG
            value={shareUrl}
            size={80}
            bgColor="transparent"
            fgColor="#ffffff"
          />
        </div>
      </div>
    </div>
  );
}
