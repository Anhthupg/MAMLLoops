import { useEffect, useMemo, useState } from 'react';
import { OrbitalView } from './components/OrbitalView';
import { LoopPadGrid } from './components/LoopPad';
import { SectionBar } from './components/SectionBar';
import { TransportControls } from './components/TransportControls';
import { RoomJoin, RoomShare } from './components/RoomJoin';
import { PatternEditor } from './components/PatternEditor';
import { useAudioEngine } from './hooks/useAudioEngine';
import { useRoom } from './hooks/useRoom';
import type { Loop, NoteEvent } from './types';
import './App.css';

function App() {
  const [isInRoom, setIsInRoom] = useState(false);
  const [editingLoop, setEditingLoop] = useState<Loop | null>(null);

  const audio = useAudioEngine();
  const room = useRoom();

  // Check for room ID in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      // Auto-prompt to join if room ID in URL
      // For now, just show join screen with room pre-filled
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

  // Calculate realignment bar
  const realignmentBar = useMemo(() => {
    const activeBars = allLoops.map((l) => l.bars);
    if (activeBars.length === 0) return 0;
    return audio.calculateRealignment(activeBars);
  }, [allLoops, audio]);

  // Handle loop toggle with audio sync
  const handleLoopToggle = (loopId: string, active: boolean) => {
    // Find the loop
    const player = room.currentPlayer;
    if (!player) return;

    const loop = player.loops.find((l) => l.id === loopId);
    if (!loop) return;

    // Update audio engine
    audio.toggleLoop({ ...loop, muted: !active }, active);

    // Sync to other devices
    room.triggerLoop(loopId, active);
  };

  // Handle opening pattern editor
  const handleEditPattern = (loopId: string) => {
    const player = room.currentPlayer;
    if (!player) return;

    const loop = player.loops.find((l) => l.id === loopId);
    if (loop) {
      setEditingLoop(loop);
    }
  };

  // Handle pattern change from editor
  const handlePatternChange = (loopId: string, pattern: NoteEvent[]) => {
    // Update audio engine with new pattern
    audio.updateLoopPattern(loopId, pattern);

    // Sync to other devices
    if (room.roomState) {
      // TODO: Add updateLoopPattern to useRoom hook when SyncManager supports it
      // For now, we'll just update locally
    }
  };

  // Show join screen if not in room
  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoin} />;
  }

  // Main app view
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
        <div className="visualization-panel">
          <OrbitalView
            loops={allLoops}
            currentBar={audio.currentBar}
            isPlaying={audio.isPlaying}
            tempo={audio.tempo}
            realignmentBar={realignmentBar}
          />
        </div>

        <div className="controls-panel">
          <SectionBar
            sections={roomState.sections}
            currentSectionIndex={roomState.currentSectionIndex}
            nextSectionIndex={roomState.nextSectionIndex}
            currentBar={audio.currentBar}
            isLeader={isLeader}
            onQueueSection={room.queueSection}
            onChangeSection={room.changeSection}
          />

          <TransportControls
            isPlaying={audio.isPlaying}
            tempo={audio.tempo}
            isLeader={isLeader}
            onPlay={audio.start}
            onStop={audio.stop}
            onTempoChange={audio.changeTempo}
          />

          <div className="players-grid">
            {roomState.players.map((player) => (
              <LoopPadGrid
                key={player.id}
                loops={player.loops}
                currentBar={audio.currentBar}
                onToggle={
                  player.id === currentPlayer.id
                    ? handleLoopToggle
                    : () => {} // Only current player can toggle their loops
                }
                onEdit={
                  player.id === currentPlayer.id
                    ? handleEditPattern
                    : undefined // Only current player can edit their loops
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
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Inspired by Philip Glass • Polymetric patterns meet collaborative
          music-making
        </p>
      </footer>

      {/* Pattern Editor Modal */}
      {editingLoop && (
        <PatternEditor
          loop={editingLoop}
          onPatternChange={handlePatternChange}
          onClose={() => setEditingLoop(null)}
        />
      )}
    </div>
  );
}

export default App;
