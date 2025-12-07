import { v4 as uuidv4 } from 'uuid';
import Peer from 'peerjs';
import type { RoomState, Player, SyncMessage, Loop, Section, NoteEvent } from '../types';

type MessageHandler = (message: SyncMessage) => void;
type ConnectionStatusHandler = (connected: boolean, peerCount: number) => void;

// Cross-device sync using PeerJS (WebRTC)
class PeerSync {
  private peer: Peer | null = null;
  private connections: Map<string, any> = new Map();
  private handlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<ConnectionStatusHandler> = new Set();
  private roomId: string;
  private isHost: boolean;
  private hostConnection: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(roomId: string, isHost: boolean) {
    this.roomId = roomId.toUpperCase(); // Normalize room ID
    this.isHost = isHost;
    this.initPeer();
  }

  private initPeer(): void {
    // Create peer with room-based ID for host, random for others
    const peerId = this.isHost
      ? `maml-${this.roomId}`
      : `maml-${this.roomId}-${Date.now().toString(36)}`;

    console.log('Creating peer with ID:', peerId);

    this.peer = new Peer(peerId, {
      debug: 2, // Enable debugging
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' }
        ]
      }
    });

    this.peer.on('open', (id) => {
      console.log('✅ Peer connected with ID:', id);
      this.reconnectAttempts = 0;

      if (!this.isHost) {
        // Wait a moment then connect to host
        setTimeout(() => this.connectToHost(), 500);
      }

      this.notifyStatus();
    });

    this.peer.on('connection', (conn) => {
      console.log('📥 Incoming connection from:', conn.peer);
      this.setupConnection(conn);
    });

    this.peer.on('error', (err: any) => {
      console.error('❌ Peer error:', err.type, err.message);

      if (err.type === 'peer-unavailable') {
        console.log('Host not found. Make sure the room code is correct.');
      } else if (err.type === 'unavailable-id') {
        console.log('Room already exists or ID conflict');
      }

      this.notifyStatus();
    });

    this.peer.on('disconnected', () => {
      console.log('⚠️ Peer disconnected from server');
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        setTimeout(() => this.peer?.reconnect(), 1000);
      }
    });
  }

  private connectToHost(): void {
    if (!this.peer) return;

    const hostId = `maml-${this.roomId}`;
    console.log('🔗 Connecting to host:', hostId);

    try {
      const conn = this.peer.connect(hostId, {
        reliable: true,
        serialization: 'json'
      });

      if (conn) {
        this.hostConnection = conn;
        this.setupConnection(conn);
      }
    } catch (err) {
      console.error('Failed to connect to host:', err);
    }
  }

  private setupConnection(conn: any): void {
    conn.on('open', () => {
      console.log('✅ Connection opened with:', conn.peer);
      this.connections.set(conn.peer, conn);
      this.notifyStatus();

      // If we're joining, request state sync
      if (!this.isHost && conn === this.hostConnection) {
        console.log('Requesting state sync from host...');
      }
    });

    conn.on('data', (data: any) => {
      console.log('📨 Received data:', data.type);
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
      this.notifyStatus();
    });

    conn.on('error', (err: any) => {
      console.error('Connection error:', err);
    });
  }

  private broadcast(message: SyncMessage, excludePeer?: string): void {
    this.connections.forEach((conn, peerId) => {
      if (peerId !== excludePeer && conn.open) {
        try {
          conn.send(message);
        } catch (err) {
          console.error('Failed to send to peer:', peerId, err);
        }
      }
    });
  }

  private notifyStatus(): void {
    const connected = this.isHost
      ? (this.peer?.open ?? false)
      : (this.hostConnection?.open ?? false);
    const peerCount = this.connections.size;

    this.statusHandlers.forEach(handler => handler(connected, peerCount));
  }

  send(message: SyncMessage): void {
    console.log('📤 Sending:', message.type);

    // Always handle locally first
    this.handlers.forEach((handler) => handler(message));

    if (this.isHost) {
      // Broadcast to all connected peers
      this.broadcast(message);
    } else if (this.hostConnection?.open) {
      // Send to host
      try {
        this.hostConnection.send(message);
      } catch (err) {
        console.error('Failed to send to host:', err);
      }
    } else {
      console.warn('⚠️ Not connected to host yet');
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatusChange(handler: ConnectionStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  close(): void {
    this.connections.forEach((conn) => {
      try { conn.close(); } catch (e) { /* ignore */ }
    });
    this.peer?.destroy();
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  isConnected(): boolean {
    if (this.isHost) {
      return this.peer?.open ?? false;
    }
    return this.hostConnection?.open ?? false;
  }
}

// Glass-inspired default patterns
const GLASS_PATTERN_4: NoteEvent[] = [
  { note: 'C4', time: 0, duration: '8n' },
  { note: 'E4', time: 0.5, duration: '8n' },
  { note: 'G4', time: 1, duration: '8n' },
  { note: 'B4', time: 1.5, duration: '8n' },
  { note: 'C5', time: 2, duration: '8n' },
  { note: 'B4', time: 2.5, duration: '8n' },
  { note: 'G4', time: 3, duration: '8n' },
  { note: 'E4', time: 3.5, duration: '8n' },
];

const GLASS_PATTERN_5: NoteEvent[] = [
  { note: 'D4', time: 0, duration: '8n' },
  { note: 'F#4', time: 0.5, duration: '8n' },
  { note: 'A4', time: 1, duration: '8n' },
  { note: 'C5', time: 1.5, duration: '8n' },
  { note: 'E5', time: 2, duration: '8n' },
  { note: 'C5', time: 2.5, duration: '8n' },
  { note: 'A4', time: 3, duration: '8n' },
  { note: 'F#4', time: 3.5, duration: '8n' },
  { note: 'D4', time: 4, duration: '8n' },
  { note: 'A3', time: 4.5, duration: '8n' },
];

const GLASS_PATTERN_8: NoteEvent[] = [
  { note: 'A3', time: 0, duration: '8n' },
  { note: 'E4', time: 0.5, duration: '8n' },
  { note: 'A4', time: 1, duration: '8n' },
  { note: 'C5', time: 1.5, duration: '8n' },
  { note: 'E5', time: 2, duration: '8n' },
  { note: 'A5', time: 2.5, duration: '8n' },
  { note: 'E5', time: 3, duration: '8n' },
  { note: 'C5', time: 3.5, duration: '8n' },
  { note: 'A4', time: 4, duration: '8n' },
  { note: 'E4', time: 4.5, duration: '8n' },
  { note: 'C4', time: 5, duration: '8n' },
  { note: 'E4', time: 5.5, duration: '8n' },
  { note: 'A4', time: 6, duration: '8n' },
  { note: 'C5', time: 6.5, duration: '8n' },
  { note: 'E5', time: 7, duration: '8n' },
  { note: 'A5', time: 7.5, duration: '8n' },
];

// Default loops for new players
const DEFAULT_LOOPS: Omit<Loop, 'id'>[] = [
  { name: 'Glass 4', bars: 4, color: '#f472b6', pattern: GLASS_PATTERN_4, volume: 0.7, muted: true, instrument: 'synth' },
  { name: 'Glass 5', bars: 5, color: '#60a5fa', pattern: GLASS_PATTERN_5, volume: 0.7, muted: true, instrument: 'synth' },
  { name: 'Glass 8', bars: 8, color: '#4ade80', pattern: GLASS_PATTERN_8, volume: 0.7, muted: true, instrument: 'synth' },
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
  private connectionStatusListeners: Set<(connected: boolean, peerCount: number) => void> = new Set();
  private isHostFlag: boolean;

  constructor(roomId?: string) {
    // If no roomId provided, we're creating a new room (host)
    this.isHostFlag = !roomId;
    // Normalize room ID to uppercase
    this.roomId = (roomId || this.generateRoomCode()).toUpperCase();
    this.playerId = uuidv4();
    this.sync = new PeerSync(this.roomId, this.isHostFlag);

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
      leaderId: this.playerId,
      maxPlayers: 10,
    };

    // Listen for sync messages
    this.sync.onMessage(this.handleMessage.bind(this));

    // Forward connection status
    this.sync.onStatusChange((connected, peerCount) => {
      console.log(`Connection status: ${connected ? 'connected' : 'disconnected'}, peers: ${peerCount}`);
      this.connectionStatusListeners.forEach(listener => listener(connected, peerCount));
    });
  }

  private generateRoomCode(): string {
    // Generate a 4-character alphanumeric code (easier to type)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
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

    // Delay for non-host to ensure connection is established
    const delay = this.isHostFlag ? 100 : 2000;

    setTimeout(() => {
      console.log('Sending join message for player:', player.name);
      this.sync.send({ type: 'join', player });
    }, delay);

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

  // Update transport state with clock sync
  updateTransport(isPlaying: boolean, tempo: number, beat: number, bar: number): void {
    if (this.isLeader()) {
      const now = performance.now();
      this.sync.send({
        type: 'transport',
        state: {
          isPlaying,
          tempo,
          currentBeat: beat,
          currentBar: bar,
          timeSignature: [4, 4],
          serverTime: now,
          startTime: this.state.startTime || now,
        },
      });
    }
  }

  // Send clock sync to all peers (leader only)
  sendClockSync(transportPosition: number): void {
    if (this.isLeader()) {
      this.sync.send({
        type: 'clock_sync',
        clock: {
          leaderTime: performance.now(),
          transportPosition,
          tempo: this.state.tempo,
        },
      });
    }
  }

  // Measure latency to all peers
  pingPeers(): void {
    this.sync.send({ type: 'ping', sendTime: performance.now() });
  }

  // Update a loop's pattern
  updateLoopPattern(loopId: string, pattern: NoteEvent[]): void {
    this.sync.send({
      type: 'loop_update',
      playerId: this.playerId,
      loopId,
      pattern,
    });
  }

  // Set player ready state
  setReady(ready: boolean): void {
    this.sync.send({ type: 'ready', playerId: this.playerId, ready });
  }

  // Request full state sync (for late joiners)
  requestSync(): void {
    if (this.isLeader()) {
      this.sync.send({ type: 'state_sync', state: this.state });
    }
  }

  // Subscribe to state changes
  onStateChange(listener: (state: RoomState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // Subscribe to connection status changes
  onConnectionStatusChange(listener: (connected: boolean, peerCount: number) => void): () => void {
    this.connectionStatusListeners.add(listener);
    return () => this.connectionStatusListeners.delete(listener);
  }

  private handleMessage(message: SyncMessage): void {
    console.log('Handling message:', message.type);

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
        // Accept state sync if we're not the original leader
        if (!this.isHostFlag) {
          this.state = { ...message.state };
          // Keep our player ID as not the leader
        }
        break;
      case 'ready':
        this.handleReady(message.playerId, message.ready);
        break;
      case 'clock_sync':
        // Sync local clock to leader's clock
        if (!this.isHostFlag) {
          this.handleClockSync(message.clock);
        }
        break;
      case 'ping':
        // Respond with pong for latency measurement
        this.sync.send({
          type: 'pong',
          sendTime: message.sendTime,
          receiveTime: performance.now(),
        });
        break;
      case 'pong':
        // Calculate round-trip latency
        this.handlePong(message.sendTime, message.receiveTime);
        break;
      case 'loop_update':
        this.handleLoopUpdate(message.playerId, message.loopId, message.pattern);
        break;
    }

    this.notifyListeners();
  }

  private handleClockSync(clock: { leaderTime: number; transportPosition: number; tempo: number }): void {
    // Store clock offset for synchronization
    const localTime = performance.now();
    const clockOffset = localTime - clock.leaderTime;
    console.log(`Clock sync: offset=${clockOffset.toFixed(2)}ms`);
    // Audio engine can use this to adjust timing
  }

  private handlePong(sendTime: number, _receiveTime: number): void {
    const now = performance.now();
    const roundTrip = now - sendTime;
    const latency = roundTrip / 2;
    console.log(`Latency: ${latency.toFixed(2)}ms (RTT: ${roundTrip.toFixed(2)}ms)`);
  }

  private handleLoopUpdate(playerId: string, loopId: string, pattern: NoteEvent[]): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) => {
        if (p.id === playerId) {
          return {
            ...p,
            loops: p.loops.map((l) =>
              l.id === loopId ? { ...l, pattern } : l
            ),
          };
        }
        return p;
      }),
    };
  }

  private handleJoin(player: Player): void {
    const exists = this.state.players.find((p) => p.id === player.id);
    if (!exists) {
      console.log('Player joined:', player.name);
      this.state = {
        ...this.state,
        players: [...this.state.players, player],
      };

      // If this is a late joiner and we're the host, send them state
      if (this.isHostFlag && player.id !== this.playerId) {
        setTimeout(() => {
          console.log('Sending state sync to new player');
          this.sync.send({ type: 'state_sync', state: this.state });
        }, 500);
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
