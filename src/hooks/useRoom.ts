import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncManager } from '../sync/SyncManager';
import { audioEngine } from '../audio/AudioEngine';
import type { RoomState, ClockSync } from '../types';

export function useRoom() {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    peerCount: number;
    isHost: boolean;
  }>({ connected: false, peerCount: 0, isHost: false });
  const syncRef = useRef<SyncManager | null>(null);

  // Derive currentPlayer from roomState to keep it in sync
  const currentPlayer = roomState?.players.find(p => p.id === playerId) || null;

  const createRoom = useCallback((playerName: string, playerColor: string) => {
    const sync = new SyncManager();
    syncRef.current = sync;

    const player = sync.join(playerName, playerColor);
    setPlayerId(player.id);

    sync.onStateChange((state) => {
      setRoomState(state);
    });

    sync.onConnectionStatusChange((connected, peerCount) => {
      setConnectionStatus({ connected, peerCount, isHost: true });
    });

    // Wire up clock sync for audio engine (host doesn't need this, but for completeness)
    sync.onClockSync((clock) => {
      audioEngine.handleClockSync(clock);
    });

    sync.onLatencyUpdate((latency) => {
      audioEngine.setLatency(latency);
    });

    // Initialize state
    setRoomState(sync.getState());

    return sync.getRoomId();
  }, []);

  const joinRoom = useCallback((roomId: string, playerName: string, playerColor: string) => {
    const sync = new SyncManager(roomId);
    syncRef.current = sync;

    const player = sync.join(playerName, playerColor);
    setPlayerId(player.id);

    sync.onStateChange((state) => {
      setRoomState(state);
    });

    sync.onConnectionStatusChange((connected, peerCount) => {
      setConnectionStatus({ connected, peerCount, isHost: false });
    });

    // Wire up clock sync for audio engine - critical for non-host devices
    sync.onClockSync((clock) => {
      audioEngine.handleClockSync(clock);
    });

    sync.onLatencyUpdate((latency) => {
      audioEngine.setLatency(latency);
    });

    // Request sync from existing members
    setTimeout(() => {
      sync.requestSync();
    }, 500);

    return sync.getRoomId();
  }, []);

  const leaveRoom = useCallback(() => {
    if (syncRef.current) {
      syncRef.current.leave();
      syncRef.current = null;
    }
    setRoomState(null);
    setPlayerId(null);
  }, []);

  const triggerLoop = useCallback((loopId: string, active: boolean) => {
    if (syncRef.current) {
      syncRef.current.triggerLoop(loopId, active);
    }
  }, []);

  const updateLoopPattern = useCallback((loopId: string, pattern: import('../types').NoteEvent[]) => {
    if (syncRef.current) {
      syncRef.current.updateLoopPattern(loopId, pattern);
    }
  }, []);

  const queueSection = useCallback((sectionIndex: number) => {
    if (syncRef.current) {
      syncRef.current.queueSection(sectionIndex);
    }
  }, []);

  const changeSection = useCallback((sectionIndex: number) => {
    if (syncRef.current) {
      syncRef.current.changeSection(sectionIndex);
    }
  }, []);

  const updateTransport = useCallback(
    (isPlaying: boolean, tempo: number, beat: number, bar: number) => {
      if (syncRef.current) {
        syncRef.current.updateTransport(isPlaying, tempo, beat, bar);
      }
    },
    []
  );

  const isLeader = useCallback(() => {
    if (syncRef.current && currentPlayer) {
      return syncRef.current.isLeader();
    }
    return false;
  }, [currentPlayer]);

  // Send clock sync (leader only) - call this periodically during playback
  const sendClockSync = useCallback(() => {
    if (syncRef.current && syncRef.current.isLeader()) {
      const position = audioEngine.getCurrentPositionInBars();
      syncRef.current.sendClockSync(position);
    }
  }, []);

  // Ping peers to measure latency
  const pingPeers = useCallback(() => {
    if (syncRef.current) {
      syncRef.current.pingPeers();
    }
  }, []);

  // Handle incoming clock sync (called by SyncManager)
  const handleClockSync = useCallback((clock: ClockSync) => {
    audioEngine.handleClockSync(clock);
  }, []);

  // Start playback with synchronized timing
  const startSyncedPlayback = useCallback((startTime: number) => {
    audioEngine.playSynced(startTime);
  }, []);

  // Get sync stats for debugging
  const getSyncStats = useCallback(() => {
    return {
      latency: audioEngine.getLatency(),
      clockOffset: audioEngine.getClockOffset(),
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (syncRef.current) {
        syncRef.current.leave();
      }
    };
  }, []);

  return {
    roomState,
    currentPlayer,
    connectionStatus,
    createRoom,
    joinRoom,
    leaveRoom,
    triggerLoop,
    updateLoopPattern,
    queueSection,
    changeSection,
    updateTransport,
    isLeader,
    sendClockSync,
    pingPeers,
    handleClockSync,
    startSyncedPlayback,
    getSyncStats,
  };
}
