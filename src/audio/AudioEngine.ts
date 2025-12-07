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

// Note names for transposition
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Transpose a note string by semitones (e.g., "C4" + 2 = "D4")
function transposeNote(note: string, semitones: number): string {
  if (semitones === 0) return note;

  const match = note.match(/^([A-G]#?)(\d)$/);
  if (!match) return note;

  const noteName = match[1];
  const octave = parseInt(match[2]);

  // Convert to MIDI-like pitch
  const noteIndex = NOTE_NAMES.indexOf(noteName);
  if (noteIndex === -1) return note;

  const totalSemitones = octave * 12 + noteIndex + semitones;
  const newOctave = Math.floor(totalSemitones / 12);
  const newNoteIndex = ((totalSemitones % 12) + 12) % 12; // Handle negative

  return `${NOTE_NAMES[newNoteIndex]}${newOctave}`;
}

export class AudioEngine {
  private synths: Map<string, Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth> = new Map();
  private sequences: Map<string, Tone.Sequence> = new Map();
  private loopBars: Map<string, number> = new Map(); // Store loop bar lengths
  private loopInstruments: Map<string, InstrumentType> = new Map(); // Store loop instrument types
  private loopTranspose: Map<string, number> = new Map(); // Store loop transpose (-12 to +12 semitones)
  private loopMuted: Map<string, boolean> = new Map(); // Store loop muted state (for dynamic lookup in Part callback)
  private isStarted = false;
  private onBeatCallback?: (beat: number, bar: number) => void;
  private beatsPerBar = 4;

  // Master gain for fade in/out
  private masterGain: Tone.Gain;

  // Clock sync state
  private clockOffset = 0; // Offset from leader's clock in ms
  private latency = 0; // Measured network latency in ms

  // Preview/audition synth (separate from main mix)
  private previewSynth: Tone.PolySynth | null = null;
  private previewPart: Tone.Part | null = null;
  private isPreviewPlaying = false;

  // Fade state
  private isFading = false;

  // Per-loop drum kits (each drum loop gets its own kit to avoid timing conflicts)
  private drumKits: Map<string, {
    kick: Tone.MembraneSynth;
    snare: Tone.NoiseSynth;
    hihat: Tone.MetalSynth;
  }> = new Map();

  constructor() {
    // Set up transport
    Tone.getTransport().bpm.value = 120;
    Tone.getTransport().timeSignature = this.beatsPerBar;

    // Create master gain for fade in/out
    this.masterGain = new Tone.Gain(1).toDestination();

    // Create preview synth with distinct sound (slightly different from main)
    // Preview goes directly to destination (not through master gain) so it plays during fade
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

  // Create a drum kit for a specific loop
  private createDrumKitForLoop(loopId: string): void {
    // Also reinitialize master gain if needed
    if (!this.masterGain || this.masterGain.disposed) {
      this.masterGain = new Tone.Gain(1).toDestination();
    }

    // Clean up existing kit for this loop if any
    const existingKit = this.drumKits.get(loopId);
    if (existingKit) {
      existingKit.kick.dispose();
      existingKit.snare.dispose();
      existingKit.hihat.dispose();
    }

    const drumKit = {
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
      }).connect(this.masterGain),

      // Snare - noise burst
      snare: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: {
          attack: 0.001,
          decay: 0.2,
          sustain: 0,
          release: 0.1,
        },
      }).connect(this.masterGain),

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
      }).connect(this.masterGain),
    };

    drumKit.kick.volume.value = -6;
    drumKit.snare.volume.value = -10;
    drumKit.hihat.volume.value = -12;

    this.drumKits.set(loopId, drumKit);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
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
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume);
    }

    return synth;
  }

  // Play drum sound based on note (using per-loop drum kit)
  private playDrumNote(loopId: string, note: string, time: Tone.Unit.Time): void {
    // Get or create drum kit for this loop
    let drumKit = this.drumKits.get(loopId);
    if (!drumKit) {
      this.createDrumKitForLoop(loopId);
      drumKit = this.drumKits.get(loopId);
    }
    if (!drumKit) return;

    if (note === DRUM_NOTES.kick || note.includes('C1') || note.includes('C2')) {
      drumKit.kick.triggerAttackRelease('C1', '8n', time);
    } else if (note === DRUM_NOTES.snare || note.includes('D1') || note.includes('D2')) {
      drumKit.snare.triggerAttackRelease('8n', time);
    } else if (note === DRUM_NOTES.hihat || note.includes('E1') || note.includes('F1') || note.includes('E2')) {
      drumKit.hihat.triggerAttackRelease('32n', time);
    } else if (note === DRUM_NOTES.clap || note.includes('G1')) {
      drumKit.snare.triggerAttackRelease('16n', time);
    } else {
      // Default to hi-hat for other notes
      drumKit.hihat.triggerAttackRelease('32n', time);
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

  // Stop with fade-out over 2 beats
  stop(): void {
    if (this.isFading) return; // Already fading

    // Calculate fade duration: 2 beats at current tempo
    const bpm = this.getTempo();
    const fadeSeconds = (2 * 60) / bpm; // 2 beats in seconds

    this.isFading = true;

    // Ramp down master gain over 2 beats
    const now = Tone.now();
    this.masterGain.gain.setValueAtTime(1, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    // After fade completes, stop transport and reset
    setTimeout(() => {
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      // Reset master gain for next play
      this.masterGain.gain.setValueAtTime(1, Tone.now());
      this.isFading = false;
    }, fadeSeconds * 1000 + 50); // Add small buffer
  }

  // Immediate stop without fade (for dispose, etc.)
  stopImmediate(): void {
    this.isFading = false;
    this.masterGain.gain.cancelScheduledValues(Tone.now());
    this.masterGain.gain.setValueAtTime(1, Tone.now());
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

  // Check if a loop exists
  hasLoop(loopId: string): boolean {
    return this.sequences.has(loopId);
  }

  // Create a looping synth pattern for a loop
  createLoop(loop: Loop): void {
    // If loop already exists, just update muted state - don't recreate
    if (this.sequences.has(loop.id)) {
      this.loopMuted.set(loop.id, loop.muted);
      return;
    }

    // Get instrument type (default to arpeggio for backwards compatibility)
    const instrument = loop.instrument || 'arpeggio';

    // Create synth based on instrument type
    const synth = this.createSynthForInstrument(instrument, loop.volume);
    this.synths.set(loop.id, synth);
    this.loopBars.set(loop.id, loop.bars);
    this.loopInstruments.set(loop.id, instrument);
    this.loopTranspose.set(loop.id, loop.transpose || 0);
    this.loopMuted.set(loop.id, loop.muted); // Store initial muted state

    // Calculate the loop duration in bars
    const loopDuration = `${loop.bars}m`;
    const loopId = loop.id;

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
        // Look up muted state dynamically (not from closure)
        const isMuted = this.loopMuted.get(loopId) ?? false;
        if (!isMuted) {
          // Get current transpose value (can change during playback)
          const transpose = this.loopTranspose.get(loopId) || 0;
          const playNote = isDrums ? event.note.note : transposeNote(event.note.note, transpose);

          if (isDrums) {
            this.playDrumNote(loopId, playNote, time);
          } else {
            synth.triggerAttackRelease(
              playNote,
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
    // Unmute the loop so it plays
    this.loopMuted.set(loopId, false);
    const sequence = this.sequences.get(loopId);

    if (sequence) {
      // Only start if not already started
      if (sequence.state !== 'started') {
        // Start at transport time 0 - all loops share the same timeline
        sequence.start(0);
      }
    }
  }

  stopLoop(loopId: string): void {
    // Just mute the loop - don't stop it, so it stays in sync
    this.loopMuted.set(loopId, true);
    // We keep the sequence running but muted for sync
    // The Part callback checks loopMuted dynamically
  }

  setLoopVolume(loopId: string, volume: number): void {
    const synth = this.synths.get(loopId);
    if (synth) {
      synth.volume.value = Tone.gainToDb(volume);
    }
  }

  // Set transpose for a loop (-12 to +12 semitones)
  setLoopTranspose(loopId: string, transpose: number): void {
    // Clamp to valid range
    const clampedTranspose = Math.max(-12, Math.min(12, transpose));
    this.loopTranspose.set(loopId, clampedTranspose);
    // No need to recreate sequence - transpose is applied in real-time during playback
  }

  setLoopMuted(loopId: string, muted: boolean): void {
    // Update the muted state in the Map (used by Part callback)
    this.loopMuted.set(loopId, muted);
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

    // Clean up drum kit for this loop
    const drumKit = this.drumKits.get(loopId);
    if (drumKit) {
      drumKit.kick.dispose();
      drumKit.snare.dispose();
      drumKit.hihat.dispose();
      this.drumKits.delete(loopId);
    }

    this.loopBars.delete(loopId);
    this.loopInstruments.delete(loopId);
    this.loopTranspose.delete(loopId);
    this.loopMuted.delete(loopId);
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

      const part = new Tone.Part<PartEvent>((time, event) => {
        // Check muted state dynamically
        const isMuted = this.loopMuted.get(loopId) ?? false;
        if (isMuted) return;

        // Get current transpose value (can change during playback)
        const transpose = this.loopTranspose.get(loopId) || 0;
        const playNote = isDrums ? event.note.note : transposeNote(event.note.note, transpose);

        if (isDrums) {
          this.playDrumNote(loopId, playNote, time);
        } else {
          synth.triggerAttackRelease(playNote, event.note.duration, time, event.note.velocity || 0.8);
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
    this.stopImmediate(); // Use immediate stop to avoid fade delay
    if (this.previewSynth) {
      this.previewSynth.dispose();
      this.previewSynth = null;
    }
    // Dispose all per-loop drum kits
    this.drumKits.forEach((kit) => {
      kit.kick.dispose();
      kit.snare.dispose();
      kit.hihat.dispose();
    });
    this.drumKits.clear();
    if (this.masterGain) {
      this.masterGain.dispose();
    }
    this.sequences.forEach((seq) => seq.dispose());
    this.synths.forEach((synth) => synth.dispose());
    this.sequences.clear();
    this.synths.clear();
    this.loopInstruments.clear();
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
