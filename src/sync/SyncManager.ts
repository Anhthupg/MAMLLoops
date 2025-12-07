import { v4 as uuidv4 } from 'uuid';
import Peer from 'peerjs';
import type { RoomState, Player, SyncMessage, Loop, Section, NoteEvent, LoopSnapshot } from '../types';

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
      const message = data as SyncMessage;
      // Only log non-transport messages to avoid spam
      if (message.type !== 'transport' && message.type !== 'clock_sync' && message.type !== 'ping' && message.type !== 'pong') {
        console.log('📨 Received:', message.type);
      }

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
    // Only log non-transport messages to avoid spam
    if (message.type !== 'transport' && message.type !== 'clock_sync' && message.type !== 'ping' && message.type !== 'pong') {
      console.log('📤 Sending:', message.type);
    }

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

// =====================================
// INCREDIBOX-STYLE INSTRUMENT PATTERNS
// =====================================
// Each loop has a different instrument type for a full musical mix

// === DRUMS (1 bar) - Basic beat ===
// C1=Kick, D1=Snare, E1=HiHat
const DRUM_PATTERN: NoteEvent[] = [
  // Beat 1: Kick
  { note: 'C1', time: 0, duration: '8n' },
  { note: 'E1', time: 0.5, duration: '16n' },
  // Beat 2: HiHat
  { note: 'E1', time: 1, duration: '16n' },
  { note: 'E1', time: 1.5, duration: '16n' },
  // Beat 3: Snare + Kick
  { note: 'D1', time: 2, duration: '8n' },
  { note: 'E1', time: 2.5, duration: '16n' },
  // Beat 4: HiHat
  { note: 'E1', time: 3, duration: '16n' },
  { note: 'E1', time: 3.5, duration: '16n' },
];

// === BASS (2 bars) - Groove bass line ===
const BASS_PATTERN: NoteEvent[] = [
  // Bar 1
  { note: 'C2', time: 0, duration: '4n' },
  { note: 'C2', time: 1, duration: '8n' },
  { note: 'G2', time: 1.5, duration: '8n' },
  { note: 'C2', time: 2, duration: '4n' },
  { note: 'Bb1', time: 3, duration: '8n' },
  { note: 'C2', time: 3.5, duration: '8n' },
  // Bar 2
  { note: 'F2', time: 4, duration: '4n' },
  { note: 'F2', time: 5, duration: '8n' },
  { note: 'G2', time: 5.5, duration: '8n' },
  { note: 'Ab2', time: 6, duration: '4n' },
  { note: 'G2', time: 7, duration: '8n' },
  { note: 'F2', time: 7.5, duration: '8n' },
];

// === CHORD (4 bars) - Pad chords ===
const CHORD_PATTERN: NoteEvent[] = [
  // Bar 1: Cm
  { note: 'C4', time: 0, duration: '2n' },
  { note: 'Eb4', time: 0, duration: '2n' },
  { note: 'G4', time: 0, duration: '2n' },
  { note: 'C4', time: 2, duration: '2n' },
  { note: 'Eb4', time: 2, duration: '2n' },
  { note: 'G4', time: 2, duration: '2n' },
  // Bar 2: Fm
  { note: 'F4', time: 4, duration: '2n' },
  { note: 'Ab4', time: 4, duration: '2n' },
  { note: 'C5', time: 4, duration: '2n' },
  { note: 'F4', time: 6, duration: '2n' },
  { note: 'Ab4', time: 6, duration: '2n' },
  { note: 'C5', time: 6, duration: '2n' },
  // Bar 3: Ab
  { note: 'Ab4', time: 8, duration: '2n' },
  { note: 'C5', time: 8, duration: '2n' },
  { note: 'Eb5', time: 8, duration: '2n' },
  { note: 'Ab4', time: 10, duration: '2n' },
  { note: 'C5', time: 10, duration: '2n' },
  { note: 'Eb5', time: 10, duration: '2n' },
  // Bar 4: G
  { note: 'G4', time: 12, duration: '2n' },
  { note: 'B4', time: 12, duration: '2n' },
  { note: 'D5', time: 12, duration: '2n' },
  { note: 'G4', time: 14, duration: '2n' },
  { note: 'B4', time: 14, duration: '2n' },
  { note: 'D5', time: 14, duration: '2n' },
];

// === ARPEGGIO (3 bars) - Glass-style arpeggios ===
const ARPEGGIO_PATTERN: NoteEvent[] = [
  // Bar 1: Cm arpeggio
  { note: 'C4', time: 0, duration: '8n' }, { note: 'Eb4', time: 0.5, duration: '8n' },
  { note: 'G4', time: 1, duration: '8n' }, { note: 'C5', time: 1.5, duration: '8n' },
  { note: 'G4', time: 2, duration: '8n' }, { note: 'Eb4', time: 2.5, duration: '8n' },
  { note: 'C4', time: 3, duration: '8n' }, { note: 'G3', time: 3.5, duration: '8n' },
  // Bar 2: Fm arpeggio
  { note: 'F3', time: 4, duration: '8n' }, { note: 'Ab3', time: 4.5, duration: '8n' },
  { note: 'C4', time: 5, duration: '8n' }, { note: 'F4', time: 5.5, duration: '8n' },
  { note: 'C4', time: 6, duration: '8n' }, { note: 'Ab3', time: 6.5, duration: '8n' },
  { note: 'F3', time: 7, duration: '8n' }, { note: 'C4', time: 7.5, duration: '8n' },
  // Bar 3: G arpeggio
  { note: 'G3', time: 8, duration: '8n' }, { note: 'B3', time: 8.5, duration: '8n' },
  { note: 'D4', time: 9, duration: '8n' }, { note: 'G4', time: 9.5, duration: '8n' },
  { note: 'D4', time: 10, duration: '8n' }, { note: 'B3', time: 10.5, duration: '8n' },
  { note: 'G3', time: 11, duration: '8n' }, { note: 'D4', time: 11.5, duration: '8n' },
];

// === LEAD (5 bars) - Melody line ===
const LEAD_PATTERN: NoteEvent[] = [
  // Bar 1: Opening phrase
  { note: 'G5', time: 0, duration: '4n' },
  { note: 'Eb5', time: 1, duration: '8n' },
  { note: 'F5', time: 1.5, duration: '8n' },
  { note: 'G5', time: 2, duration: '2n' },
  // Bar 2: Response
  { note: 'C6', time: 4, duration: '4n' },
  { note: 'Bb5', time: 5, duration: '8n' },
  { note: 'Ab5', time: 5.5, duration: '8n' },
  { note: 'G5', time: 6, duration: '2n' },
  // Bar 3: Development
  { note: 'F5', time: 8, duration: '4n' },
  { note: 'G5', time: 9, duration: '8n' },
  { note: 'Ab5', time: 9.5, duration: '8n' },
  { note: 'Bb5', time: 10, duration: '4n' },
  { note: 'C6', time: 11, duration: '4n' },
  // Bar 4: Climax
  { note: 'D6', time: 12, duration: '2n' },
  { note: 'C6', time: 14, duration: '4n' },
  { note: 'Bb5', time: 15, duration: '4n' },
  // Bar 5: Resolution
  { note: 'Ab5', time: 16, duration: '4n' },
  { note: 'G5', time: 17, duration: '4n' },
  { note: 'F5', time: 18, duration: '4n' },
  { note: 'G5', time: 19, duration: '4n' },
];

// === FX (7 bars) - Atmospheric texture ===
const FX_PATTERN: NoteEvent[] = [
  // Sparse, atmospheric hits
  { note: 'C6', time: 0, duration: '1n' },
  { note: 'G5', time: 4, duration: '2n' },
  { note: 'Eb6', time: 8, duration: '1n' },
  { note: 'Bb5', time: 12, duration: '2n' },
  { note: 'F6', time: 16, duration: '1n' },
  { note: 'C6', time: 20, duration: '2n' },
  { note: 'G6', time: 24, duration: '2n' },
];

// === VOCAL (8 bars) - Human-like vocal synth ===
const VOCAL_PATTERN: NoteEvent[] = [
  // Bar 1-2: "Ooh"
  { note: 'C5', time: 0, duration: '1n' },
  { note: 'Eb5', time: 2, duration: '2n' },
  { note: 'G5', time: 4, duration: '1n' },
  // Bar 3-4: Response
  { note: 'F5', time: 8, duration: '2n' },
  { note: 'Eb5', time: 10, duration: '2n' },
  { note: 'C5', time: 12, duration: '1n' },
  // Bar 5-6: Build
  { note: 'G5', time: 16, duration: '2n' },
  { note: 'Ab5', time: 18, duration: '2n' },
  { note: 'Bb5', time: 20, duration: '2n' },
  { note: 'C6', time: 22, duration: '2n' },
  // Bar 7-8: Resolution
  { note: 'Bb5', time: 24, duration: '2n' },
  { note: 'Ab5', time: 26, duration: '2n' },
  { note: 'G5', time: 28, duration: '1n' },
];

// === SECOND ARPEGGIO (6 bars) - Complementary pattern ===
const ARPEGGIO_2_PATTERN: NoteEvent[] = [
  // Bar 1: Ab arpeggio (higher register)
  { note: 'Ab4', time: 0, duration: '8n' }, { note: 'C5', time: 0.5, duration: '8n' },
  { note: 'Eb5', time: 1, duration: '8n' }, { note: 'Ab5', time: 1.5, duration: '8n' },
  { note: 'Eb5', time: 2, duration: '8n' }, { note: 'C5', time: 2.5, duration: '8n' },
  { note: 'Ab4', time: 3, duration: '8n' }, { note: 'Eb5', time: 3.5, duration: '8n' },
  // Bar 2: Bb arpeggio
  { note: 'Bb4', time: 4, duration: '8n' }, { note: 'D5', time: 4.5, duration: '8n' },
  { note: 'F5', time: 5, duration: '8n' }, { note: 'Bb5', time: 5.5, duration: '8n' },
  { note: 'F5', time: 6, duration: '8n' }, { note: 'D5', time: 6.5, duration: '8n' },
  { note: 'Bb4', time: 7, duration: '8n' }, { note: 'F5', time: 7.5, duration: '8n' },
  // Bar 3: Eb arpeggio
  { note: 'Eb4', time: 8, duration: '8n' }, { note: 'G4', time: 8.5, duration: '8n' },
  { note: 'Bb4', time: 9, duration: '8n' }, { note: 'Eb5', time: 9.5, duration: '8n' },
  { note: 'Bb4', time: 10, duration: '8n' }, { note: 'G4', time: 10.5, duration: '8n' },
  { note: 'Eb4', time: 11, duration: '8n' }, { note: 'Bb4', time: 11.5, duration: '8n' },
  // Bar 4: F arpeggio
  { note: 'F4', time: 12, duration: '8n' }, { note: 'A4', time: 12.5, duration: '8n' },
  { note: 'C5', time: 13, duration: '8n' }, { note: 'F5', time: 13.5, duration: '8n' },
  { note: 'C5', time: 14, duration: '8n' }, { note: 'A4', time: 14.5, duration: '8n' },
  { note: 'F4', time: 15, duration: '8n' }, { note: 'C5', time: 15.5, duration: '8n' },
  // Bar 5: G arpeggio
  { note: 'G4', time: 16, duration: '8n' }, { note: 'B4', time: 16.5, duration: '8n' },
  { note: 'D5', time: 17, duration: '8n' }, { note: 'G5', time: 17.5, duration: '8n' },
  { note: 'D5', time: 18, duration: '8n' }, { note: 'B4', time: 18.5, duration: '8n' },
  { note: 'G4', time: 19, duration: '8n' }, { note: 'D5', time: 19.5, duration: '8n' },
  // Bar 6: Cm arpeggio (resolve)
  { note: 'C4', time: 20, duration: '8n' }, { note: 'Eb4', time: 20.5, duration: '8n' },
  { note: 'G4', time: 21, duration: '8n' }, { note: 'C5', time: 21.5, duration: '8n' },
  { note: 'G4', time: 22, duration: '8n' }, { note: 'Eb4', time: 22.5, duration: '8n' },
  { note: 'C4', time: 23, duration: '8n' }, { note: 'G4', time: 23.5, duration: '8n' },
];

// Default loops for new players - Incredibox-style instrument matrix
// Fixed mapping: instrument type -> bar length for polymetric feel
// Drums=1bar, Bass=2bars, Arp=3bars, Chords=4bars,
// Lead=5bars, Arp2=6bars, FX=7bars, Vocal=8bars
const DEFAULT_LOOPS: Omit<Loop, 'id'>[] = [
  { name: 'Drums', bars: 1, color: '#ef4444', pattern: DRUM_PATTERN, volume: 0.8, muted: true, instrument: 'drums' },
  { name: 'Bass', bars: 2, color: '#f97316', pattern: BASS_PATTERN, volume: 0.7, muted: true, instrument: 'bass' },
  { name: 'Arp', bars: 3, color: '#eab308', pattern: ARPEGGIO_PATTERN, volume: 0.6, muted: true, instrument: 'arpeggio' },
  { name: 'Chords', bars: 4, color: '#22c55e', pattern: CHORD_PATTERN, volume: 0.5, muted: true, instrument: 'chord' },
  { name: 'Lead', bars: 5, color: '#3b82f6', pattern: LEAD_PATTERN, volume: 0.6, muted: true, instrument: 'lead' },
  { name: 'Arp 2', bars: 6, color: '#14b8a6', pattern: ARPEGGIO_2_PATTERN, volume: 0.5, muted: true, instrument: 'arpeggio' },
  { name: 'FX', bars: 7, color: '#8b5cf6', pattern: FX_PATTERN, volume: 0.4, muted: true, instrument: 'fx' },
  { name: 'Vocal', bars: 8, color: '#ec4899', pattern: VOCAL_PATTERN, volume: 0.6, muted: true, instrument: 'vocal' },
];

// Default sections
const DEFAULT_SECTIONS: Omit<Section, 'id'>[] = [
  { name: 'Intro', loops: [], bars: 8, hasMemory: false },
  { name: 'A', loops: [], bars: 16, hasMemory: false },
  { name: 'B', loops: [], bars: 16, hasMemory: false },
  { name: 'C', loops: [], bars: 16, hasMemory: false },
  { name: 'Bridge', loops: [], bars: 8, hasMemory: false },
  { name: 'Coda', loops: [], bars: 8, hasMemory: false },
];

export class SyncManager {
  private roomId: string;
  private playerId: string;
  private sync: PeerSync;
  private state: RoomState;
  private stateListeners: Set<(state: RoomState) => void> = new Set();
  private connectionStatusListeners: Set<(connected: boolean, peerCount: number) => void> = new Set();
  private clockSyncListeners: Set<(clock: { leaderTime: number; transportPosition: number; tempo: number }) => void> = new Set();
  private latencyListeners: Set<(latency: number) => void> = new Set();
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
      sectionVotes: [],
      createSectionVotes: [],
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

  // Vote for next section (any player can vote)
  voteSection(sectionIndex: number): void {
    this.sync.send({
      type: 'section_vote',
      playerId: this.playerId,
      sectionIndex,
    });
  }

  // Vote to create a new section from current loop state
  voteCreateSection(hasMemory: boolean): void {
    const loopStateHash = this.computeLoopStateHash();
    this.sync.send({
      type: 'create_section_vote',
      playerId: this.playerId,
      hasMemory,
      loopStateHash,
    });
  }

  // Compute hash of current active loop state (for detecting changes)
  private computeLoopStateHash(): string {
    const activeLoops = this.state.players.flatMap(p =>
      p.loops.filter(l => !l.muted).map(l => ({
        id: l.id,
        playerId: p.id,
        patternHash: JSON.stringify(l.pattern).substring(0, 50) // Simple pattern fingerprint
      }))
    );
    return JSON.stringify(activeLoops);
  }

  // Create snapshot of current loop states
  private createLoopSnapshot(): LoopSnapshot[] {
    return this.state.players.flatMap(p =>
      p.loops.filter(l => !l.muted).map(l => ({
        loopId: l.id,
        playerId: p.id,
        pattern: [...l.pattern],
        muted: l.muted,
      }))
    );
  }

  // Generate next section name (e.g., "D", "E", or "A2" if A exists)
  private generateNextSectionName(): string {
    const existing = new Set(this.state.sections.map(s => s.name));
    const letters = 'DEFGHIJ';
    for (const letter of letters) {
      if (!existing.has(letter)) return letter;
    }
    // If all letters used, add numbers
    let num = 2;
    while (existing.has(`A${num}`)) num++;
    return `A${num}`;
  }

  // Queue next section (leader only, or triggered by majority vote)
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

  // Subscribe to clock sync messages (for audio engine)
  onClockSync(listener: (clock: { leaderTime: number; transportPosition: number; tempo: number }) => void): () => void {
    this.clockSyncListeners.add(listener);
    return () => this.clockSyncListeners.delete(listener);
  }

  // Subscribe to latency updates
  onLatencyUpdate(listener: (latency: number) => void): () => void {
    this.latencyListeners.add(listener);
    return () => this.latencyListeners.delete(listener);
  }

  private handleMessage(message: SyncMessage): void {
    // Only log non-transport messages to avoid spam
    if (message.type !== 'transport' && message.type !== 'clock_sync') {
      console.log('Handling message:', message.type);
    }

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
      case 'section_vote':
        this.handleSectionVote(message.playerId, message.sectionIndex);
        break;
      case 'section_queue':
        this.state = { ...this.state, nextSectionIndex: message.sectionIndex, sectionVotes: [] };
        break;
      case 'section_change':
        this.state = {
          ...this.state,
          currentSectionIndex: message.sectionIndex,
          nextSectionIndex: null,
          sectionVotes: [],
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
      case 'create_section_vote':
        this.handleCreateSectionVote(message.playerId, message.hasMemory, message.loopStateHash);
        break;
      case 'create_section_reset':
        this.state = { ...this.state, createSectionVotes: [] };
        break;
    }

    this.notifyListeners();
  }

  private handleClockSync(clock: { leaderTime: number; transportPosition: number; tempo: number }): void {
    // Store clock offset for synchronization (no logging to avoid spam)
    this.clockSyncListeners.forEach(listener => listener(clock));
  }

  private handlePong(sendTime: number, _receiveTime: number): void {
    const now = performance.now();
    const roundTrip = now - sendTime;
    const latency = roundTrip / 2;
    // Notify listeners about latency (no logging to avoid spam)
    this.latencyListeners.forEach(listener => listener(latency));
  }

  private handleSectionVote(playerId: string, sectionIndex: number): void {
    // Update or add vote for this player
    const existingVoteIndex = this.state.sectionVotes.findIndex(v => v.playerId === playerId);
    let newVotes = [...this.state.sectionVotes];

    if (existingVoteIndex >= 0) {
      // Update existing vote
      newVotes[existingVoteIndex] = { playerId, sectionIndex };
    } else {
      // Add new vote
      newVotes.push({ playerId, sectionIndex });
    }

    this.state = { ...this.state, sectionVotes: newVotes };

    // Check if majority (>50%) voted for same section
    const playerCount = this.state.players.length;
    if (playerCount > 0) {
      // Count votes for each section
      const voteCounts = new Map<number, number>();
      newVotes.forEach(v => {
        voteCounts.set(v.sectionIndex, (voteCounts.get(v.sectionIndex) || 0) + 1);
      });

      // Find section with majority
      for (const [section, count] of voteCounts) {
        if (count > playerCount / 2) {
          // Majority reached - queue the section change
          this.state = {
            ...this.state,
            nextSectionIndex: section,
            sectionVotes: [] // Clear votes after majority reached
          };
          break;
        }
      }
    }
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

    // Check if this pattern change invalidates create section votes
    // If >50% of players made changes while voting, reset votes
    this.checkCreateSectionVoteValidity();
  }

  private handleCreateSectionVote(playerId: string, hasMemory: boolean, loopStateHash: string): void {
    // Update or add vote for this player
    const existingIndex = this.state.createSectionVotes.findIndex(v => v.playerId === playerId);
    let newVotes = [...this.state.createSectionVotes];

    if (existingIndex >= 0) {
      newVotes[existingIndex] = { playerId, hasMemory, loopStateHash };
    } else {
      newVotes.push({ playerId, hasMemory, loopStateHash });
    }

    this.state = { ...this.state, createSectionVotes: newVotes };

    // Check if majority (>50%) voted with same hash
    const playerCount = this.state.players.length;
    if (playerCount > 0 && newVotes.length > playerCount / 2) {
      // Count votes by hash (to ensure they all voted for the same loop state)
      const hashCounts = new Map<string, { count: number; hasMemory: boolean }>();
      newVotes.forEach(v => {
        const existing = hashCounts.get(v.loopStateHash);
        if (existing) {
          existing.count++;
          // Use hasMemory if any voter wants memory
          existing.hasMemory = existing.hasMemory || v.hasMemory;
        } else {
          hashCounts.set(v.loopStateHash, { count: 1, hasMemory: v.hasMemory });
        }
      });

      // Find hash with majority
      for (const [, data] of hashCounts) {
        if (data.count > playerCount / 2) {
          // Majority reached with same loop state - create the section
          this.createNewSection(data.hasMemory);
          break;
        }
      }
    }
  }

  private checkCreateSectionVoteValidity(): void {
    if (this.state.createSectionVotes.length === 0) return;

    const currentHash = this.computeLoopStateHash();
    const playerCount = this.state.players.length;

    // Count how many votes have mismatched hash (player changed their loops)
    const mismatchCount = this.state.createSectionVotes.filter(
      v => v.loopStateHash !== currentHash
    ).length;

    // If >50% of players changed their patterns, reset votes
    if (mismatchCount > playerCount / 2) {
      console.log('Create section votes reset: too many pattern changes');
      this.sync.send({ type: 'create_section_reset', reason: 'pattern_changed' });
    }
  }

  private createNewSection(hasMemory: boolean): void {
    const newSection: Section = {
      id: uuidv4(),
      name: this.generateNextSectionName(),
      loops: this.state.players.flatMap(p => p.loops.filter(l => !l.muted).map(l => l.id)),
      bars: 16,
      hasMemory,
      snapshot: hasMemory ? this.createLoopSnapshot() : undefined,
    };

    console.log('Creating new section:', newSection.name, hasMemory ? 'with memory' : 'without memory');

    this.state = {
      ...this.state,
      sections: [...this.state.sections, newSection],
      createSectionVotes: [],
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
