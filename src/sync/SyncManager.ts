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
// Pattern generators for each instrument type
// Each generator creates patterns for any bar length with 5 variations (A-E)

// Helper to generate drum patterns for any bar length
// Time values are in BEATS (4 beats per bar in 4/4 time)
// variation: 0-4 (A-E) for different drum styles
function generateDrumPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation) {
      case 0: // A - Standard rock beat
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0, duration: '16n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1, duration: '16n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'C1', time: offset + 2, duration: '8n' },
          { note: 'E1', time: offset + 2, duration: '16n' },
          { note: 'E1', time: offset + 2.5, duration: '16n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'E1', time: offset + 3, duration: '16n' },
          { note: 'E1', time: offset + 3.5, duration: '16n' },
        );
        break;
      case 1: // B - Syncopated kick
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'C1', time: offset + 1.5, duration: '8n' },
          { note: 'E1', time: offset + 2, duration: '16n' },
          { note: 'E1', time: offset + 2.5, duration: '16n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'C1', time: offset + 3.5, duration: '8n' },
        );
        break;
      case 2: // C - Four on the floor
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'C1', time: offset + 1, duration: '8n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'C1', time: offset + 2, duration: '8n' },
          { note: 'E1', time: offset + 2.5, duration: '16n' },
          { note: 'C1', time: offset + 3, duration: '8n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'E1', time: offset + 3.5, duration: '16n' },
        );
        break;
      case 3: // D - Breakbeat
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'C1', time: offset + 2.5, duration: '8n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'C1', time: offset + 3.5, duration: '8n' },
        );
        break;
      case 4: // E - Sparse/minimal
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'D1', time: offset + 2, duration: '8n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate bass patterns for any bar length
// variation: 0-4 (A-E) for different bass styles
function generateBassPattern(bars: number, variation: number = 0): NoteEvent[] {
  const roots = ['C2', 'F2', 'G2', 'Ab2', 'Bb2', 'Eb2', 'F2', 'C2'];
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    const root = roots[bar % roots.length];
    switch (variation) {
      case 0: // A - Driving eighths
        pattern.push(
          { note: root, time: offset + 0, duration: '4n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: 'G2', time: offset + 2, duration: '4n' },
          { note: root, time: offset + 3.5, duration: '8n' },
        );
        break;
      case 1: // B - Walking bass
        pattern.push(
          { note: root, time: offset + 0, duration: '4n' },
          { note: 'Eb2', time: offset + 1, duration: '4n' },
          { note: 'F2', time: offset + 2, duration: '4n' },
          { note: 'G2', time: offset + 3, duration: '4n' },
        );
        break;
      case 2: // C - Octave jumps
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: 'C3', time: offset + 0.5, duration: '8n' },
          { note: root, time: offset + 2, duration: '8n' },
          { note: 'C3', time: offset + 2.5, duration: '8n' },
        );
        break;
      case 3: // D - Syncopated
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: 'G2', time: offset + 2.5, duration: '8n' },
          { note: root, time: offset + 3, duration: '4n' },
        );
        break;
      case 4: // E - Long sustained
        pattern.push(
          { note: root, time: offset + 0, duration: '1n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate arpeggio patterns for any bar length
// variation: 0-4 (A-E) for different arpeggio styles
function generateArpeggioPattern(bars: number, variation: number = 0): NoteEvent[] {
  const chords = [
    ['C4', 'Eb4', 'G4', 'C5'],   // Cm
    ['F3', 'Ab3', 'C4', 'F4'],   // Fm
    ['G3', 'B3', 'D4', 'G4'],    // G
    ['Ab3', 'C4', 'Eb4', 'Ab4'], // Ab
    ['Bb3', 'D4', 'F4', 'Bb4'],  // Bb
    ['Eb4', 'G4', 'Bb4', 'Eb5'], // Eb
    ['F4', 'A4', 'C5', 'F5'],    // F
    ['G4', 'B4', 'D5', 'G5'],    // G high
  ];
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    const chord = chords[bar % chords.length];
    switch (variation) {
      case 0: // A - Up and down
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '8n' },
          { note: chord[1], time: offset + 0.5, duration: '8n' },
          { note: chord[2], time: offset + 1, duration: '8n' },
          { note: chord[3], time: offset + 1.5, duration: '8n' },
          { note: chord[2], time: offset + 2, duration: '8n' },
          { note: chord[1], time: offset + 2.5, duration: '8n' },
          { note: chord[0], time: offset + 3, duration: '8n' },
          { note: chord[1], time: offset + 3.5, duration: '8n' },
        );
        break;
      case 1: // B - Fast 16ths up
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '16n' },
          { note: chord[1], time: offset + 0.25, duration: '16n' },
          { note: chord[2], time: offset + 0.5, duration: '16n' },
          { note: chord[3], time: offset + 0.75, duration: '16n' },
          { note: chord[0], time: offset + 2, duration: '16n' },
          { note: chord[1], time: offset + 2.25, duration: '16n' },
          { note: chord[2], time: offset + 2.5, duration: '16n' },
          { note: chord[3], time: offset + 2.75, duration: '16n' },
        );
        break;
      case 2: // C - Broken chord
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '8n' },
          { note: chord[2], time: offset + 0.5, duration: '8n' },
          { note: chord[1], time: offset + 1, duration: '8n' },
          { note: chord[3], time: offset + 1.5, duration: '8n' },
          { note: chord[0], time: offset + 2, duration: '8n' },
          { note: chord[2], time: offset + 2.5, duration: '8n' },
          { note: chord[1], time: offset + 3, duration: '8n' },
          { note: chord[3], time: offset + 3.5, duration: '8n' },
        );
        break;
      case 3: // D - Triplet feel
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '8n' },
          { note: chord[1], time: offset + 0.33, duration: '8n' },
          { note: chord[2], time: offset + 0.67, duration: '8n' },
          { note: chord[3], time: offset + 1, duration: '4n' },
          { note: chord[2], time: offset + 2, duration: '8n' },
          { note: chord[1], time: offset + 2.33, duration: '8n' },
          { note: chord[0], time: offset + 2.67, duration: '8n' },
          { note: chord[3], time: offset + 3, duration: '4n' },
        );
        break;
      case 4: // E - Sparse/ambient
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '2n' },
          { note: chord[3], time: offset + 2, duration: '2n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate chord patterns for any bar length
// variation: 0-4 (A-E) for different chord styles
function generateChordPattern(bars: number, variation: number = 0): NoteEvent[] {
  const chords = [
    ['C4', 'Eb4', 'G4'],   // Cm
    ['F4', 'Ab4', 'C5'],   // Fm
    ['Ab4', 'C5', 'Eb5'],  // Ab
    ['G4', 'B4', 'D5'],    // G
    ['Bb4', 'D5', 'F5'],   // Bb
    ['Eb4', 'G4', 'Bb4'],  // Eb
    ['F4', 'A4', 'C5'],    // F
    ['C4', 'Eb4', 'G4'],   // Cm
  ];
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    const chord = chords[bar % chords.length];
    switch (variation) {
      case 0: // A - Half notes
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '2n' });
          pattern.push({ note, time: offset + 2, duration: '2n' });
        });
        break;
      case 1: // B - Stabs
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '8n' });
          pattern.push({ note, time: offset + 1, duration: '8n' });
          pattern.push({ note, time: offset + 2.5, duration: '8n' });
        });
        break;
      case 2: // C - Rhythmic
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '8n' });
          pattern.push({ note, time: offset + 0.5, duration: '8n' });
          pattern.push({ note, time: offset + 2, duration: '4n' });
          pattern.push({ note, time: offset + 3, duration: '4n' });
        });
        break;
      case 3: // D - Pad/sustained
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '1n' });
        });
        break;
      case 4: // E - Offbeat
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0.5, duration: '8n' });
          pattern.push({ note, time: offset + 1.5, duration: '8n' });
          pattern.push({ note, time: offset + 2.5, duration: '8n' });
          pattern.push({ note, time: offset + 3.5, duration: '8n' });
        });
        break;
    }
  }
  return pattern;
}

// Helper to generate lead patterns for any bar length
// variation: 0-4 (A-E) for different lead styles
function generateLeadPattern(bars: number, variation: number = 0): NoteEvent[] {
  const phraseVariations = [
    // Variation A - Melodic
    [[{ n: 'G5', t: 0, d: '4n' }, { n: 'Eb5', t: 1, d: '8n' }, { n: 'F5', t: 1.5, d: '8n' }, { n: 'G5', t: 2, d: '2n' }],
     [{ n: 'C6', t: 0, d: '4n' }, { n: 'Bb5', t: 1, d: '8n' }, { n: 'Ab5', t: 1.5, d: '8n' }, { n: 'G5', t: 2, d: '2n' }]],
    // Variation B - Staccato
    [[{ n: 'G5', t: 0, d: '8n' }, { n: 'G5', t: 0.5, d: '8n' }, { n: 'Ab5', t: 1, d: '8n' }, { n: 'Bb5', t: 2, d: '8n' }, { n: 'C6', t: 3, d: '8n' }],
     [{ n: 'Eb5', t: 0, d: '8n' }, { n: 'F5', t: 1, d: '8n' }, { n: 'G5', t: 2, d: '8n' }, { n: 'Ab5', t: 3, d: '8n' }]],
    // Variation C - Call and response
    [[{ n: 'C6', t: 0, d: '4n' }, { n: 'Bb5', t: 0.5, d: '4n' }],
     [{ n: 'Ab5', t: 2, d: '4n' }, { n: 'G5', t: 2.5, d: '4n' }]],
    // Variation D - Legato
    [[{ n: 'G5', t: 0, d: '2n' }, { n: 'Ab5', t: 2, d: '2n' }],
     [{ n: 'Bb5', t: 0, d: '2n' }, { n: 'C6', t: 2, d: '2n' }]],
    // Variation E - High energy
    [[{ n: 'C6', t: 0, d: '8n' }, { n: 'Bb5', t: 0.25, d: '8n' }, { n: 'Ab5', t: 0.5, d: '8n' }, { n: 'G5', t: 0.75, d: '8n' },
      { n: 'F5', t: 1, d: '8n' }, { n: 'G5', t: 1.5, d: '8n' }, { n: 'Ab5', t: 2, d: '4n' }],
     [{ n: 'Eb5', t: 0, d: '8n' }, { n: 'F5', t: 0.5, d: '8n' }, { n: 'G5', t: 1, d: '8n' }, { n: 'Ab5', t: 1.5, d: '8n' },
      { n: 'Bb5', t: 2, d: '8n' }, { n: 'C6', t: 2.5, d: '4n' }]],
  ];
  const phrases = phraseVariations[variation] || phraseVariations[0];
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    const phrase = phrases[bar % phrases.length];
    phrase.forEach(p => {
      pattern.push({ note: p.n, time: offset + p.t, duration: p.d });
    });
  }
  return pattern;
}

// Helper to generate FX patterns for any bar length
// variation: 0-4 (A-E) for different FX styles
function generateFxPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation) {
      case 0: // A - Sparse sweeps
        pattern.push({ note: 'C6', time: offset, duration: '1n' });
        break;
      case 1: // B - Risers
        pattern.push(
          { note: 'C5', time: offset, duration: '4n' },
          { note: 'E5', time: offset + 1, duration: '4n' },
          { note: 'G5', time: offset + 2, duration: '4n' },
          { note: 'C6', time: offset + 3, duration: '4n' },
        );
        break;
      case 2: // C - Glitchy
        pattern.push(
          { note: 'C6', time: offset, duration: '16n' },
          { note: 'C6', time: offset + 0.25, duration: '16n' },
          { note: 'G5', time: offset + 1, duration: '16n' },
          { note: 'C6', time: offset + 2.5, duration: '16n' },
          { note: 'C6', time: offset + 2.75, duration: '16n' },
        );
        break;
      case 3: // D - Downward
        pattern.push(
          { note: 'C6', time: offset, duration: '4n' },
          { note: 'G5', time: offset + 1, duration: '4n' },
          { note: 'E5', time: offset + 2, duration: '4n' },
          { note: 'C5', time: offset + 3, duration: '4n' },
        );
        break;
      case 4: // E - Textural
        pattern.push(
          { note: 'C5', time: offset, duration: '2n' },
          { note: 'G5', time: offset, duration: '2n' },
          { note: 'E5', time: offset + 2, duration: '2n' },
          { note: 'C6', time: offset + 2, duration: '2n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate vocal patterns for any bar length
// variation: 0-4 (A-E) for different vocal styles
function generateVocalPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation) {
      case 0: // A - Sustained
        pattern.push({ note: 'C5', time: offset, duration: '1n' });
        break;
      case 1: // B - Melodic phrase
        pattern.push(
          { note: 'C5', time: offset, duration: '4n' },
          { note: 'Eb5', time: offset + 1, duration: '4n' },
          { note: 'G5', time: offset + 2, duration: '2n' },
        );
        break;
      case 2: // C - Rhythmic
        pattern.push(
          { note: 'C5', time: offset, duration: '8n' },
          { note: 'C5', time: offset + 0.5, duration: '8n' },
          { note: 'Eb5', time: offset + 1.5, duration: '8n' },
          { note: 'G5', time: offset + 2, duration: '4n' },
          { note: 'Eb5', time: offset + 3, duration: '4n' },
        );
        break;
      case 3: // D - Breathy/sparse
        pattern.push({ note: 'G5', time: offset + 2, duration: '2n' });
        break;
      case 4: // E - Harmonized
        pattern.push(
          { note: 'C5', time: offset, duration: '2n' },
          { note: 'Eb5', time: offset, duration: '2n' },
          { note: 'G5', time: offset + 2, duration: '2n' },
          { note: 'C6', time: offset + 2, duration: '2n' },
        );
        break;
    }
  }
  return pattern;
}

// Instrument colors
// Colors must match INSTRUMENT_INFO in types/index.ts
const INSTRUMENT_COLORS = {
  drums: '#ef4444',
  bass: '#f97316',
  chord: '#eab308',    // yellow
  arpeggio: '#22c55e', // green
  lead: '#3b82f6',
  fx: '#8b5cf6',
  vocal: '#ec4899',
};

// Export pattern generators for use in timeline dropdown
export const patternGenerators = {
  drums: generateDrumPattern,
  bass: generateBassPattern,
  arpeggio: generateArpeggioPattern,
  chord: generateChordPattern,
  lead: generateLeadPattern,
  fx: generateFxPattern,
  vocal: generateVocalPattern,
};

// Default loops for new players - Full instrument x bar length matrix
// Each row is an instrument type with all 8 bar lengths (1-8)
const DEFAULT_LOOPS: Omit<Loop, 'id'>[] = [
  // DRUMS - all bar lengths (red)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(1, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(2, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(3, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(4, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(5, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(6, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(7, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.drums, pattern: generateDrumPattern(8, 0), volume: 0.8, muted: true, instrument: 'drums', variation: 0 },

  // BASS - all bar lengths (orange)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(1, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(2, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(3, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(4, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(5, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(6, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(7, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.bass, pattern: generateBassPattern(8, 0), volume: 0.8, muted: true, instrument: 'bass', variation: 0 },

  // ARPEGGIO - all bar lengths (yellow)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(1, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(2, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(3, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(4, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(5, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(6, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(7, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.arpeggio, pattern: generateArpeggioPattern(8, 0), volume: 0.8, muted: true, instrument: 'arpeggio', variation: 0 },

  // CHORD - all bar lengths (green)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(1, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(2, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(3, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(4, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(5, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(6, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(7, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.chord, pattern: generateChordPattern(8, 0), volume: 0.8, muted: true, instrument: 'chord', variation: 0 },

  // LEAD - all bar lengths (blue)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(1, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(2, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(3, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(4, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(5, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(6, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(7, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.lead, pattern: generateLeadPattern(8, 0), volume: 0.8, muted: true, instrument: 'lead', variation: 0 },

  // FX - all bar lengths (purple)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(1, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(2, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(3, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(4, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(5, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(6, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(7, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.fx, pattern: generateFxPattern(8, 0), volume: 0.8, muted: true, instrument: 'fx', variation: 0 },

  // VOCAL - all bar lengths (pink)
  { name: '1', bars: 1, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(1, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '2', bars: 2, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(2, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '3', bars: 3, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(3, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '4', bars: 4, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(4, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '5', bars: 5, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(5, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '6', bars: 6, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(6, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '7', bars: 7, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(7, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
  { name: '8', bars: 8, color: INSTRUMENT_COLORS.vocal, pattern: generateVocalPattern(8, 0), volume: 0.8, muted: true, instrument: 'vocal', variation: 0 },
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

  updateLoopVolume(loopId: string, volume: number): void {
    this.sync.send({
      type: 'loop_volume',
      playerId: this.playerId,
      loopId,
      volume,
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
      case 'loop_volume':
        this.handleLoopVolume(message.playerId, message.loopId, message.volume);
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

  private handleLoopVolume(playerId: string, loopId: string, volume: number): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) => {
        if (p.id === playerId) {
          return {
            ...p,
            loops: p.loops.map((l) =>
              l.id === loopId ? { ...l, volume } : l
            ),
          };
        }
        return p;
      }),
    };
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
