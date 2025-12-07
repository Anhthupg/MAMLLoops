// Core types for the polymetric loop system

export interface NoteEvent {
  note: string;      // e.g., "C4", "D#5"
  time: number;      // Beat position (0, 0.5, 1, 1.5, etc.)
  duration: string;  // e.g., "8n", "4n", "2n"
  velocity?: number; // 0-1, defaults to 0.8
}

export interface Loop {
  id: string;
  name: string;
  bars: number; // Length in bars (4, 5, 8, etc. - Philip Glass style)
  color: string;
  pattern: NoteEvent[]; // Custom note pattern
  volume: number; // 0-1
  muted: boolean;
  instrument?: 'synth' | 'piano' | 'strings' | 'bass'; // Sound type
}

export interface Player {
  id: string;
  name: string;
  color: string;
  loops: Loop[];
  isReady: boolean;
}

export interface Section {
  id: string;
  name: string; // e.g., "A", "B", "Coda"
  loops: string[]; // Loop IDs active in this section
  bars: number; // How many bars before auto-advance (0 = manual)
}

export interface RoomState {
  id: string;
  players: Player[];
  sections: Section[];
  currentSectionIndex: number;
  nextSectionIndex: number | null;
  tempo: number; // BPM
  currentBeat: number;
  currentBar: number;
  isPlaying: boolean;
  leaderId: string; // Who can control sections
  maxPlayers: number; // Max allowed players (default 10)
  startTime?: number; // Shared start timestamp for sync
}

export interface TransportState {
  isPlaying: boolean;
  tempo: number;
  currentBeat: number; // Beat within current bar
  currentBar: number; // Global bar count
  timeSignature: [number, number]; // e.g., [4, 4]
  serverTime?: number; // Leader's timestamp for sync
  startTime?: number; // When playback started (for sync)
}

export interface PolymetricState {
  loops: {
    loopId: string;
    currentBar: number; // Position within this loop
    totalBars: number;
    phase: number; // 0-1 for visualization
  }[];
  nextRealignment: number; // Bars until all loops realign
}

// Clock sync message for tight timing
export interface ClockSync {
  leaderTime: number; // Leader's performance.now()
  transportPosition: number; // Current position in bars
  tempo: number;
}

// Sync messages between devices
export type SyncMessage =
  | { type: 'join'; player: Player }
  | { type: 'leave'; playerId: string }
  | { type: 'transport'; state: TransportState }
  | { type: 'loop_trigger'; playerId: string; loopId: string; active: boolean }
  | { type: 'loop_update'; playerId: string; loopId: string; pattern: NoteEvent[] }
  | { type: 'section_change'; sectionIndex: number }
  | { type: 'section_queue'; sectionIndex: number }
  | { type: 'state_sync'; state: RoomState }
  | { type: 'ready'; playerId: string; ready: boolean }
  | { type: 'clock_sync'; clock: ClockSync }
  | { type: 'ping'; sendTime: number }
  | { type: 'pong'; sendTime: number; receiveTime: number };
