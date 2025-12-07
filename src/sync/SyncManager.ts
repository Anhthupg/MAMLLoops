import { v4 as uuidv4 } from 'uuid';
import Peer, { DataConnection } from 'peerjs';
import type { RoomState, Player, SyncMessage, Loop, Section } from '../types';

type MessageHandler = (message: SyncMessage) => void;

// Cross-device sync using PeerJS (WebRTC)
class PeerSync {
  private peer: Peer;
  private connections: Map<string, DataConnection> = new Map();
  private handlers: Set<MessageHandler> = new Set();
  private roomId: string;
  private isHost: boolean;
  private hostConnection: DataConnection | null = null;

  constructor(roomId: string, isHost: boolean) {
    this.roomId = roomId;
    this.isHost = isHost;

    // Create peer with room-based ID for host, random for others
    const peerId = isHost ? `maml-${roomId}` : `maml-${roomId}-${uuidv4().slice(0, 6)}`;

    this.peer = new Peer(peerId, {
      debug: 0, // Set to 2 for debugging
    });

    this.peer.on('open', () => {
      console.log('Peer connected:', this.peer.id);
      if (!isHost) {
        // Connect to host
        this.connectToHost();
      }
    });

    this.peer.on('connection', (conn) => {
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('Peer error:', err);
      // If host doesn't exist, we might be the first one
      if (err.type === 'peer-unavailable') {
        console.log('Host not available yet');
      }
    });
  }

  private connectToHost(): void {
    const hostId = `maml-${this.roomId}`;
    console.log('Connecting to host:', hostId);
    const conn = this.peer.connect(hostId, { reliable: true });
    this.hostConnection = conn;
    this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection): void {
    conn.on('open', () => {
      console.log('Connection opened:', conn.peer);
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      const message = data as SyncMessage;
      // Handle received message
      this.handlers.forEach((handler) => handler(message));

      // If we're host, broadcast to all other peers
      if (this.isHost) {
        this.broadcast(message, conn.peer);
      }
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      this.connections.delete(conn.peer);
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
    });
  }

  private broadcast(message: SyncMessage, excludePeer?: string): void {
    this.connections.forEach((conn, peerId) => {
      if (peerId !== excludePeer && conn.open) {
        conn.send(message);
      }
    });
  }

  send(message: SyncMessage): void {
    // Always handle locally first
    this.handlers.forEach((handler) => handler(message));

    if (this.isHost) {
      // Broadcast to all connected peers
      this.broadcast(message);
    } else if (this.hostConnection?.open) {
      // Send to host
      this.hostConnection.send(message);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.connections.forEach((conn) => conn.close());
    this.peer.destroy();
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

// Default loops for new players
const DEFAULT_LOOPS: Omit<Loop, 'id'>[] = [
  { name: 'Glass 4', bars: 4, color: '#f472b6', pattern: [], volume: 0.7, muted: true },
  { name: 'Glass 5', bars: 5, color: '#60a5fa', pattern: [], volume: 0.7, muted: true },
  { name: 'Glass 8', bars: 8, color: '#4ade80', pattern: [], volume: 0.7, muted: true },
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
  private sync: PeerSync;
  private state: RoomState;
  private stateListeners: Set<(state: RoomState) => void> = new Set();
  private isHost: boolean;

  constructor(roomId?: string) {
    // If no roomId provided, we're creating a new room (host)
    this.isHost = !roomId;
    this.roomId = roomId || uuidv4().slice(0, 6).toUpperCase();
    this.playerId = uuidv4();
    this.sync = new PeerSync(this.roomId, this.isHost);

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

    // Small delay to ensure connection is established
    setTimeout(() => {
      this.sync.send({ type: 'join', player });
    }, this.isHost ? 0 : 1000);

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
