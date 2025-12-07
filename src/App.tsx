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

  // Track previous patterns to detect changes from other users
  const prevPatternsRef = useRef<Map<string, string>>(new Map());

  // Sync pattern changes from other users to local audio engine
  useEffect(() => {
    if (!room.roomState) return;

    // Get all loops from all players (not just current player)
    const allPlayerLoops = room.roomState.players.flatMap(p => p.loops);

    allPlayerLoops.forEach(loop => {
      // Create a hash of the pattern for comparison
      const patternHash = JSON.stringify(loop.pattern);
      const prevHash = prevPatternsRef.current.get(loop.id);

      // If pattern changed and it's not our own loop (we already update our own)
      if (prevHash !== undefined && prevHash !== patternHash) {
        const isOwnLoop = room.currentPlayer?.loops.some(l => l.id === loop.id);
        if (!isOwnLoop) {
          // Update audio engine with the new pattern from other user
          audio.updateLoopPattern(loop.id, loop.pattern);
        }
      }

      // Update the ref
      prevPatternsRef.current.set(loop.id, patternHash);
    });
  }, [room.roomState, room.currentPlayer, audio]);

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
        // Update local audio engine
        audio.updateLoopPattern(change.loopId, change.pattern);
        // Sync pattern to other users
        room.updateLoopPattern(change.loopId, change.pattern);
      });

      // Remove applied changes
      setQueuedChanges(prev =>
        prev.filter(c => !changesToApply.some(a => a.loopId === c.loopId))
      );
    }
  }, [audio.currentBar, queuedChanges, room.currentPlayer, audio, room]);

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

    // Log the pattern for debugging
    console.log('[App] Queueing pattern change for loop:', loopId, 'at bar:', nextLoopStart);
    console.log('[App] Pattern notes:', pattern.map(n => ({ note: n.note, time: n.time, duration: n.duration })));

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
        {/* Compact toolbar row */}
        <div className="toolbar-row">
          <TransportControls
            isPlaying={audio.isPlaying}
            tempo={audio.tempo}
            isLeader={isLeader}
            onPlay={audio.start}
            onStop={audio.stop}
            onTempoChange={audio.changeTempo}
          />
          <SectionBar
            sections={roomState.sections}
            currentSectionIndex={roomState.currentSectionIndex}
            nextSectionIndex={roomState.nextSectionIndex}
            sectionVotes={roomState.sectionVotes || []}
            createSectionVotes={roomState.createSectionVotes || []}
            playerCount={roomState.players.length}
            currentBar={audio.currentBar}
            myPlayerId={currentPlayer.id}
            onVoteSection={room.voteSection}
            onVoteCreateSection={room.voteCreateSection}
          />
        </div>

        {/* Full-width timeline */}
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

        {/* Compact loop pads row */}
        <div className="loop-pads-row">
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
