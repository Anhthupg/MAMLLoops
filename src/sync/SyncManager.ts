import { v4 as uuidv4 } from 'uuid';
import type { RoomState, Player, SyncMessage, Loop, Section } from '../types';

type MessageHandler = (message: SyncMessage) => void;

// For prototype: Use BroadcastChannel for same-device testing
// and a simple WebSocket-like interface for future expansion
class LocalSync {
  private channel: BroadcastChannel;
  private handlers: Set<MessageHandler> = new Set();

  constructor(roomId: string) {
    this.channel = new BroadcastChannel(`maml-room-${roomId}`);
    this.channel.onmessage = (event) => {
      this.handlers.forEach((handler) => handler(event.data));
    };
  }

  send(message: SyncMessage): void {
    this.channel.postMessage(message);
    // Also trigger local handlers for immediate feedback
    this.handlers.forEach((handler) => handler(message));
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.channel.close();
  }
}

// Default loops for new players
const DEFAULT_LOOPS: Omit<Loop, 'id'>[] = [
  { name: 'Pattern 4', bars: 4, color: '#f472b6', pattern: [], volume: 0.7, muted: true },
  { name: 'Pattern 5', bars: 5, color: '#60a5fa', pattern: [], volume: 0.7, muted: true },
  { name: 'Pattern 8', bars: 8, color: '#4ade80', pattern: [], volume: 0.7, muted: true },
];

// Default sections
const DEFAULT_SECTIONS: Omit<Section, 'id'>[] = [
  { name: 'A', loops: [], bars: 16 },
  { name: 'B', loops: [], bars: 16 },
  { name: 'Coda', loops: [], bars: 8 },
];

export class SyncManager {
  private roomId: string;
  private playerId: string;
  private sync: LocalSync;
  private state: RoomState;
  private stateListeners: Set<(state: RoomState) => void> = new Set();

  constructor(roomId?: string) {
    this.roomId = roomId || uuidv4().slice(0, 8);
    this.playerId = uuidv4();
    this.sync = new LocalSync(this.roomId);

    // Initialize state
    this.state = {
      id: this.roomId,
      players: [],
      sections: DEFAULT_SECTIONS.map((s) => ({ ...s, id: uuidv4() })),
      currentSectionIndex: 0,
      nextSectionIndex: null,
      tempo: 120,
      currentBeat: 0,
      currentBar: 0,
      isPlaying: false,
      leaderId: this.playerId, // First to join is leader
    };

    // Listen for sync messages
    this.sync.onMessage(this.handleMessage.bind(this));
  }

  getRoomId(): string {
    return this.roomId;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  getState(): RoomState {
    return this.state;
  }

  isLeader(): boolean {
    return this.state.leaderId === this.playerId;
  }

  // Join the room
  join(playerName: string, playerColor: string): Player {
    const player: Player = {
      id: this.playerId,
      name: playerName,
      color: playerColor,
      loops: DEFAULT_LOOPS.map((l) => ({ ...l, id: uuidv4() })),
      isReady: false,
    };

    this.sync.send({ type: 'join', player });
    return player;
  }

  // Leave the room
  leave(): void {
    this.sync.send({ type: 'leave', playerId: this.playerId });
    this.sync.close();
  }

  // Trigger a loop on/off
  triggerLoop(loopId: string, active: boolean): void {
    this.sync.send({
      type: 'loop_trigger',
      playerId: this.playerId,
      loopId,
      active,
    });
  }

  // Queue next section (leader only)
  queueSection(sectionIndex: number): void {
    if (this.isLeader()) {
      this.sync.send({ type: 'section_queue', sectionIndex });
    }
  }

  // Immediately change section (leader only)
  changeSection(sectionIndex: number): void {
    if (this.isLeader()) {
      this.sync.send({ type: 'section_change', sectionIndex });
    }
  }

  // Update transport state
  updateTransport(isPlaying: boolean, tempo: number, beat: number, bar: number): void {
    if (this.isLeader()) {
      this.sync.send({
        type: 'transport',
        state: {
          isPlaying,
          tempo,
          currentBeat: beat,
          currentBar: bar,
          timeSignature: [4, 4],
        },
      });
    }
  }

  // Set player ready state
  setReady(ready: boolean): void {
    this.sync.send({ type: 'ready', playerId: this.playerId, ready });
  }

  // Request full state sync (for late joiners)
  requestSync(): void {
    // Leader will respond with full state
    if (this.isLeader()) {
      this.sync.send({ type: 'state_sync', state: this.state });
    }
  }

  // Subscribe to state changes
  onStateChange(listener: (state: RoomState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private handleMessage(message: SyncMessage): void {
    switch (message.type) {
      case 'join':
        this.handleJoin(message.player);
        break;
      case 'leave':
        this.handleLeave(message.playerId);
        break;
      case 'transport':
        this.state = {
          ...this.state,
          isPlaying: message.state.isPlaying,
          tempo: message.state.tempo,
          currentBeat: message.state.currentBeat,
          currentBar: message.state.currentBar,
        };
        break;
      case 'loop_trigger':
        this.handleLoopTrigger(message.playerId, message.loopId, message.active);
        break;
      case 'section_queue':
        this.state = { ...this.state, nextSectionIndex: message.sectionIndex };
        break;
      case 'section_change':
        this.state = {
          ...this.state,
          currentSectionIndex: message.sectionIndex,
          nextSectionIndex: null,
        };
        break;
      case 'state_sync':
        // Only accept if we're not the leader
        if (!this.isLeader()) {
          this.state = message.state;
        }
        break;
      case 'ready':
        this.handleReady(message.playerId, message.ready);
        break;
    }

    this.notifyListeners();
  }

  private handleJoin(player: Player): void {
    const exists = this.state.players.find((p) => p.id === player.id);
    if (!exists) {
      this.state = {
        ...this.state,
        players: [...this.state.players, player],
      };

      // If this is a late joiner and we're leader, send them state
      if (this.isLeader() && player.id !== this.playerId) {
        setTimeout(() => {
          this.sync.send({ type: 'state_sync', state: this.state });
        }, 100);
      }
    }
  }

  private handleLeave(playerId: string): void {
    this.state = {
      ...this.state,
      players: this.state.players.filter((p) => p.id !== playerId),
    };

    // If leader left, assign new leader
    if (this.state.leaderId === playerId && this.state.players.length > 0) {
      this.state.leaderId = this.state.players[0].id;
    }
  }

  private handleLoopTrigger(playerId: string, loopId: string, active: boolean): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) => {
        if (p.id === playerId) {
          return {
            ...p,
            loops: p.loops.map((l) =>
              l.id === loopId ? { ...l, muted: !active } : l
            ),
          };
        }
        return p;
      }),
    };
  }

  private handleReady(playerId: string, ready: boolean): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) =>
        p.id === playerId ? { ...p, isReady: ready } : p
      ),
    };
  }

  private notifyListeners(): void {
    this.stateListeners.forEach((listener) => listener(this.state));
  }
}
