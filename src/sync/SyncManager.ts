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
// Each generator creates patterns for any bar length with 10 variations (1-10)

// Helper to generate drum patterns for any bar length
// Time values are in BEATS (4 beats per bar in 4/4 time)
// variation: 0-9 for different drum styles
function generateDrumPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation % 10) {
      case 0: // Standard rock beat
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
      case 1: // Syncopated kick
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
      case 2: // Four on the floor
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
      case 3: // Breakbeat
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
      case 4: // Sparse/minimal
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'D1', time: offset + 2, duration: '8n' },
        );
        break;
      case 5: // Hihat-heavy 16ths
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.25, duration: '16n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'E1', time: offset + 0.75, duration: '16n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1.25, duration: '16n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'E1', time: offset + 1.75, duration: '16n' },
          { note: 'C1', time: offset + 2, duration: '8n' },
          { note: 'E1', time: offset + 2.5, duration: '16n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'E1', time: offset + 3.5, duration: '16n' },
        );
        break;
      case 6: // Double kick
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'C1', time: offset + 0.5, duration: '8n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'C1', time: offset + 2, duration: '8n' },
          { note: 'C1', time: offset + 2.5, duration: '8n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'E1', time: offset + 3.5, duration: '16n' },
        );
        break;
      case 7: // Shuffle feel
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.67, duration: '16n' },
          { note: 'D1', time: offset + 1, duration: '8n' },
          { note: 'E1', time: offset + 1.67, duration: '16n' },
          { note: 'C1', time: offset + 2, duration: '8n' },
          { note: 'E1', time: offset + 2.67, duration: '16n' },
          { note: 'D1', time: offset + 3, duration: '8n' },
          { note: 'C1', time: offset + 3.5, duration: '8n' },
        );
        break;
      case 8: // Trap-style
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.25, duration: '16n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'E1', time: offset + 0.75, duration: '16n' },
          { note: 'E1', time: offset + 1, duration: '16n' },
          { note: 'D1', time: offset + 1.5, duration: '8n' },
          { note: 'E1', time: offset + 2, duration: '16n' },
          { note: 'E1', time: offset + 2.25, duration: '16n' },
          { note: 'C1', time: offset + 2.5, duration: '8n' },
          { note: 'E1', time: offset + 3, duration: '16n' },
          { note: 'D1', time: offset + 3.5, duration: '8n' },
        );
        break;
      case 9: // Half-time
        pattern.push(
          { note: 'C1', time: offset + 0, duration: '8n' },
          { note: 'E1', time: offset + 0.5, duration: '16n' },
          { note: 'E1', time: offset + 1, duration: '16n' },
          { note: 'E1', time: offset + 1.5, duration: '16n' },
          { note: 'D1', time: offset + 2, duration: '8n' },
          { note: 'E1', time: offset + 2.5, duration: '16n' },
          { note: 'E1', time: offset + 3, duration: '16n' },
          { note: 'E1', time: offset + 3.5, duration: '16n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate bass patterns for any bar length
// variation: 0-9 for different bass styles
function generateBassPattern(bars: number, variation: number = 0): NoteEvent[] {
  const roots = ['C2', 'F2', 'G2', 'Ab2', 'Bb2', 'Eb2', 'F2', 'C2'];
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    const root = roots[bar % roots.length];
    switch (variation % 10) {
      case 0: // Driving eighths
        pattern.push(
          { note: root, time: offset + 0, duration: '4n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: 'G2', time: offset + 2, duration: '4n' },
          { note: root, time: offset + 3.5, duration: '8n' },
        );
        break;
      case 1: // Walking bass
        pattern.push(
          { note: root, time: offset + 0, duration: '4n' },
          { note: 'Eb2', time: offset + 1, duration: '4n' },
          { note: 'F2', time: offset + 2, duration: '4n' },
          { note: 'G2', time: offset + 3, duration: '4n' },
        );
        break;
      case 2: // Octave jumps
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: 'C3', time: offset + 0.5, duration: '8n' },
          { note: root, time: offset + 2, duration: '8n' },
          { note: 'C3', time: offset + 2.5, duration: '8n' },
        );
        break;
      case 3: // Syncopated
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: 'G2', time: offset + 2.5, duration: '8n' },
          { note: root, time: offset + 3, duration: '4n' },
        );
        break;
      case 4: // Long sustained
        pattern.push(
          { note: root, time: offset + 0, duration: '1n' },
        );
        break;
      case 5: // Pumping 8ths
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: root, time: offset + 0.5, duration: '8n' },
          { note: root, time: offset + 1, duration: '8n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: root, time: offset + 2, duration: '8n' },
          { note: root, time: offset + 2.5, duration: '8n' },
          { note: root, time: offset + 3, duration: '8n' },
          { note: root, time: offset + 3.5, duration: '8n' },
        );
        break;
      case 6: // Funk slap
        pattern.push(
          { note: root, time: offset + 0, duration: '16n' },
          { note: 'G2', time: offset + 0.75, duration: '16n' },
          { note: root, time: offset + 1, duration: '8n' },
          { note: root, time: offset + 2, duration: '16n' },
          { note: 'G2', time: offset + 2.5, duration: '16n' },
          { note: root, time: offset + 3, duration: '8n' },
        );
        break;
      case 7: // Reggae offbeat
        pattern.push(
          { note: root, time: offset + 0.5, duration: '8n' },
          { note: root, time: offset + 1.5, duration: '8n' },
          { note: root, time: offset + 2.5, duration: '8n' },
          { note: root, time: offset + 3.5, duration: '8n' },
        );
        break;
      case 8: // Disco bounce
        pattern.push(
          { note: root, time: offset + 0, duration: '8n' },
          { note: 'G2', time: offset + 0.5, duration: '8n' },
          { note: root, time: offset + 1, duration: '8n' },
          { note: 'G2', time: offset + 1.5, duration: '8n' },
          { note: root, time: offset + 2, duration: '8n' },
          { note: 'G2', time: offset + 2.5, duration: '8n' },
          { note: root, time: offset + 3, duration: '8n' },
          { note: 'G2', time: offset + 3.5, duration: '8n' },
        );
        break;
      case 9: // Minimal sub
        pattern.push(
          { note: root, time: offset + 0, duration: '2n' },
          { note: 'G1', time: offset + 2, duration: '2n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate arpeggio patterns for any bar length
// variation: 0-9 for different arpeggio styles
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
    switch (variation % 10) {
      case 0: // Up and down
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
      case 1: // Fast 16ths up
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
      case 2: // Broken chord
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
      case 3: // Triplet feel
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
      case 4: // Sparse/ambient
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '2n' },
          { note: chord[3], time: offset + 2, duration: '2n' },
        );
        break;
      case 5: // Down only
        pattern.push(
          { note: chord[3], time: offset + 0, duration: '8n' },
          { note: chord[2], time: offset + 0.5, duration: '8n' },
          { note: chord[1], time: offset + 1, duration: '8n' },
          { note: chord[0], time: offset + 1.5, duration: '8n' },
          { note: chord[3], time: offset + 2, duration: '8n' },
          { note: chord[2], time: offset + 2.5, duration: '8n' },
          { note: chord[1], time: offset + 3, duration: '8n' },
          { note: chord[0], time: offset + 3.5, duration: '8n' },
        );
        break;
      case 6: // Slow sweep
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '4n' },
          { note: chord[1], time: offset + 1, duration: '4n' },
          { note: chord[2], time: offset + 2, duration: '4n' },
          { note: chord[3], time: offset + 3, duration: '4n' },
        );
        break;
      case 7: // Pedal tone
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '8n' },
          { note: chord[3], time: offset + 0.5, duration: '8n' },
          { note: chord[0], time: offset + 1, duration: '8n' },
          { note: chord[2], time: offset + 1.5, duration: '8n' },
          { note: chord[0], time: offset + 2, duration: '8n' },
          { note: chord[1], time: offset + 2.5, duration: '8n' },
          { note: chord[0], time: offset + 3, duration: '8n' },
          { note: chord[3], time: offset + 3.5, duration: '8n' },
        );
        break;
      case 8: // Octave jumps
        pattern.push(
          { note: chord[0], time: offset + 0, duration: '8n' },
          { note: chord[3], time: offset + 0.5, duration: '8n' },
          { note: chord[0], time: offset + 1, duration: '8n' },
          { note: chord[3], time: offset + 1.5, duration: '8n' },
          { note: chord[1], time: offset + 2, duration: '8n' },
          { note: chord[2], time: offset + 2.5, duration: '8n' },
          { note: chord[1], time: offset + 3, duration: '8n' },
          { note: chord[2], time: offset + 3.5, duration: '8n' },
        );
        break;
      case 9: // Random spread
        pattern.push(
          { note: chord[2], time: offset + 0, duration: '8n' },
          { note: chord[0], time: offset + 0.5, duration: '8n' },
          { note: chord[3], time: offset + 1, duration: '8n' },
          { note: chord[1], time: offset + 1.5, duration: '8n' },
          { note: chord[0], time: offset + 2, duration: '8n' },
          { note: chord[3], time: offset + 2.5, duration: '8n' },
          { note: chord[2], time: offset + 3, duration: '8n' },
          { note: chord[1], time: offset + 3.5, duration: '8n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate chord patterns for any bar length
// variation: 0-9 for different chord styles
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
    switch (variation % 10) {
      case 0: // Half notes
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '2n' });
          pattern.push({ note, time: offset + 2, duration: '2n' });
        });
        break;
      case 1: // Stabs
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '8n' });
          pattern.push({ note, time: offset + 1, duration: '8n' });
          pattern.push({ note, time: offset + 2.5, duration: '8n' });
        });
        break;
      case 2: // Rhythmic
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '8n' });
          pattern.push({ note, time: offset + 0.5, duration: '8n' });
          pattern.push({ note, time: offset + 2, duration: '4n' });
          pattern.push({ note, time: offset + 3, duration: '4n' });
        });
        break;
      case 3: // Pad/sustained
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '1n' });
        });
        break;
      case 4: // Offbeat
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0.5, duration: '8n' });
          pattern.push({ note, time: offset + 1.5, duration: '8n' });
          pattern.push({ note, time: offset + 2.5, duration: '8n' });
          pattern.push({ note, time: offset + 3.5, duration: '8n' });
        });
        break;
      case 5: // Pumping quarter notes
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '4n' });
          pattern.push({ note, time: offset + 1, duration: '4n' });
          pattern.push({ note, time: offset + 2, duration: '4n' });
          pattern.push({ note, time: offset + 3, duration: '4n' });
        });
        break;
      case 6: // Syncopated stabs
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '8n' });
          pattern.push({ note, time: offset + 1.5, duration: '8n' });
          pattern.push({ note, time: offset + 2.5, duration: '4n' });
        });
        break;
      case 7: // Rolling 16ths
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '16n' });
          pattern.push({ note, time: offset + 0.25, duration: '16n' });
          pattern.push({ note, time: offset + 2, duration: '16n' });
          pattern.push({ note, time: offset + 2.25, duration: '16n' });
        });
        break;
      case 8: // Swell/crescendo feel
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '4n', velocity: 0.4 });
          pattern.push({ note, time: offset + 1, duration: '4n', velocity: 0.6 });
          pattern.push({ note, time: offset + 2, duration: '4n', velocity: 0.8 });
          pattern.push({ note, time: offset + 3, duration: '4n', velocity: 1.0 });
        });
        break;
      case 9: // Sparse accents
        chord.forEach(note => {
          pattern.push({ note, time: offset + 0, duration: '2n' });
          pattern.push({ note, time: offset + 3, duration: '8n' });
        });
        break;
    }
  }
  return pattern;
}

// Helper to generate lead patterns for any bar length
// variation: 0-9 for different lead styles
function generateLeadPattern(bars: number, variation: number = 0): NoteEvent[] {
  const phraseVariations = [
    // Variation 0 - Melodic
    [[{ n: 'G5', t: 0, d: '4n' }, { n: 'Eb5', t: 1, d: '8n' }, { n: 'F5', t: 1.5, d: '8n' }, { n: 'G5', t: 2, d: '2n' }],
     [{ n: 'C6', t: 0, d: '4n' }, { n: 'Bb5', t: 1, d: '8n' }, { n: 'Ab5', t: 1.5, d: '8n' }, { n: 'G5', t: 2, d: '2n' }]],
    // Variation 1 - Staccato
    [[{ n: 'G5', t: 0, d: '8n' }, { n: 'G5', t: 0.5, d: '8n' }, { n: 'Ab5', t: 1, d: '8n' }, { n: 'Bb5', t: 2, d: '8n' }, { n: 'C6', t: 3, d: '8n' }],
     [{ n: 'Eb5', t: 0, d: '8n' }, { n: 'F5', t: 1, d: '8n' }, { n: 'G5', t: 2, d: '8n' }, { n: 'Ab5', t: 3, d: '8n' }]],
    // Variation 2 - Call and response
    [[{ n: 'C6', t: 0, d: '4n' }, { n: 'Bb5', t: 0.5, d: '4n' }],
     [{ n: 'Ab5', t: 2, d: '4n' }, { n: 'G5', t: 2.5, d: '4n' }]],
    // Variation 3 - Legato
    [[{ n: 'G5', t: 0, d: '2n' }, { n: 'Ab5', t: 2, d: '2n' }],
     [{ n: 'Bb5', t: 0, d: '2n' }, { n: 'C6', t: 2, d: '2n' }]],
    // Variation 4 - High energy
    [[{ n: 'C6', t: 0, d: '8n' }, { n: 'Bb5', t: 0.25, d: '8n' }, { n: 'Ab5', t: 0.5, d: '8n' }, { n: 'G5', t: 0.75, d: '8n' },
      { n: 'F5', t: 1, d: '8n' }, { n: 'G5', t: 1.5, d: '8n' }, { n: 'Ab5', t: 2, d: '4n' }],
     [{ n: 'Eb5', t: 0, d: '8n' }, { n: 'F5', t: 0.5, d: '8n' }, { n: 'G5', t: 1, d: '8n' }, { n: 'Ab5', t: 1.5, d: '8n' },
      { n: 'Bb5', t: 2, d: '8n' }, { n: 'C6', t: 2.5, d: '4n' }]],
    // Variation 5 - Ascending scale run
    [[{ n: 'C5', t: 0, d: '8n' }, { n: 'D5', t: 0.5, d: '8n' }, { n: 'Eb5', t: 1, d: '8n' }, { n: 'F5', t: 1.5, d: '8n' },
      { n: 'G5', t: 2, d: '8n' }, { n: 'Ab5', t: 2.5, d: '8n' }, { n: 'Bb5', t: 3, d: '8n' }, { n: 'C6', t: 3.5, d: '8n' }],
     [{ n: 'C6', t: 0, d: '2n' }, { n: 'G5', t: 2, d: '2n' }]],
    // Variation 6 - Descending
    [[{ n: 'C6', t: 0, d: '8n' }, { n: 'Bb5', t: 0.5, d: '8n' }, { n: 'Ab5', t: 1, d: '8n' }, { n: 'G5', t: 1.5, d: '8n' },
      { n: 'F5', t: 2, d: '8n' }, { n: 'Eb5', t: 2.5, d: '8n' }, { n: 'D5', t: 3, d: '8n' }, { n: 'C5', t: 3.5, d: '8n' }],
     [{ n: 'G5', t: 0, d: '2n' }, { n: 'C5', t: 2, d: '2n' }]],
    // Variation 7 - Syncopated melody
    [[{ n: 'G5', t: 0.5, d: '8n' }, { n: 'Bb5', t: 1, d: '8n' }, { n: 'C6', t: 1.5, d: '4n' }, { n: 'Bb5', t: 2.5, d: '8n' }, { n: 'G5', t: 3, d: '4n' }],
     [{ n: 'Ab5', t: 0.5, d: '8n' }, { n: 'G5', t: 1, d: '8n' }, { n: 'F5', t: 1.5, d: '4n' }, { n: 'Eb5', t: 2.5, d: '8n' }, { n: 'C5', t: 3, d: '4n' }]],
    // Variation 8 - Repeated note
    [[{ n: 'G5', t: 0, d: '8n' }, { n: 'G5', t: 0.5, d: '8n' }, { n: 'G5', t: 1, d: '8n' }, { n: 'Ab5', t: 1.5, d: '8n' },
      { n: 'G5', t: 2, d: '8n' }, { n: 'G5', t: 2.5, d: '8n' }, { n: 'G5', t: 3, d: '8n' }, { n: 'F5', t: 3.5, d: '8n' }],
     [{ n: 'Eb5', t: 0, d: '8n' }, { n: 'Eb5', t: 0.5, d: '8n' }, { n: 'Eb5', t: 1, d: '8n' }, { n: 'F5', t: 1.5, d: '8n' },
      { n: 'Eb5', t: 2, d: '8n' }, { n: 'Eb5', t: 2.5, d: '8n' }, { n: 'Eb5', t: 3, d: '8n' }, { n: 'D5', t: 3.5, d: '8n' }]],
    // Variation 9 - Wide intervals
    [[{ n: 'C5', t: 0, d: '4n' }, { n: 'G5', t: 1, d: '4n' }, { n: 'C6', t: 2, d: '2n' }],
     [{ n: 'Eb5', t: 0, d: '4n' }, { n: 'Bb5', t: 1, d: '4n' }, { n: 'G5', t: 2, d: '2n' }]],
  ];
  const phrases = phraseVariations[variation % 10] || phraseVariations[0];
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
// variation: 0-9 for different FX styles
function generateFxPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation % 10) {
      case 0: // Sparse sweeps
        pattern.push({ note: 'C6', time: offset, duration: '1n' });
        break;
      case 1: // Risers
        pattern.push(
          { note: 'C5', time: offset, duration: '4n' },
          { note: 'E5', time: offset + 1, duration: '4n' },
          { note: 'G5', time: offset + 2, duration: '4n' },
          { note: 'C6', time: offset + 3, duration: '4n' },
        );
        break;
      case 2: // Glitchy
        pattern.push(
          { note: 'C6', time: offset, duration: '16n' },
          { note: 'C6', time: offset + 0.25, duration: '16n' },
          { note: 'G5', time: offset + 1, duration: '16n' },
          { note: 'C6', time: offset + 2.5, duration: '16n' },
          { note: 'C6', time: offset + 2.75, duration: '16n' },
        );
        break;
      case 3: // Downward
        pattern.push(
          { note: 'C6', time: offset, duration: '4n' },
          { note: 'G5', time: offset + 1, duration: '4n' },
          { note: 'E5', time: offset + 2, duration: '4n' },
          { note: 'C5', time: offset + 3, duration: '4n' },
        );
        break;
      case 4: // Textural
        pattern.push(
          { note: 'C5', time: offset, duration: '2n' },
          { note: 'G5', time: offset, duration: '2n' },
          { note: 'E5', time: offset + 2, duration: '2n' },
          { note: 'C6', time: offset + 2, duration: '2n' },
        );
        break;
      case 5: // Stutter
        pattern.push(
          { note: 'C6', time: offset, duration: '16n' },
          { note: 'C6', time: offset + 0.125, duration: '16n' },
          { note: 'C6', time: offset + 0.25, duration: '16n' },
          { note: 'C6', time: offset + 2, duration: '16n' },
          { note: 'C6', time: offset + 2.125, duration: '16n' },
          { note: 'C6', time: offset + 2.25, duration: '16n' },
        );
        break;
      case 6: // Ambient wash
        pattern.push(
          { note: 'C5', time: offset, duration: '1n', velocity: 0.3 },
          { note: 'G5', time: offset, duration: '1n', velocity: 0.3 },
          { note: 'C6', time: offset, duration: '1n', velocity: 0.3 },
        );
        break;
      case 7: // Ping pong
        pattern.push(
          { note: 'C6', time: offset, duration: '8n' },
          { note: 'G5', time: offset + 0.5, duration: '8n' },
          { note: 'C6', time: offset + 1, duration: '8n' },
          { note: 'G5', time: offset + 1.5, duration: '8n' },
          { note: 'C6', time: offset + 2, duration: '8n' },
          { note: 'G5', time: offset + 2.5, duration: '8n' },
        );
        break;
      case 8: // Build tension
        pattern.push(
          { note: 'C5', time: offset, duration: '8n', velocity: 0.3 },
          { note: 'C5', time: offset + 0.5, duration: '8n', velocity: 0.4 },
          { note: 'C5', time: offset + 1, duration: '8n', velocity: 0.5 },
          { note: 'C5', time: offset + 1.5, duration: '8n', velocity: 0.6 },
          { note: 'C5', time: offset + 2, duration: '8n', velocity: 0.7 },
          { note: 'C5', time: offset + 2.5, duration: '8n', velocity: 0.8 },
          { note: 'C5', time: offset + 3, duration: '8n', velocity: 0.9 },
          { note: 'C6', time: offset + 3.5, duration: '8n', velocity: 1.0 },
        );
        break;
      case 9: // Random hits
        pattern.push(
          { note: 'G5', time: offset + 0.5, duration: '16n' },
          { note: 'C6', time: offset + 1.25, duration: '16n' },
          { note: 'E5', time: offset + 2.75, duration: '16n' },
          { note: 'C6', time: offset + 3.5, duration: '16n' },
        );
        break;
    }
  }
  return pattern;
}

// Helper to generate vocal patterns for any bar length
// variation: 0-9 for different vocal styles
function generateVocalPattern(bars: number, variation: number = 0): NoteEvent[] {
  const pattern: NoteEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const offset = bar * 4;
    switch (variation % 10) {
      case 0: // Sustained
        pattern.push({ note: 'C5', time: offset, duration: '1n' });
        break;
      case 1: // Melodic phrase
        pattern.push(
          { note: 'C5', time: offset, duration: '4n' },
          { note: 'Eb5', time: offset + 1, duration: '4n' },
          { note: 'G5', time: offset + 2, duration: '2n' },
        );
        break;
      case 2: // Rhythmic
        pattern.push(
          { note: 'C5', time: offset, duration: '8n' },
          { note: 'C5', time: offset + 0.5, duration: '8n' },
          { note: 'Eb5', time: offset + 1.5, duration: '8n' },
          { note: 'G5', time: offset + 2, duration: '4n' },
          { note: 'Eb5', time: offset + 3, duration: '4n' },
        );
        break;
      case 3: // Breathy/sparse
        pattern.push({ note: 'G5', time: offset + 2, duration: '2n' });
        break;
      case 4: // Harmonized
        pattern.push(
          { note: 'C5', time: offset, duration: '2n' },
          { note: 'Eb5', time: offset, duration: '2n' },
          { note: 'G5', time: offset + 2, duration: '2n' },
          { note: 'C6', time: offset + 2, duration: '2n' },
        );
        break;
      case 5: // Call response
        pattern.push(
          { note: 'G5', time: offset, duration: '4n' },
          { note: 'C5', time: offset + 2, duration: '4n' },
        );
        break;
      case 6: // Scat style
        pattern.push(
          { note: 'C5', time: offset, duration: '8n' },
          { note: 'Eb5', time: offset + 0.5, duration: '8n' },
          { note: 'G5', time: offset + 1, duration: '8n' },
          { note: 'Eb5', time: offset + 1.5, duration: '8n' },
          { note: 'C5', time: offset + 2, duration: '8n' },
          { note: 'G4', time: offset + 2.5, duration: '8n' },
          { note: 'C5', time: offset + 3, duration: '4n' },
        );
        break;
      case 7: // Choir swell
        pattern.push(
          { note: 'C5', time: offset, duration: '1n', velocity: 0.4 },
          { note: 'Eb5', time: offset, duration: '1n', velocity: 0.4 },
          { note: 'G5', time: offset, duration: '1n', velocity: 0.4 },
        );
        break;
      case 8: // Staccato chant
        pattern.push(
          { note: 'G5', time: offset, duration: '16n' },
          { note: 'G5', time: offset + 1, duration: '16n' },
          { note: 'G5', time: offset + 2, duration: '16n' },
          { note: 'Ab5', time: offset + 3, duration: '16n' },
        );
        break;
      case 9: // Ethereal
        pattern.push(
          { note: 'G5', time: offset, duration: '2n', velocity: 0.5 },
          { note: 'C6', time: offset + 2, duration: '2n', velocity: 0.5 },
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

// Simple seeded random number generator based on player ID
// Uses a simple hash function to convert player ID to a seed
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Seeded random number generator (mulberry32)
function seededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Instrument types in order
type InstrumentKey = 'drums' | 'bass' | 'arpeggio' | 'chord' | 'lead' | 'fx' | 'vocal';
const INSTRUMENT_TYPES: InstrumentKey[] = ['drums', 'bass', 'arpeggio', 'chord', 'lead', 'fx', 'vocal'];

// Pattern generator mapping
const PATTERN_GENERATORS: Record<InstrumentKey, (bars: number, variation: number) => NoteEvent[]> = {
  drums: generateDrumPattern,
  bass: generateBassPattern,
  arpeggio: generateArpeggioPattern,
  chord: generateChordPattern,
  lead: generateLeadPattern,
  fx: generateFxPattern,
  vocal: generateVocalPattern,
};

// Default sections
const DEFAULT_SECTIONS: Omit<Section, 'id'>[] = [
  { name: 'Intro', loops: [], bars: 8, hasMemory: false },
  { name: 'A', loops: [], bars: 16, hasMemory: false },
  { name: 'B', loops: [], bars: 16, hasMemory: false },
  { name: 'C', loops: [], bars: 16, hasMemory: false },
  { name: 'Bridge', loops: [], bars: 8, hasMemory: false },
  { name: 'Coda', loops: [], bars: 8, hasMemory: false },
];

// Generate loops for a player with seeded randomization
// Each player gets different starting variations based on their player ID
function getLoopsForPlayer(playerId: string): Omit<Loop, 'id'>[] {
  const seed = hashString(playerId);
  const random = seededRandom(seed);
  const loops: Omit<Loop, 'id'>[] = [];

  // For each instrument type
  for (const instrument of INSTRUMENT_TYPES) {
    // Generate a random starting variation for this instrument (0-9)
    const baseVariation = Math.floor(random() * 10);
    const generator = PATTERN_GENERATORS[instrument];
    const color = INSTRUMENT_COLORS[instrument];

    // Generate loops for all bar lengths (1-8)
    for (let bars = 1; bars <= 8; bars++) {
      loops.push({
        name: bars.toString(),
        bars,
        color,
        pattern: generator(bars, baseVariation),
        volume: 0.8,
        transpose: 0,
        muted: true,
        instrument,
        variation: baseVariation,
      });
    }
  }

  return loops;
}

// Total loop count (7 instruments × 8 bar lengths)
const TOTAL_LOOPS_PER_PLAYER = 56;

// Calculate tracks per player for display
export function getTracksPerPlayer(playerCount: number): { perPlayer: number; total: number } {
  const perPlayer = TOTAL_LOOPS_PER_PLAYER;
  return { perPlayer, total: perPlayer * playerCount };
}

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
    // All players get all loops with randomized starting variations based on their ID
    const playerLoops = getLoopsForPlayer(this.playerId);

    const player: Player = {
      id: this.playerId,
      name: playerName,
      color: playerColor,
      loops: playerLoops.map((l) => ({ ...l, id: uuidv4() })),
      isReady: false,
    };

    // Delay for non-host to ensure connection is established
    const delay = this.isHostFlag ? 100 : 2000;

    setTimeout(() => {
      console.log('Sending join message for player:', player.name, 'with', player.loops.length, 'tracks');
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
        volume: l.volume,
        transpose: l.transpose,
        variation: l.variation,
      }))
    );
  }

  // Apply a snapshot to restore loop states
  private applySnapshot(snapshot: LoopSnapshot[]): void {
    console.log('Applying section snapshot:', snapshot.length, 'loops');

    // First, mute all loops
    this.state = {
      ...this.state,
      players: this.state.players.map(p => ({
        ...p,
        loops: p.loops.map(l => ({ ...l, muted: true })),
      })),
    };

    // Then unmute and update patterns for loops in the snapshot
    snapshot.forEach(snap => {
      this.state = {
        ...this.state,
        players: this.state.players.map(p => {
          if (p.id === snap.playerId) {
            return {
              ...p,
              loops: p.loops.map(l => {
                if (l.id === snap.loopId) {
                  return {
                    ...l,
                    pattern: [...snap.pattern],
                    muted: snap.muted,
                    // Restore additional properties if present in snapshot
                    volume: snap.volume !== undefined ? snap.volume : l.volume,
                    transpose: snap.transpose !== undefined ? snap.transpose : l.transpose,
                    variation: snap.variation !== undefined ? snap.variation : l.variation,
                  };
                }
                return l;
              }),
            };
          }
          return p;
        }),
      };
    });
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
      const section = this.state.sections[sectionIndex];
      // Include snapshot if section has memory
      const snapshot = section?.hasMemory ? section.snapshot : undefined;
      this.sync.send({ type: 'section_change', sectionIndex, snapshot });
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

  updateLoopTranspose(loopId: string, transpose: number): void {
    this.sync.send({
      type: 'loop_transpose',
      playerId: this.playerId,
      loopId,
      transpose,
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
        // Apply snapshot if provided (restore loop states from memory section)
        if (message.snapshot && message.snapshot.length > 0) {
          this.applySnapshot(message.snapshot);
        }
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
      case 'loop_transpose':
        this.handleLoopTranspose(message.playerId, message.loopId, message.transpose);
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
      for (const [sectionIdx, count] of voteCounts) {
        if (count > playerCount / 2) {
          // Majority reached - broadcast section change to all peers
          const section = this.state.sections[sectionIdx];
          const snapshot = section?.hasMemory ? section.snapshot : undefined;

          console.log('Section changed via majority vote to:', section?.name, snapshot ? 'with memory' : 'without memory');

          // Broadcast the section change so all peers apply the snapshot
          this.sync.send({
            type: 'section_change',
            sectionIndex: sectionIdx,
            snapshot: snapshot,
          });
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

  private handleLoopTranspose(playerId: string, loopId: string, transpose: number): void {
    this.state = {
      ...this.state,
      players: this.state.players.map((p) => {
        if (p.id === playerId) {
          return {
            ...p,
            loops: p.loops.map((l) =>
              l.id === loopId ? { ...l, transpose } : l
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
      const newPlayerCount = this.state.players.length + 1;
      console.log('Player joined:', player.name, '- total players now:', newPlayerCount);

      // Simply add the new player - all players keep their own loops
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
    const remainingPlayers = this.state.players.filter((p) => p.id !== playerId);

    this.state = {
      ...this.state,
      players: remainingPlayers,
    };

    // If leader left, assign new leader
    if (this.state.leaderId === playerId && this.state.players.length > 0) {
      this.state.leaderId = this.state.players[0].id;
    }

    console.log('Player left - remaining players:', remainingPlayers.length);
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
