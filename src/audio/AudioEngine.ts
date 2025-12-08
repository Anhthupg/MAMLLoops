import * as Tone from 'tone';
import type { Loop, TransportState, ClockSync, NoteEvent, InstrumentType } from '../types';

// Drum note mapping (using different notes for different drum sounds)
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

  const noteIndex = NOTE_NAMES.indexOf(noteName);
  if (noteIndex === -1) return note;

  const totalSemitones = octave * 12 + noteIndex + semitones;
  const newOctave = Math.floor(totalSemitones / 12);
  const newNoteIndex = ((totalSemitones % 12) + 12) % 12;

  return `${NOTE_NAMES[newNoteIndex]}${newOctave}`;
}

export class AudioEngine {
  private synths: Map<string, Tone.PolySynth | Tone.MembraneSynth | Tone.NoiseSynth | Tone.MetalSynth> = new Map();
  private sequences: Map<string, Tone.Part> = new Map();
  private loopBars: Map<string, number> = new Map();
  private loopInstruments: Map<string, InstrumentType> = new Map();
  private loopTranspose: Map<string, number> = new Map();
  private loopMuted: Map<string, boolean> = new Map();
  private isStarted = false;
  private onBeatCallback?: (beat: number, bar: number) => void;
  private beatsPerBar = 4;

  private masterGain: Tone.Gain;
  private clockOffset = 0;
  private latency = 0;

  private previewSynth: Tone.PolySynth | null = null;
  private previewPart: Tone.Part | null = null;
  private isPreviewPlaying = false;
  private isFading = false;

  private onLoopStateChangeCallback?: (loopId: string, isPlaying: boolean) => void;

  private drumKits: Map<string, {
    kick: Tone.MembraneSynth;
    snare: Tone.NoiseSynth;
    hihat: Tone.MetalSynth;
  }> = new Map();

  private pendingMuteChanges: Map<string, { muted: boolean; scheduledId?: number }> = new Map();
  private pendingPatternChanges: Map<string, NoteEvent[]> = new Map();
  private loopPatterns: Map<string, NoteEvent[]> = new Map();

  constructor() {
    Tone.getTransport().bpm.value = 120;
    Tone.getTransport().timeSignature = this.beatsPerBar;

    // Use default Tone.js values for maximum stability
    // lookAhead=0.1, updateInterval=0.05 are the defaults
    Tone.getContext().lookAhead = 0.1;
    (Tone.getContext() as unknown as { updateInterval: number }).updateInterval = 0.05;

    this.masterGain = new Tone.Gain(1).toDestination();

    this.previewSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.01,
        decay: 0.1,
        sustain: 0.4,
        release: 0.5,
      },
    }).toDestination();
    this.previewSynth.volume.value = -6;
  }

  private createDrumKitForLoop(loopId: string): void {
    if (!this.masterGain || this.masterGain.disposed) {
      this.masterGain = new Tone.Gain(1).toDestination();
    }

    const existingKit = this.drumKits.get(loopId);
    if (existingKit) {
      existingKit.kick.dispose();
      existingKit.snare.dispose();
      existingKit.hihat.dispose();
    }

    const drumKit = {
      kick: new Tone.MembraneSynth({
        pitchDecay: 0.05,
        octaves: 6,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 0.4 },
      }).connect(this.masterGain),

      snare: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
      }).connect(this.masterGain),

      hihat: new Tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
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

  private createSynthForInstrument(instrument: InstrumentType, volume: number): Tone.PolySynth {
    if (!this.masterGain || this.masterGain.disposed) {
      this.masterGain = new Tone.Gain(1).toDestination();
    }

    let synth: Tone.PolySynth;

    switch (instrument) {
      case 'drums':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
        }).connect(this.masterGain);
        synth.volume.value = -Infinity;
        break;

      case 'bass':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.3 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      case 'chord':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 1.0 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume) - 6;
        break;

      case 'arpeggio':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume);
        break;

      case 'lead':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.4 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      case 'fx':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.5, decay: 1.0, sustain: 0.3, release: 2.0 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume) - 9;
        break;

      case 'vocal':
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { attack: 0.1, decay: 0.3, sustain: 0.6, release: 0.5 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume) - 3;
        break;

      default:
        synth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.02, decay: 0.1, sustain: 0.3, release: 0.8 },
        }).connect(this.masterGain);
        synth.volume.value = Tone.gainToDb(volume);
    }

    return synth;
  }

  private playDrumNote(loopId: string, note: string, time: Tone.Unit.Time, velocity: number = 0.8): void {
    let drumKit = this.drumKits.get(loopId);
    if (!drumKit) {
      this.createDrumKitForLoop(loopId);
      drumKit = this.drumKits.get(loopId);
    }
    if (!drumKit) return;

    if (note === DRUM_NOTES.kick || note.includes('C1') || note.includes('C2')) {
      drumKit.kick.triggerAttackRelease('C1', '8n', time, velocity);
    } else if (note === DRUM_NOTES.snare || note.includes('D1') || note.includes('D2')) {
      drumKit.snare.triggerAttackRelease('8n', time, velocity);
    } else if (note === DRUM_NOTES.hihat || note.includes('E1') || note.includes('F1') || note.includes('E2')) {
      drumKit.hihat.triggerAttackRelease('32n', time, velocity);
    } else if (note === DRUM_NOTES.clap || note.includes('G1')) {
      drumKit.snare.triggerAttackRelease('16n', time, velocity);
    } else {
      drumKit.hihat.triggerAttackRelease('32n', time, velocity);
    }
  }

  async start(): Promise<void> {
    if (!this.isStarted) {
      await Tone.start();
      this.isStarted = true;

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
    // Unmute all pending tracks when play starts
    this.pendingMuteChanges.forEach((pending, loopId) => {
      if (!pending.muted && pending.scheduledId === undefined) {
        this.loopMuted.set(loopId, false);
      }
    });
    this.pendingMuteChanges.forEach((pending, loopId) => {
      if (pending.scheduledId === undefined) {
        this.pendingMuteChanges.delete(loopId);
      }
    });

    Tone.getTransport().start();
  }

  playSynced(startTime: number): void {
    const now = performance.now();
    const adjustedStartTime = startTime - this.clockOffset;
    const delay = Math.max(0, adjustedStartTime - now);

    if (delay > 0) {
      setTimeout(() => {
        Tone.getTransport().start();
      }, delay);
    } else {
      const lateBars = this.msToSeconds(Math.abs(delay)) * (this.getTempo() / 60) / this.beatsPerBar;
      Tone.getTransport().start(undefined, `${Math.floor(lateBars)}:0:0`);
    }
  }

  stop(): void {
    if (this.isFading) return;

    const bpm = this.getTempo();
    const fadeSeconds = (2 * 60) / bpm;

    this.isFading = true;

    const now = Tone.now();
    this.masterGain.gain.setValueAtTime(1, now);
    this.masterGain.gain.linearRampToValueAtTime(0, now + fadeSeconds);

    setTimeout(() => {
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      this.masterGain.gain.setValueAtTime(1, Tone.now());
      this.isFading = false;
    }, fadeSeconds * 1000 + 50);
  }

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

  onLoopStateChange(callback: (loopId: string, isPlaying: boolean) => void): void {
    this.onLoopStateChangeCallback = callback;
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

  hasLoop(loopId: string): boolean {
    return this.sequences.has(loopId);
  }

  createLoop(loop: Loop): void {
    if (this.sequences.has(loop.id)) {
      this.loopMuted.set(loop.id, loop.muted);
      return;
    }

    const instrument = loop.instrument || 'arpeggio';
    const synth = this.createSynthForInstrument(instrument, loop.volume);
    this.synths.set(loop.id, synth);
    this.loopBars.set(loop.id, loop.bars);
    this.loopInstruments.set(loop.id, instrument);
    this.loopTranspose.set(loop.id, loop.transpose || 0);
    this.loopMuted.set(loop.id, true);

    const loopDuration = `${loop.bars}m`;
    const loopId = loop.id;

    if (loop.pattern && loop.pattern.length > 0) {
      type PartEvent = { time: string; note: NoteEvent };
      const partEvents: PartEvent[] = loop.pattern.map(n => ({
        time: this.beatsToToneTime(n.time),
        note: n
      }));

      const isDrums = instrument === 'drums';

      const part = new Tone.Part<PartEvent>((time, event) => {
        const isMuted = this.loopMuted.get(loopId) ?? false;
        if (!isMuted) {
          const transpose = this.loopTranspose.get(loopId) || 0;
          const playNote = isDrums ? event.note.note : transposeNote(event.note.note, transpose);

          if (isDrums) {
            this.playDrumNote(loopId, playNote, time, event.note.velocity || 0.8);
          } else {
            synth.triggerAttackRelease(playNote, event.note.duration, time, event.note.velocity || 0.8);
          }
        }
      }, partEvents);

      part.loop = true;
      part.loopEnd = loopDuration;
      this.sequences.set(loop.id, part);
    }
  }

  startLoop(loopId: string): void {
    const sequence = this.sequences.get(loopId);
    const bars = this.loopBars.get(loopId) || 4;

    if (sequence) {
      if (sequence.state !== 'started') {
        sequence.start(0);
      }

      const transportState = Tone.getTransport().state;

      if (transportState !== 'started') {
        this.pendingMuteChanges.set(loopId, { muted: false, scheduledId: undefined });
      } else {
        const position = Tone.getTransport().position as string;
        const [currentBars, currentBeats] = position.split(':').map(Number);

        const positionInLoop = currentBars % bars;
        const beatsIntoLoop = positionInLoop + (currentBeats / 4);
        const minBufferBeats = bars * 0.25;
        const beatsUntilNextLoop = bars - beatsIntoLoop;

        let nextLoopStart: number;
        if (beatsUntilNextLoop < minBufferBeats) {
          nextLoopStart = Math.ceil((currentBars + 1) / bars) * bars + bars;
        } else {
          nextLoopStart = Math.ceil((currentBars + 1) / bars) * bars;
        }

        const pending = this.pendingMuteChanges.get(loopId);
        if (pending?.scheduledId !== undefined) {
          Tone.getTransport().clear(pending.scheduledId);
        }

        const scheduledId = Tone.getTransport().scheduleOnce((time) => {
          this.loopMuted.set(loopId, false);
          this.pendingMuteChanges.delete(loopId);
          Tone.getDraw().schedule(() => {
            if (this.onLoopStateChangeCallback) {
              this.onLoopStateChangeCallback(loopId, true);
            }
          }, time);
        }, `${nextLoopStart}m`);

        this.pendingMuteChanges.set(loopId, { muted: false, scheduledId });
      }
    }
  }

  stopLoop(loopId: string): void {
    const pending = this.pendingMuteChanges.get(loopId);
    if (pending?.scheduledId !== undefined) {
      Tone.getTransport().clear(pending.scheduledId);
      this.pendingMuteChanges.delete(loopId);
    }
    this.loopMuted.set(loopId, true);
  }

  scheduleStopLoop(loopId: string): void {
    const bars = this.loopBars.get(loopId) || 4;
    const transportState = Tone.getTransport().state;

    if (transportState !== 'started') {
      this.loopMuted.set(loopId, true);
      return;
    }

    const position = Tone.getTransport().position as string;
    const [currentBars] = position.split(':').map(Number);
    const nextLoopStart = Math.ceil((currentBars + 1) / bars) * bars;

    const pending = this.pendingMuteChanges.get(loopId);
    if (pending?.scheduledId !== undefined) {
      Tone.getTransport().clear(pending.scheduledId);
    }

    const scheduledId = Tone.getTransport().scheduleOnce((time) => {
      this.loopMuted.set(loopId, true);
      this.pendingMuteChanges.delete(loopId);
      Tone.getDraw().schedule(() => {
        if (this.onLoopStateChangeCallback) {
          this.onLoopStateChangeCallback(loopId, false);
        }
      }, time);
    }, `${nextLoopStart}m`);

    this.pendingMuteChanges.set(loopId, { muted: true, scheduledId });
  }

  isLoopPendingStop(loopId: string): boolean {
    const pending = this.pendingMuteChanges.get(loopId);
    return pending !== undefined && pending.muted === true;
  }

  isLoopPendingStart(loopId: string): boolean {
    const pending = this.pendingMuteChanges.get(loopId);
    return pending !== undefined && !pending.muted;
  }

  setLoopVolume(loopId: string, volume: number): void {
    const synth = this.synths.get(loopId);
    if (synth) {
      synth.volume.value = Tone.gainToDb(volume);
    }
  }

  setLoopTranspose(loopId: string, transpose: number): void {
    const clampedTranspose = Math.max(-12, Math.min(12, transpose));
    this.loopTranspose.set(loopId, clampedTranspose);
  }

  setLoopMuted(loopId: string, muted: boolean): void {
    this.loopMuted.set(loopId, muted);
  }

  removeLoop(loopId: string): void {
    const pending = this.pendingMuteChanges.get(loopId);
    if (pending?.scheduledId !== undefined) {
      Tone.getTransport().clear(pending.scheduledId);
    }
    this.pendingMuteChanges.delete(loopId);

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
    this.loopPatterns.delete(loopId);
  }

  schedulePatternChange(loopId: string, pattern: NoteEvent[], atBar: number): void {
    this.pendingPatternChanges.set(loopId, pattern);

    Tone.getTransport().scheduleOnce(() => {
      const pendingPattern = this.pendingPatternChanges.get(loopId);
      if (pendingPattern) {
        this.applyPatternChangeNow(loopId, pendingPattern);
        this.pendingPatternChanges.delete(loopId);
      }
    }, `${atBar}m`);
  }

  private applyPatternChangeNow(loopId: string, pattern: NoteEvent[]): void {
    this.updateLoopPattern(loopId, pattern);
  }

  updateLoopPattern(loopId: string, pattern: NoteEvent[]): void {
    const synth = this.synths.get(loopId);
    const existingPart = this.sequences.get(loopId);
    const instrument = this.loopInstruments.get(loopId) || 'arpeggio';
    const isDrums = instrument === 'drums';
    const bars = this.loopBars.get(loopId) || this.getLoopBarsFromPattern(pattern);

    if (!synth) return;

    this.loopPatterns.set(loopId, pattern);

    if (existingPart) {
      existingPart.clear();

      pattern.forEach(n => {
        const time = this.beatsToToneTime(n.time);
        existingPart.add(time, { time, note: n });
      });

      existingPart.loopEnd = `${bars}m`;
      return;
    }

    type PartEvent = { time: string; note: NoteEvent };
    const partEvents: PartEvent[] = pattern.map(n => ({
      time: this.beatsToToneTime(n.time),
      note: n
    }));

    const newPart = new Tone.Part<PartEvent>((time, event) => {
      const isMuted = this.loopMuted.get(loopId) ?? false;
      if (isMuted) return;

      const transpose = this.loopTranspose.get(loopId) || 0;
      const playNote = isDrums ? event.note.note : transposeNote(event.note.note, transpose);

      if (isDrums) {
        this.playDrumNote(loopId, playNote, time, event.note.velocity || 0.8);
      } else {
        synth.triggerAttackRelease(playNote, event.note.duration, time, event.note.velocity || 0.8);
      }
    }, partEvents);

    newPart.loop = true;
    newPart.loopEnd = `${bars}m`;

    this.sequences.set(loopId, newPart);
  }

  private getLoopBarsFromPattern(pattern: NoteEvent[]): number {
    if (pattern.length === 0) return 1;
    const maxTime = Math.max(...pattern.map(n => n.time));
    return Math.ceil((maxTime + 1) / 4);
  }

  private beatsToToneTime(beats: number): string {
    const bars = Math.floor(beats / this.beatsPerBar);
    const remainingBeats = beats % this.beatsPerBar;
    const wholeBeat = Math.floor(remainingBeats);
    const sixteenths = (remainingBeats - wholeBeat) * 4;
    return `${bars}:${wholeBeat}:${sixteenths}`;
  }

  getLoopPhase(loopBars: number): number {
    const position = Tone.getTransport().position as string;
    const [bars] = position.split(':').map(Number);
    return (bars % loopBars) / loopBars;
  }

  calculateRealignment(loopBars: number[]): number {
    if (loopBars.length === 0) return 0;

    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const lcm = (a: number, b: number): number => (a * b) / gcd(a, b);

    return loopBars.reduce(lcm);
  }

  previewPattern(pattern: NoteEvent[], bars: number): void {
    this.stopPreview();

    if (!this.previewSynth || pattern.length === 0) return;

    type PartEvent = { time: string; note: NoteEvent };
    const partEvents: PartEvent[] = pattern.map(n => ({
      time: this.beatsToToneTime(n.time),
      note: n
    }));

    const synth = this.previewSynth;
    this.previewPart = new Tone.Part<PartEvent>((time, event) => {
      synth.triggerAttackRelease(event.note.note, event.note.duration, time, event.note.velocity || 0.8);
    }, partEvents);

    this.previewPart.loop = true;
    this.previewPart.loopEnd = `${bars}m`;

    this.previewPart.start(0);
    this.isPreviewPlaying = true;

    if (Tone.getTransport().state !== 'started') {
      Tone.getTransport().start();
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

  stopPreview(): void {
    if (this.previewPart) {
      this.previewPart.stop();
      this.previewPart.dispose();
      this.previewPart = null;
    }
    this.isPreviewPlaying = false;
  }

  isPreviewActive(): boolean {
    return this.isPreviewPlaying;
  }

  playPreviewNote(note: string, duration: string = '8n'): void {
    if (this.previewSynth) {
      this.previewSynth.triggerAttackRelease(note, duration);
    }
  }

  dispose(): void {
    this.stopPreview();
    this.stopImmediate();

    this.pendingMuteChanges.forEach((pending) => {
      if (pending.scheduledId !== undefined) {
        Tone.getTransport().clear(pending.scheduledId);
      }
    });
    this.pendingMuteChanges.clear();

    if (this.previewSynth) {
      this.previewSynth.dispose();
      this.previewSynth = null;
    }

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
    this.loopPatterns.clear();
    Tone.getTransport().cancel();
  }

  handleClockSync(clock: ClockSync): void {
    const localTime = performance.now();
    const newOffset = localTime - clock.leaderTime;
    this.clockOffset = this.clockOffset * 0.8 + newOffset * 0.2;

    const expectedPosition = clock.transportPosition;
    const currentPosition = this.getCurrentPositionInBars();
    const drift = Math.abs(expectedPosition - currentPosition);

    if (drift > 0.25 && Tone.getTransport().state === 'started') {
      this.syncToPosition(expectedPosition);
    }
  }

  setLatency(latencyMs: number): void {
    this.latency = this.latency * 0.7 + latencyMs * 0.3;
  }

  getLatency(): number {
    return this.latency;
  }

  getClockOffset(): number {
    return this.clockOffset;
  }

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

  getCurrentPositionInBars(): number {
    const position = Tone.getTransport().position as string;
    const parts = position.split(':').map(Number);
    return parts[0] + parts[1] / this.beatsPerBar + parts[2] / (this.beatsPerBar * 4);
  }

  getExpectedPosition(sharedStartTime: number): number {
    const elapsed = performance.now() - sharedStartTime + this.clockOffset;
    const beatsPerMs = this.getTempo() / 60 / 1000;
    return (elapsed * beatsPerMs) / this.beatsPerBar;
  }
}

export const audioEngine = new AudioEngine();
