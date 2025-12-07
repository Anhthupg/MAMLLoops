import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { TimelineView } from './components/TimelineView';
import { LoopPadGrid } from './components/LoopPad';
import { SectionBar } from './components/SectionBar';
import { TransportControls } from './components/TransportControls';
import { RoomJoin, RoomShare } from './components/RoomJoin';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useRoom } from './hooks/useRoom';
import type { NoteEvent } from './types';
import './App.css';

// Queued pattern change
interface QueuedPatternChange {
  loopId: string;
  pattern: NoteEvent[];
  applyAtBar: number;
}

function App() {
  const [isInRoom, setIsInRoom] = useState(false);
  const [queuedChanges, setQueuedChanges] = useState<QueuedPatternChange[]>([]);
  const lastBarRef = useRef(0);

  const audio = useAudioEngine();
  const room = useRoom();

  // Check for room ID in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      // Auto-prompt to join if room ID in URL
    }
  }, []);

  // Handle joining/creating room
  const handleJoin = (name: string, color: string, roomId?: string) => {
    if (roomId) {
      room.joinRoom(roomId, name, color);
    } else {
      room.createRoom(name, color);
    }
    setIsInRoom(true);
  };

  // Sync transport state to other devices
  useEffect(() => {
    if (room.isLeader() && room.roomState) {
      room.updateTransport(
        audio.isPlaying,
        audio.tempo,
        audio.currentBeat,
        audio.currentBar
      );
    }
  }, [audio.isPlaying, audio.tempo, audio.currentBar, room]);

  // Get all active loops from all players
  const allLoops = useMemo(() => {
    if (!room.roomState) return [];
    return room.roomState.players.flatMap((p) =>
      p.loops.filter((l) => !l.muted)
    );
  }, [room.roomState]);

  // Apply queued pattern changes when loop cycles
  useEffect(() => {
    if (queuedChanges.length === 0) return;
    if (audio.currentBar === lastBarRef.current) return;

    lastBarRef.current = audio.currentBar;

    const changesToApply = queuedChanges.filter(change => {
      const loop = room.currentPlayer?.loops.find(l => l.id === change.loopId);
      if (!loop) return false;
      // Check if we've reached or passed the apply bar
      return audio.currentBar >= change.applyAtBar;
    });

    if (changesToApply.length > 0) {
      changesToApply.forEach(change => {
        audio.updateLoopPattern(change.loopId, change.pattern);
      });

      // Remove applied changes
      setQueuedChanges(prev =>
        prev.filter(c => !changesToApply.some(a => a.loopId === c.loopId))
      );
    }
  }, [audio.currentBar, queuedChanges, room.currentPlayer, audio]);

  // Handle loop toggle with audio sync
  const handleLoopToggle = (loopId: string, active: boolean) => {
    const player = room.currentPlayer;
    if (!player) return;

    const loop = player.loops.find((l) => l.id === loopId);
    if (!loop) return;

    audio.toggleLoop({ ...loop, muted: !active }, active);
    room.triggerLoop(loopId, active);
  };

  // Handle pattern change - queue it for next loop cycle
  const handlePatternChange = useCallback((loopId: string, pattern: NoteEvent[]) => {
    const player = room.currentPlayer;
    if (!player) return;

    const loop = player.loops.find((l) => l.id === loopId);
    if (!loop) return;

    // Calculate when this loop will next restart
    const currentBar = audio.currentBar;
    const loopBars = loop.bars;
    const nextLoopStart = Math.ceil((currentBar + 1) / loopBars) * loopBars;

    // Queue the change
    setQueuedChanges(prev => {
      // Replace any existing queued change for this loop
      const filtered = prev.filter(c => c.loopId !== loopId);
      return [...filtered, {
        loopId,
        pattern,
        applyAtBar: nextLoopStart
      }];
    });
  }, [room.currentPlayer, audio.currentBar]);

  // Show join screen if not in room
  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoin} />;
  }

  const { roomState, currentPlayer } = room;

  if (!roomState || !currentPlayer) {
    return <div className="loading">Connecting...</div>;
  }

  const isLeader = room.isLeader();

  return (
    <div className="app">
      <header className="app-header">
        <h1>MAML Loops</h1>
        <RoomShare
          roomId={roomState.id}
          playerCount={roomState.players.length}
          connectionStatus={room.connectionStatus}
        />
      </header>

      <main className="app-main">
        {/* Full-width timeline at top */}
        <div className="timeline-section">
          <TimelineView
            loops={allLoops}
            currentBar={audio.currentBar}
            currentBeat={audio.currentBeat}
            isPlaying={audio.isPlaying}
            tempo={audio.tempo}
            onPatternChange={handlePatternChange}
            editableLoopIds={currentPlayer?.loops.map(l => l.id)}
            queuedChanges={queuedChanges}
          />
        </div>

        {/* Controls row */}
        <div className="controls-row">
          <div className="transport-section">
            <TransportControls
              isPlaying={audio.isPlaying}
              tempo={audio.tempo}
              isLeader={isLeader}
              onPlay={audio.start}
              onStop={audio.stop}
              onTempoChange={audio.changeTempo}
            />
          </div>

          <div className="sections-container">
            <SectionBar
              sections={roomState.sections}
              currentSectionIndex={roomState.currentSectionIndex}
              nextSectionIndex={roomState.nextSectionIndex}
              currentBar={audio.currentBar}
              isLeader={isLeader}
              onQueueSection={room.queueSection}
              onChangeSection={room.changeSection}
            />
          </div>

          <div className="edit-hint">
            <span>Click on timeline to add/remove notes</span>
            <span className="key">Changes apply on next loop cycle</span>
          </div>
        </div>

        {/* Loop pads */}
        <div className="loop-pads-section">
          {roomState.players.map((player) => (
            <LoopPadGrid
              key={player.id}
              loops={player.loops}
              currentBar={audio.currentBar}
              onToggle={
                player.id === currentPlayer.id
                  ? handleLoopToggle
                  : () => {}
              }
              playerName={
                player.id === currentPlayer.id
                  ? `${player.name} (You)`
                  : player.name
              }
              playerColor={player.color}
            />
          ))}
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Inspired by Philip Glass • Polymetric patterns meet collaborative music-making
        </p>
      </footer>
    </div>
  );
}

export default App;
