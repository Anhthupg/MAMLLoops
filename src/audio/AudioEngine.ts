import * as Tone from 'tone';
import type { Loop, TransportState, ClockSync } from '../types';

// Glass-inspired arpeggio patterns
const ARPEGGIO_PATTERNS = {
  glass4: ['C4', 'E4', 'G4', 'B4', 'C5', 'B4', 'G4', 'E4'], // 4-bar feel
  glass5: ['D4', 'F#4', 'A4', 'C5', 'E5', 'C5', 'A4', 'F#4', 'D4', 'A3'], // 5-bar feel
  glass8: ['A3', 'E4', 'A4', 'C5', 'E5', 'A5', 'E5', 'C5', 'A4', 'E4', 'C4', 'E4', 'A4', 'C5', 'E5', 'A5'], // 8-bar feel
  bass4: ['C2', 'C2', 'G2', 'G2', 'C2', 'C2', 'E2', 'G2'],
  bass5: ['D2', 'D2', 'A2', 'D2', 'F#2', 'D2', 'A2', 'D2', 'D2', 'A1'],
};

export class AudioEngine {
  private synths: Map<string, Tone.PolySynth> = new Map();
  private sequences: Map<string, Tone.Sequence> = new Map();
  private isStarted = false;
  private onBeatCallback?: (beat: number, bar: number) => void;
  private beatsPerBar = 4;

  // Clock sync state
  private clockOffset = 0; // Offset from leader's clock in ms
  private latency = 0; // Measured network latency in ms

  constructor() {
    // Set up transport
    Tone.getTransport().bpm.value = 120;
    Tone.getTransport().timeSignature = this.beatsPerBar;
  }

  async start(): Promise<void> {
    if (!this.isStarted) {
      await Tone.start();
      this.isStarted = true;

      // Set up beat tracking
      Tone.getTransport().scheduleRepeat((time) => {
        const position = Tone.getTransport().position as string;
        const [bars, beats] = position.split(':').map(Number);

        if (this.onBeatCallback) {
          Tone.getDraw().schedule(() => {
            this.onBeatCallback!(beats, bars);
          }, time);
        }
      }, '4n');
    }
  }

  setTempo(bpm: number): void {
    Tone.getTransport().bpm.value = bpm;
  }

  getTempo(): number {
    return Tone.getTransport().bpm.value;
  }

  play(): void {
    Tone.getTransport().start();
  }

  // Synchronized play - start at a coordinated time
  playSynced(startTime: number): void {
    const now = performance.now();
    const adjustedStartTime = startTime - this.clockOffset;
    const delay = Math.max(0, adjustedStartTime - now);

    if (delay > 0) {
      // Schedule start for the future
      setTimeout(() => {
        Tone.getTransport().start();
      }, delay);
    } else {
      // Start immediately but adjust position based on how late we are
      const lateBars = this.msToSeconds(Math.abs(delay)) * (this.getTempo() / 60) / this.beatsPerBar;
      Tone.getTransport().start(undefined, `${Math.floor(lateBars)}:0:0`);
    }
  }

  stop(): void {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  private msToSeconds(ms: number): number {
    return ms / 1000;
  }

  onBeat(callback: (beat: number, bar: number) => void): void {
    this.onBeatCallback = callback;
  }

  getTransportState(): TransportState {
    const position = Tone.getTransport().position as string;
    const [bars, beats] = position.split(':').map(Number);

    return {
      isPlaying: Tone.getTransport().state === 'started',
      tempo: Tone.getTransport().bpm.value,
      currentBeat: beats,
      currentBar: bars,
      timeSignature: [this.beatsPerBar, 4],
    };
  }

  // Create a looping synth pattern for a loop
  createLoop(loop: Loop): void {
    // Clean up existing
    this.removeLoop(loop.id);

    // Create synth based on loop characteristics
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: loop.bars <= 4 ? 'triangle' : 'sine' },
      envelope: {
        attack: 0.02,
        decay: 0.1,
        sustain: 0.3,
        release: 0.8,
      },
    }).toDestination();

    synth.volume.value = Tone.gainToDb(loop.volume);
    this.synths.set(loop.id, synth);

    // Get pattern based on loop length
    const patternKey = `glass${loop.bars}` as keyof typeof ARPEGGIO_PATTERNS;
    const notes = ARPEGGIO_PATTERNS[patternKey] || ARPEGGIO_PATTERNS.glass4;

    // Calculate the loop duration in bars
    const loopDuration = `${loop.bars}m`;

    // Create sequence that loops
    const sequence = new Tone.Sequence(
      (time, note) => {
        if (!loop.muted) {
          synth.triggerAttackRelease(note, '8n', time);
        }
      },
      notes,
      '8n'
    );

    sequence.loop = true;
    sequence.loopEnd = Tone.Time(loopDuration).toSeconds();
    this.sequences.set(loop.id, sequence);
  }

  startLoop(loopId: string): void {
    const sequence = this.sequences.get(loopId);
    if (sequence) {
      sequence.start(0);
    }
  }

  stopLoop(loopId: string): void {
    const sequence = this.sequences.get(loopId);
    if (sequence) {
      sequence.stop();
    }
  }

  setLoopVolume(loopId: string, volume: number): void {
    const synth = this.synths.get(loopId);
    if (synth) {
      synth.volume.value = Tone.gainToDb(volume);
    }
  }

  setLoopMuted(loopId: string, muted: boolean): void {
    const synth = this.synths.get(loopId);
    if (synth) {
      synth.volume.value = muted ? -Infinity : 0;
    }
  }

  removeLoop(loopId: string): void {
    const sequence = this.sequences.get(loopId);
    if (sequence) {
      sequence.stop();
      sequence.dispose();
      this.sequences.delete(loopId);
    }

    const synth = this.synths.get(loopId);
    if (synth) {
      synth.dispose();
      this.synths.delete(loopId);
    }
  }

  // Get current position within a specific loop (for visualization)
  getLoopPhase(loopBars: number): number {
    const position = Tone.getTransport().position as string;
    const [bars] = position.split(':').map(Number);
    return (bars % loopBars) / loopBars;
  }

  // Calculate when all loops will realign (LCM)
  calculateRealignment(loopBars: number[]): number {
    if (loopBars.length === 0) return 0;

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

    return loopBars.reduce(lcm);
  }

  dispose(): void {
    this.sequences.forEach((seq) => seq.dispose());
    this.synths.forEach((synth) => synth.dispose());
    this.sequences.clear();
    this.synths.clear();
    Tone.getTransport().stop();
    Tone.getTransport().cancel();
  }

  // === Clock Synchronization Methods ===

  // Handle clock sync from leader
  handleClockSync(clock: ClockSync): void {
    const localTime = performance.now();
    const newOffset = localTime - clock.leaderTime;

    // Smooth the offset to avoid jitter (exponential moving average)
    this.clockOffset = this.clockOffset * 0.8 + newOffset * 0.2;

    // Optionally adjust transport position if drift is significant
    const expectedPosition = clock.transportPosition;
    const currentPosition = this.getCurrentPositionInBars();
    const drift = Math.abs(expectedPosition - currentPosition);

    // If drift exceeds 0.25 bars, resync position
    if (drift > 0.25 && Tone.getTransport().state === 'started') {
      console.log(`Clock drift: ${drift.toFixed(3)} bars, resyncing...`);
      this.syncToPosition(expectedPosition);
    }
  }

  // Update latency from ping/pong measurement
  setLatency(latencyMs: number): void {
    // Smooth latency measurements
    this.latency = this.latency * 0.7 + latencyMs * 0.3;
  }

  getLatency(): number {
    return this.latency;
  }

  getClockOffset(): number {
    return this.clockOffset;
  }

  // Sync transport to a specific bar position
  syncToPosition(bars: number): void {
    const wasPlaying = Tone.getTransport().state === 'started';
    if (wasPlaying) {
      Tone.getTransport().pause();
    }
    Tone.getTransport().position = `${Math.floor(bars)}:0:0`;
    if (wasPlaying) {
      Tone.getTransport().start();
    }
  }

  // Get current position in bars (including fractional)
  getCurrentPositionInBars(): number {
    const position = Tone.getTransport().position as string;
    const parts = position.split(':').map(Number);
    return parts[0] + parts[1] / this.beatsPerBar + parts[2] / (this.beatsPerBar * 4);
  }

  // Calculate expected position based on shared start time
  getExpectedPosition(sharedStartTime: number): number {
    const elapsed = performance.now() - sharedStartTime + this.clockOffset;
    const beatsPerMs = this.getTempo() / 60 / 1000;
    return (elapsed * beatsPerMs) / this.beatsPerBar;
  }
}

// Singleton instance
export const audioEngine = new AudioEngine();
