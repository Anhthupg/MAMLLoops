// Core types for the polymetric loop system

export interface Loop {
  id: string;
  name: string;
  bars: number; // Length in bars (4, 5, 8, etc. - Philip Glass style)
  color: string;
  pattern: boolean[]; // Which beats are active (for visualization)
  soundUrl?: string;
  volume: number; // 0-1
  muted: boolean;
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
}

export interface TransportState {
  isPlaying: boolean;
  tempo: number;
  currentBeat: number; // Beat within current bar
  currentBar: number; // Global bar count
  timeSignature: [number, number]; // e.g., [4, 4]
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

// Sync messages between devices
export type SyncMessage =
  | { type: 'join'; player: Player }
  | { type: 'leave'; playerId: string }
  | { type: 'transport'; state: TransportState }
  | { type: 'loop_trigger'; playerId: string; loopId: string; active: boolean }
  | { type: 'section_change'; sectionIndex: number }
  | { type: 'section_queue'; sectionIndex: number }
  | { type: 'state_sync'; state: RoomState }
  | { type: 'ready'; playerId: string; ready: boolean };
