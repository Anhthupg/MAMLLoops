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
  const [urlRoomId, setUrlRoomId] = useState<string | null>(null);
  const [soloedLoopId, setSoloedLoopId] = useState<string | null>(null);
  const [pendingLoopIds, setPendingLoopIds] = useState<string[]>([]);
  const [pendingStopLoopIds, setPendingStopLoopIds] = useState<string[]>([]);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const lastBarRef = useRef(0);

  const audio = useAudioEngine();
  const room = useRoom();

  // Check for room ID in URL on mount (supports both query param and hash)
  useEffect(() => {
    console.log('[App] Checking URL for room ID...');
    console.log('[App] window.location.href:', window.location.href);
    console.log('[App] window.location.hash:', window.location.hash);
    console.log('[App] window.location.search:', window.location.search);

    // First check query params (?room=XXX)
    const params = new URLSearchParams(window.location.search);
    let roomParam = params.get('room');

    // Also check hash (#room=XXX) for GitHub Pages compatibility
    if (!roomParam && window.location.hash) {
      const hashMatch = window.location.hash.match(/room=([A-Za-z0-9]+)/);
      console.log('[App] Hash match result:', hashMatch);
      if (hashMatch) {
        roomParam = hashMatch[1];
      }
    }

    console.log('[App] Final roomParam:', roomParam);

    if (roomParam) {
      setUrlRoomId(roomParam.toUpperCase());
    }
  }, []);

  // Handle joining/creating room
  const handleJoin = async (name: string, color: string, roomId?: string) => {
    // Initialize audio on this user gesture (critical for iOS)
    // This is a button click so it satisfies the user interaction requirement
    try {
      await audio.initAudio();
      setNeedsAudioUnlock(false);
    } catch (err) {
      console.warn('Audio init failed, will need unlock:', err);
      setNeedsAudioUnlock(true);
    }

    if (roomId) {
      room.joinRoom(roomId, name, color);
    } else {
      room.createRoom(name, color);
    }
    setIsInRoom(true);
  };

  // Handle audio unlock for iOS (when audio context is still suspended)
  const handleAudioUnlock = useCallback(async () => {
    try {
      await audio.initAudio();
      setNeedsAudioUnlock(false);
      return true;
    } catch (err) {
      console.error('Audio unlock failed:', err);
      return false;
    }
  }, [audio]);

  // Auto-unlock audio on any user interaction (iOS requirement)
  useEffect(() => {
    if (!needsAudioUnlock) return;

    const tryUnlock = async () => {
      const success = await handleAudioUnlock();
      if (success) {
        // Remove all listeners once unlocked
        document.removeEventListener('touchstart', tryUnlock);
        document.removeEventListener('touchend', tryUnlock);
        document.removeEventListener('click', tryUnlock);
        document.removeEventListener('keydown', tryUnlock);
      }
    };

    // Listen for any user interaction
    document.addEventListener('touchstart', tryUnlock, { passive: true });
    document.addEventListener('touchend', tryUnlock, { passive: true });
    document.addEventListener('click', tryUnlock);
    document.addEventListener('keydown', tryUnlock);

    return () => {
      document.removeEventListener('touchstart', tryUnlock);
      document.removeEventListener('touchend', tryUnlock);
      document.removeEventListener('click', tryUnlock);
      document.removeEventListener('keydown', tryUnlock);
    };
  }, [needsAudioUnlock, handleAudioUnlock]);

  // Sync transport state to other devices - use refs to avoid infinite loops
  const lastSyncedTransportRef = useRef({ isPlaying: false, tempo: 120, bar: 0 });

  useEffect(() => {
    const isLeader = room.isLeader();
    if (!isLeader || !room.roomState) return;

    // Only sync if something actually changed
    const last = lastSyncedTransportRef.current;
    if (last.isPlaying === audio.isPlaying &&
        last.tempo === audio.tempo &&
        last.bar === audio.currentBar) {
      return;
    }

    lastSyncedTransportRef.current = {
      isPlaying: audio.isPlaying,
      tempo: audio.tempo,
      bar: audio.currentBar
    };

    room.updateTransport(
      audio.isPlaying,
      audio.tempo,
      audio.currentBeat,
      audio.currentBar
    );
  }, [audio.isPlaying, audio.tempo, audio.currentBar, audio.currentBeat, room]);


  // Get all active loops from all players
  const allLoops = useMemo(() => {
    if (!room.roomState) return [];
    return room.roomState.players.flatMap((p) =>
      p.loops.filter((l) => !l.muted)
    );
  }, [room.roomState]);

  // Subscribe to instant loop state changes from AudioEngine
  // This is called immediately when a scheduled start/stop executes (perfect sync)
  useEffect(() => {
    const unsubscribe = audio.onLoopStateChange((loopId, isPlaying) => {
      console.log('[App] Instant loop state change:', loopId, isPlaying);

      if (isPlaying) {
        // Loop just started - remove from pending start list
        setPendingLoopIds(prev => prev.filter(id => id !== loopId));
      } else {
        // Loop just stopped - remove from pending stop list and update room state
        setPendingStopLoopIds(prev => prev.filter(id => id !== loopId));
        // Update room state immediately when audio stops
        room.triggerLoop(loopId, false);
      }
    });

    return unsubscribe;
  }, [audio, room]);

  // Track which loops are pending (queued to start or stop at next cycle)
  // This only runs on room state changes for initial sync
  // The instant callback (onLoopStateChange) handles real-time updates
  useEffect(() => {
    if (!room.roomState) return;

    // Check all loops from all players for pending state
    const allPlayerLoops = room.roomState.players.flatMap(p => p.loops);

    const pending = allPlayerLoops
      .filter(loop => audio.isLoopPendingStart(loop.id))
      .map(loop => loop.id);

    const pendingStop = allPlayerLoops
      .filter(loop => audio.isLoopPendingStop(loop.id))
      .map(loop => loop.id);

    // Only update React state if changed (compare arrays)
    setPendingLoopIds(prev => {
      if (prev.length !== pending.length || !prev.every((id, i) => id === pending[i])) {
        return pending;
      }
      return prev;
    });

    setPendingStopLoopIds(prev => {
      if (prev.length !== pendingStop.length || !prev.every((id, i) => id === pendingStop[i])) {
        return pendingStop;
      }
      return prev;
    });
  }, [room.roomState, audio]);

  // Each player only hears their own loops from their device
  // Other players' loops are shown visually but not played locally
  // The "mix" happens in person, like a band playing together

  // Track section changes and sync audio engine with snapshot (muted states + patterns)
  const prevSectionRef = useRef<number>(-1);
  useEffect(() => {
    if (!room.roomState) return;

    const currentSection = room.roomState.currentSectionIndex;
    if (prevSectionRef.current !== currentSection) {
      prevSectionRef.current = currentSection;

      // When section changes, sync all loop muted states to audio engine
      console.log('[App] Section changed to:', currentSection);

      room.roomState.players.forEach(player => {
        player.loops.forEach(loop => {
          // Toggle loop based on muted state from room state
          audio.toggleLoop(loop, !loop.muted);

          // Also update pattern in case snapshot restored it
          audio.updateLoopPattern(loop.id, loop.pattern);
        });
      });
    }
  }, [room.roomState, audio]);

  // Apply queued pattern changes when loop cycles
  // The audio scheduling is handled by Tone.js (schedulePatternChange)
  // This useEffect is now only for syncing pattern to other users and UI cleanup
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
        // Sync pattern to other users (audio update is already scheduled via Tone.js)
        room.updateLoopPattern(change.loopId, change.pattern);
      });

      // Remove applied changes from UI queue
      setQueuedChanges(prev =>
        prev.filter(c => !changesToApply.some(a => a.loopId === c.loopId))
      );
    }
  }, [audio.currentBar, queuedChanges, room.currentPlayer, room]);

  // Handle loop toggle with audio sync
  const handleLoopToggle = (loopId: string, active: boolean) => {
    const player = room.currentPlayer;
    if (!player) return;

    const loop = player.loops.find((l) => l.id === loopId);
    if (!loop) return;

    audio.toggleLoop({ ...loop, muted: !active }, active);

    if (active) {
      // When starting: immediately show pending state in UI
      setPendingLoopIds(prev => [...prev.filter(id => id !== loopId), loopId]);
      // Update room state (visual shows pending-start)
      room.triggerLoop(loopId, active);
    } else {
      // When stopping: immediately show pending-stop state in UI
      setPendingStopLoopIds(prev => [...prev.filter(id => id !== loopId), loopId]);
    }
    // The instant callback (onLoopStateChange) will clear these pending states
    // and update room state when the audio actually starts/stops
  };

  // Handle pattern change - schedule it for next loop cycle using Tone.js
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
    console.log('[App] Scheduling pattern change for loop:', loopId, 'at bar:', nextLoopStart);
    console.log('[App] Pattern notes:', pattern.map(n => ({ note: n.note, time: n.time, duration: n.duration })));

    // Schedule the audio change via Tone.js (precise timing)
    audio.schedulePatternChange(loopId, pattern, nextLoopStart);

    // Queue the change in React state for UI preview and sync to other users
    setQueuedChanges(prev => {
      // Replace any existing queued change for this loop
      const filtered = prev.filter(c => c.loopId !== loopId);
      return [...filtered, {
        loopId,
        pattern,
        applyAtBar: nextLoopStart
      }];
    });
  }, [room.currentPlayer, audio.currentBar, audio]);

  // Handle volume change - update audio engine and sync to other devices
  const handleVolumeChange = useCallback((loopId: string, volume: number) => {
    // Update local audio engine immediately
    audio.setLoopVolume(loopId, volume);
    // Sync volume to other users
    room.updateLoopVolume(loopId, volume);
  }, [audio, room]);

  // Handle transpose change - update audio engine and sync to other devices
  const handleTransposeChange = useCallback((loopId: string, transpose: number) => {
    // Update local audio engine immediately
    audio.setLoopTranspose(loopId, transpose);
    // Sync transpose to other users
    room.updateLoopTranspose(loopId, transpose);
  }, [audio, room]);

  // Handle solo change - mute/unmute other tracks
  const handleSoloChange = useCallback((loopId: string, solo: boolean) => {
    const newSoloedId = solo ? loopId : null;
    setSoloedLoopId(newSoloedId);

    // Update volumes: solo mutes all other tracks
    allLoops.forEach(loop => {
      if (newSoloedId === null) {
        // No solo - restore all to normal volume
        audio.setLoopVolume(loop.id, loop.volume);
      } else if (loop.id === newSoloedId) {
        // This is the soloed track - full volume
        audio.setLoopVolume(loop.id, loop.volume);
      } else {
        // Mute non-soloed tracks
        audio.setLoopVolume(loop.id, 0);
      }
    });
  }, [allLoops, audio]);

  // Show join screen if not in room
  if (!isInRoom) {
    return <RoomJoin onJoin={handleJoin} initialRoomId={urlRoomId} />;
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
        {/* iOS Audio Unlock Button - shows when audio context is suspended */}
        {needsAudioUnlock && (
          <button className="audio-unlock-btn" onClick={handleAudioUnlock}>
            🔊 Tap to Enable Sound
          </button>
        )}
      </header>

      <main className="app-main">
        {/* Timeline section */}
        <div className="timeline-section">
          <TimelineView
            loops={allLoops}
            currentBar={audio.currentBar}
            currentBeat={audio.currentBeat}
            isPlaying={audio.isPlaying}
            tempo={audio.tempo}
            onPatternChange={handlePatternChange}
            onPreviewPattern={audio.previewPattern}
            onStopPreview={audio.stopPreview}
            onPreviewNote={audio.playPreviewNote}
            onVolumeChange={handleVolumeChange}
            onTransposeChange={handleTransposeChange}
            onSoloChange={handleSoloChange}
            soloedLoopId={soloedLoopId}
            editableLoopIds={currentPlayer?.loops.map(l => l.id)}
            queuedChanges={queuedChanges}
          />
        </div>

        {/* Controls + Loop pads row */}
        <div className="controls-and-pads-row">
          {/* Transport, Section, and Room controls */}
          <div className="controls-column">
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
            <RoomShare
              roomId={roomState.id}
              playerCount={roomState.players.length}
              connectionStatus={room.connectionStatus}
            />
          </div>

          {/* Loop pads (the matrix) */}
          <div className="loop-pads-row">
            {roomState.players.map((player) => {
              const isCurrentPlayer = player.id === currentPlayer.id;
              return (
                <LoopPadGrid
                  key={player.id}
                  loops={player.loops}
                  currentBar={audio.currentBar}
                  onToggle={isCurrentPlayer ? handleLoopToggle : () => {}}
                  playerName={isCurrentPlayer ? `${player.name} (You)` : player.name}
                  playerColor={player.color}
                  pendingLoopIds={pendingLoopIds}
                  pendingStopLoopIds={pendingStopLoopIds}
                />
              );
            })}
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Inspired by Philip Glass • Polymetric patterns meet collaborative music-making
        </p>
        <p className="copyright">© 2025 Phan Gia Anh Thư. All Rights Reserved.</p>
      </footer>
    </div>
  );
}

export default App;
