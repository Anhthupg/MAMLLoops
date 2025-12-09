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
  volume: number; // 0-2 (0x to 2x)
  transpose: number; // -12 to +12 semitones
  muted: boolean;
  instrument: InstrumentType; // Sound type - determines synth and pattern style
  variation: number; // 0-4 (A-E) for different sample styles
}

// Variation count - 10 variations per instrument type
export const VARIATION_COUNT = 10;

// Variation labels for dropdown (numbers for simplicity, patterns show visual preview)
export const VARIATION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

// Incredibox-style instrument types for different musical registers
export type InstrumentType =
  | 'drums'     // Percussion/beats
  | 'bass'      // Low-end bass lines
  | 'chord'     // Chord stabs/pads
  | 'arpeggio'  // Arpeggiated patterns (current Glass style)
  | 'lead'      // Melody/lead lines
  | 'fx'        // Effects/textures
  | 'vocal';    // Vocal-like synth sounds

// Instrument display info
export const INSTRUMENT_INFO: Record<InstrumentType, { label: string; icon: string; color: string }> = {
  drums: { label: 'Drums', icon: 'DR', color: '#ef4444' },
  bass: { label: 'Bass', icon: 'BS', color: '#f97316' },
  chord: { label: 'Chord', icon: 'CH', color: '#eab308' },
  arpeggio: { label: 'Arp', icon: 'AR', color: '#22c55e' },
  lead: { label: 'Lead', icon: 'LD', color: '#3b82f6' },
  fx: { label: 'FX', icon: 'FX', color: '#8b5cf6' },
  vocal: { label: 'Vocal', icon: 'VO', color: '#ec4899' },
};

export interface Player {
  id: string;
  name: string;
  color: string;
  loops: Loop[];
  isReady: boolean;
}

// Snapshot of a loop's state for section memory
export interface LoopSnapshot {
  loopId: string;
  playerId: string;
  pattern: NoteEvent[];
  muted: boolean;
  volume?: number;
  transpose?: number;
  variation?: number;
}

export interface Section {
  id: string;
  name: string; // e.g., "A", "B", "Coda"
  loops: string[]; // Loop IDs active in this section
  bars: number; // How many bars before auto-advance (0 = manual)
  hasMemory: boolean; // Whether this section saves loop states
  snapshot?: LoopSnapshot[]; // Saved loop states (if hasMemory)
}

export interface SectionVote {
  playerId: string;
  sectionIndex: number;
}

// Vote to create a new section from current loop state
export interface CreateSectionVote {
  playerId: string;
  hasMemory: boolean; // true = save loop patterns, false = just marker
  loopStateHash: string; // Hash of current active loops when vote was cast
}

export interface RoomState {
  id: string;
  players: Player[];
  sections: Section[];
  currentSectionIndex: number;
  nextSectionIndex: number | null;
  sectionVotes: SectionVote[]; // Votes for next section
  createSectionVotes: CreateSectionVote[]; // Votes to create new section
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
  | { type: 'loop_volume'; playerId: string; loopId: string; volume: number }
  | { type: 'loop_transpose'; playerId: string; loopId: string; transpose: number }
  | { type: 'section_change'; sectionIndex: number; snapshot?: LoopSnapshot[] }
  | { type: 'section_queue'; sectionIndex: number }
  | { type: 'section_vote'; playerId: string; sectionIndex: number }
  | { type: 'create_section_vote'; playerId: string; hasMemory: boolean; loopStateHash: string }
  | { type: 'create_section_reset'; reason: 'pattern_changed' }
  | { type: 'sync_request' }
  | { type: 'state_sync'; state: RoomState }
  | { type: 'ready'; playerId: string; ready: boolean }
  | { type: 'clock_sync'; clock: ClockSync }
  | { type: 'ping'; sendTime: number }
  | { type: 'pong'; sendTime: number; receiveTime: number };
