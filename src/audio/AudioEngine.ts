import * as Tone from 'tone';
import type { Loop, TransportState, ClockSync, NoteEvent, InstrumentType } from '../types';

// Drum note mapping (using different notes for different drum sounds)
// C1=Kick, D1=Snare, E1=HiHat Closed, F1=HiHat Open, G1=Clap, A1=Tom, B1=Rim
const DRUM_NOTES = {
  kick: 'C1',
  snare: 'D1',
  hihat: 'E1',
  hihatOpen: 'F1',
  clap: 'G1',
  tom: 'A1',
  rim: 'B1',
};

export class AudioEngine {
  private synths: Map<string, Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth> = new Map();
  private sequences: Map<string, Tone.Sequence> = new Map();
  private loopBars: Map<string, number> = new Map(); // Store loop bar lengths
  private loopInstruments: Map<string, InstrumentType> = new Map(); // Store loop instrument types
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

  // Drum kit synths (shared)
  private drumKit: {
    kick: Tone.MembraneSynth;
    snare: Tone.NoiseSynth;
    hihat: Tone.MetalSynth;
  } | null = null;

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

    // Initialize shared drum kit
    this.initDrumKit();
  }

  // Initialize shared drum kit synths
  private initDrumKit(): void {
    this.drumKit = {
      // Kick drum - deep membrane
      kick: new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: {
          attack: 0.001,
          decay: 0.4,
          sustain: 0.01,
          release: 0.4,
        },
      }).toDestination(),

      // Snare - noise burst
      snare: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: {
          attack: 0.001,
          decay: 0.2,
          sustain: 0,
          release: 0.1,
        },
      }).toDestination(),

      // Hi-hat - metallic
      hihat: new Tone.MetalSynth({
        envelope: {
          attack: 0.001,
          decay: 0.1,
          release: 0.01,
        },
        harmonicity: 5.1,
        modulationIndex: 32,
        resonance: 4000,
        octaves: 1.5,
      }).toDestination(),
    };

    this.drumKit.kick.volume.value = -6;
    this.drumKit.snare.volume.value = -10;
    this.drumKit.hihat.volume.value = -12;
  }

  // Create synth based on instrument type
  private createSynthForInstrument(instrument: InstrumentType, volume: number): Tone.PolySynth {
    let synth: Tone.PolySynth;

    switch (instrument) {
      case 'drums':
        // Drums use shared drum kit, but we still need a placeholder synth
        // The actual drum sounds are handled in the sequence callback
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
        }).toDestination();
        synth.volume.value = -Infinity; // Mute - we use drum kit instead
        break;

      case 'bass':
        // Deep, punchy bass
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: {
            attack: 0.01,
            decay: 0.3,
            sustain: 0.4,
            release: 0.3,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      case 'chord':
        // Warm pad chords
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.3,
            decay: 0.5,
            sustain: 0.7,
            release: 1.0,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume) - 6;
        break;

      case 'arpeggio':
        // Classic Glass-style arpeggio (triangle for clarity)
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: {
            attack: 0.02,
            decay: 0.1,
            sustain: 0.3,
            release: 0.8,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume);
        break;

      case 'lead':
        // Bright, cutting lead
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: {
            attack: 0.01,
            decay: 0.2,
            sustain: 0.5,
            release: 0.4,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      case 'fx':
        // Atmospheric/textural
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.5,
            decay: 1.0,
            sustain: 0.3,
            release: 2.0,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume) - 9;
        break;

      case 'vocal':
        // Vocal-like formant sound
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.1,
            decay: 0.3,
            sustain: 0.6,
            release: 0.5,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      default:
        // Default synth
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: {
            attack: 0.02,
            decay: 0.1,
            sustain: 0.3,
            release: 0.8,
          },
        }).toDestination();
        synth.volume.value = Tone.gainToDb(volume);
    }

    return synth;
  }

  // Play drum sound based on note
  private playDrumNote(note: string, time: Tone.Unit.Time): void {
    if (!this.drumKit) return;

    if (note === DRUM_NOTES.kick || note.includes('C1') || note.includes('C2')) {
      this.drumKit.kick.triggerAttackRelease('C1', '8n', time);
    } else if (note === DRUM_NOTES.snare || note.includes('D1') || note.includes('D2')) {
      this.drumKit.snare.triggerAttackRelease('8n', time);
    } else if (note === DRUM_NOTES.hihat || note.includes('E1') || note.includes('F1') || note.includes('E2')) {
      this.drumKit.hihat.triggerAttackRelease('32n', time);
    } else if (note === DRUM_NOTES.clap || note.includes('G1')) {
      this.drumKit.snare.triggerAttackRelease('16n', time);
    } else {
      // Default to hi-hat for other notes
      this.drumKit.hihat.triggerAttackRelease('32n', time);
    }
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

    // Get instrument type (default to arpeggio for backwards compatibility)
    const instrument = loop.instrument || 'arpeggio';

    // Create synth based on instrument type
    const synth = this.createSynthForInstrument(instrument, loop.volume);
    this.synths.set(loop.id, synth);
    this.loopBars.set(loop.id, loop.bars);
    this.loopInstruments.set(loop.id, instrument);

    // Calculate the loop duration in bars
    const loopDuration = `${loop.bars}m`;

    // Use the loop's actual pattern if it has one
    if (loop.pattern && loop.pattern.length > 0) {
      type PartEvent = { time: string; note: NoteEvent };
      const partEvents: PartEvent[] = loop.pattern.map(n => ({
        time: this.beatsToToneTime(n.time),
        note: n
      }));

      // For drums, use drum kit; for others, use the synth
      const isDrums = instrument === 'drums';

      const part = new Tone.Part<PartEvent>((time, event) => {
        if (!loop.muted) {
          if (isDrums) {
            this.playDrumNote(event.note.note, time);
          } else {
            synth.triggerAttackRelease(
              event.note.note,
              event.note.duration,
              time,
              event.note.velocity || 0.8
            );
          }
        }
      }, partEvents);

      part.loop = true;
      part.loopEnd = loopDuration;
      this.sequences.set(loop.id, part as unknown as Tone.Sequence);
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
    this.loopInstruments.delete(loopId);
  }

  // Update a loop's pattern with new notes
  updateLoopPattern(loopId: string, pattern: NoteEvent[]): void {
    const synth = this.synths.get(loopId);
    const oldSequence = this.sequences.get(loopId);
    const instrument = this.loopInstruments.get(loopId) || 'arpeggio';
    const isDrums = instrument === 'drums';

    if (!synth) return;

    // Stop and dispose old sequence
    if (oldSequence) {
      const wasPlaying = oldSequence.state === 'started';
      oldSequence.stop();
      oldSequence.dispose();

      // Create new sequence with the pattern
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
        if (isDrums) {
          this.playDrumNote(event.note.note, time);
        } else {
          synth.triggerAttackRelease(event.note.note, event.note.duration, time, event.note.velocity || 0.8);
        }
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
    if (this.drumKit) {
      this.drumKit.kick.dispose();
      this.drumKit.snare.dispose();
      this.drumKit.hihat.dispose();
      this.drumKit = null;
    }
    this.sequences.forEach((seq) => seq.dispose());
    this.synths.forEach((synth) => synth.dispose());
    this.sequences.clear();
    this.synths.clear();
    this.loopInstruments.clear();
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
