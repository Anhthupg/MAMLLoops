import * as Tone from 'tone';
import type { Loop, TransportState, ClockSync, NoteEvent } from '../types';

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
  private loopBars: Map<string, number> = new Map(); // Store loop bar lengths
  private isStarted = false;
  private onBeatCallback?: (beat: number, bar: number) => void;
  private beatsPerBar = 4;

  // Clock sync state
  private clockOffset = 0; // Offset from leader's clock in ms
  private latency = 0; // Measured network latency in ms

  // Preview/audition synth (separate from main mix)
  private previewSynth: Tone.PolySynth | null = null;
  private previewPart: Tone.Part | null = null;
  private isPreviewPlaying = false;

  constructor() {
    // Set up transport
    Tone.getTransport().bpm.value = 120;
    Tone.getTransport().timeSignature = this.beatsPerBar;

    // Create preview synth with distinct sound (slightly different from main)
    this.previewSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.4,
        release: 0.5,
      },
    }).toDestination();
    this.previewSynth.volume.value = -6; // Slightly quieter than main
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
    this.loopBars.set(loop.id, loop.bars); // Store loop bar length

    // Calculate the loop duration in bars (use "Xm" notation for Tone.js)
    const loopDuration = `${loop.bars}m`;

    // Use the loop's actual pattern if it has one, otherwise fall back to arpeggio
    if (loop.pattern && loop.pattern.length > 0) {
      // Create Part for precise timing with custom pattern
      // Convert beat times to Tone.js time notation (numbers are interpreted as seconds!)
      type PartEvent = { time: string; note: NoteEvent };
      const partEvents: PartEvent[] = loop.pattern.map(n => ({
        time: this.beatsToToneTime(n.time),
        note: n
      }));
      const part = new Tone.Part<PartEvent>((time, event) => {
        if (!loop.muted) {
          synth.triggerAttackRelease(
            event.note.note,
            event.note.duration,
            time,
            event.note.velocity || 0.8
          );
        }
      }, partEvents);

      part.loop = true;
      part.loopEnd = loopDuration; // Use "Xm" notation (bars) for Tone.js
      this.sequences.set(loop.id, part as unknown as Tone.Sequence);
    } else {
      // Fall back to default arpeggio pattern
      const patternKey = `glass${loop.bars}` as keyof typeof ARPEGGIO_PATTERNS;
      const notes = ARPEGGIO_PATTERNS[patternKey] || ARPEGGIO_PATTERNS.glass4;

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
      // Use bar notation - Tone.js accepts string but TypeScript types are incomplete
      (sequence as any).loopEnd = loopDuration;
      this.sequences.set(loop.id, sequence);
    }
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

    this.loopBars.delete(loopId);
  }

  // Update a loop's pattern with new notes
  updateLoopPattern(loopId: string, pattern: NoteEvent[]): void {
    const synth = this.synths.get(loopId);
    const oldSequence = this.sequences.get(loopId);

    if (!synth) return;

    // Stop and dispose old sequence
    if (oldSequence) {
      const wasPlaying = oldSequence.state === 'started';
      oldSequence.stop();
      oldSequence.dispose();

      // Create new sequence with the pattern
      // Convert beat times to Tone.js time notation (numbers are interpreted as seconds!)
      type PartEvent = { time: string; note: NoteEvent };
      const partEvents: PartEvent[] = pattern.map(n => ({
        time: this.beatsToToneTime(n.time),
        note: n
      }));
      console.log('[AudioEngine] updateLoopPattern notes:', partEvents.map(e => ({
        time: e.time,
        note: e.note.note,
        duration: e.note.duration
      })));
      const part = new Tone.Part<PartEvent>((time, event) => {
        synth.triggerAttackRelease(event.note.note, event.note.duration, time, event.note.velocity || 0.8);
      }, partEvents);

      // Configure looping - use stored loop bars, NOT estimated from pattern
      const bars = this.loopBars.get(loopId) || this.getLoopBarsFromPattern(pattern);
      part.loop = true;
      part.loopEnd = `${bars}m`;

      this.sequences.set(loopId, part as unknown as Tone.Sequence);

      // Restart if it was playing
      if (wasPlaying) {
        part.start(0);
      }
    }
  }

  // Estimate loop bars from pattern (find max time and round to bars)
  private getLoopBarsFromPattern(pattern: NoteEvent[]): number {
    if (pattern.length === 0) return 1; // Default 1 bar
    const maxTime = Math.max(...pattern.map(n => n.time));
    // Round up to next bar (4 beats per bar)
    return Math.ceil((maxTime + 1) / 4);
  }

  // Convert beats to Tone.js time notation (bars:beats:sixteenths)
  // Raw numbers in Tone.js are interpreted as seconds, so we need string notation
  private beatsToToneTime(beats: number): string {
    const bars = Math.floor(beats / this.beatsPerBar);
    const remainingBeats = beats % this.beatsPerBar;
    const wholeBeat = Math.floor(remainingBeats);
    const sixteenths = (remainingBeats - wholeBeat) * 4; // 4 sixteenths per beat
    return `${bars}:${wholeBeat}:${sixteenths}`;
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

  // === Preview/Audition Methods (DJ-style pre-listen) ===

  // Preview a pattern before committing - plays once through with preview synth
  previewPattern(pattern: NoteEvent[], bars: number): void {
    // Stop any existing preview
    this.stopPreview();

    if (!this.previewSynth || pattern.length === 0) return;

    // Create a one-shot preview part
    type PartEvent = { time: string; note: NoteEvent };
    const partEvents: PartEvent[] = pattern.map(n => ({
      time: this.beatsToToneTime(n.time),
      note: n
    }));

    const synth = this.previewSynth;
    this.previewPart = new Tone.Part<PartEvent>((time, event) => {
      synth.triggerAttackRelease(event.note.note, event.note.duration, time, event.note.velocity || 0.8);
    }, partEvents);

    // Loop once for preview
    this.previewPart.loop = true;
    this.previewPart.loopEnd = `${bars}m`;

    // Start preview (uses transport time if playing, or immediate if stopped)
    this.previewPart.start(0);
    this.isPreviewPlaying = true;

    // If transport isn't running, temporarily start it for preview
    if (Tone.getTransport().state !== 'started') {
      Tone.getTransport().start();
      // Auto-stop after one loop cycle
      const loopDurationMs = (bars * this.beatsPerBar * 60 * 1000) / this.getTempo();
      setTimeout(() => {
        if (this.isPreviewPlaying) {
          this.stopPreview();
          Tone.getTransport().stop();
          Tone.getTransport().position = 0;
        }
      }, loopDurationMs + 100);
    }
  }

  // Stop preview playback
  stopPreview(): void {
    if (this.previewPart) {
      this.previewPart.stop();
      this.previewPart.dispose();
      this.previewPart = null;
    }
    this.isPreviewPlaying = false;
  }

  // Check if preview is currently playing
  isPreviewActive(): boolean {
    return this.isPreviewPlaying;
  }

  // Play a single note for auditioning (when clicking on timeline)
  playPreviewNote(note: string, duration: string = '8n'): void {
    if (this.previewSynth) {
      this.previewSynth.triggerAttackRelease(note, duration);
    }
  }

  dispose(): void {
    this.stopPreview();
    if (this.previewSynth) {
      this.previewSynth.dispose();
      this.previewSynth = null;
    }
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
