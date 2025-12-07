import { useCallback, useEffect, useRef, useState } from 'react';
import { SyncManager } from '../sync/SyncManager';
import type { Player, RoomState } from '../types';

export function useRoom() {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const syncRef = useRef<SyncManager | null>(null);

  const createRoom = useCallback((playerName: string, playerColor: string) => {
    const sync = new SyncManager();
    syncRef.current = sync;

    const player = sync.join(playerName, playerColor);
    setCurrentPlayer(player);

    sync.onStateChange((state) => {
      setRoomState(state);
    });

    // Initialize state
    setRoomState(sync.getState());

    return sync.getRoomId();
  }, []);

  const joinRoom = useCallback((roomId: string, playerName: string, playerColor: string) => {
    const sync = new SyncManager(roomId);
    syncRef.current = sync;

    const player = sync.join(playerName, playerColor);
    setCurrentPlayer(player);

    sync.onStateChange((state) => {
      setRoomState(state);
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
    setCurrentPlayer(null);
  }, []);

  const triggerLoop = useCallback((loopId: string, active: boolean) => {
    if (syncRef.current) {
      syncRef.current.triggerLoop(loopId, active);
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
    createRoom,
    joinRoom,
    leaveRoom,
    triggerLoop,
    queueSection,
    changeSection,
    updateTransport,
    isLeader,
  };
}
