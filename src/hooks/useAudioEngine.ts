import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { audioEngine } from '../audio/AudioEngine';
import type { Loop, NoteEvent } from '../types';

// Type for loop state change listener
type LoopStateChangeListener = (loopId: string, isPlaying: boolean) => void;

export function useAudioEngine() {
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentBar, setCurrentBar] = useState(0);
  const [tempo, setTempo] = useState(120);
  const activeLoopsRef = useRef<Set<string>>(new Set());

  // Listeners for loop state changes (instant callback from AudioEngine)
  const loopStateListenersRef = useRef<Set<LoopStateChangeListener>>(new Set());

  useEffect(() => {
    audioEngine.onBeat((beat, bar) => {
      setCurrentBeat(beat);
      setCurrentBar(bar);
    });

    // Register for instant loop state change notifications
    audioEngine.onLoopStateChange((loopId, isPlaying) => {
      // Notify all registered listeners immediately
      loopStateListenersRef.current.forEach(listener => {
        listener(loopId, isPlaying);
      });
    });

    return () => {
      audioEngine.dispose();
    };
  }, []);

  // Initialize audio context on first user interaction (critical for iOS)
  const initAudio = useCallback(async () => {
    if (!isReady) {
      // For iOS Safari, we need to resume the audio context AND call Tone.start()
      // This must happen in direct response to a user gesture
      try {
        // Resume the underlying audio context first (iOS requirement)
        const ctx = Tone.getContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        // Then start Tone.js
        await Tone.start();
        await audioEngine.start();

        // Verify the context is actually running (iOS may still block it)
        const rawContext = Tone.getContext().rawContext;
        if (rawContext.state !== 'running') {
          console.warn('Audio context not running after start, state:', rawContext.state);
          throw new Error('Audio context not running');
        }

        setIsReady(true);
        console.log('Audio context started successfully, state:', rawContext.state);
      } catch (err) {
        console.error('Failed to start audio:', err);
        throw err; // Re-throw so caller knows it failed
      }
    }
  }, [isReady]);

  const start = useCallback(async () => {
    // Ensure audio is initialized first
    if (!isReady) {
      await initAudio();
    }
    // Ensure all active loops have their sequences started
    activeLoopsRef.current.forEach(loopId => {
      audioEngine.startLoop(loopId);
    });
    console.log('[useAudioEngine] Starting transport, active loops:', activeLoopsRef.current.size);
    audioEngine.play();
    setIsPlaying(true);
  }, [isReady, initAudio]);

  const stop = useCallback(() => {
    audioEngine.stop();
    setIsPlaying(false);
    setCurrentBeat(0);
    setCurrentBar(0);
  }, []);

  const pause = useCallback(() => {
    audioEngine.pause();
    setIsPlaying(false);
  }, []);

  const changeTempo = useCallback((newTempo: number) => {
    audioEngine.setTempo(newTempo);
    setTempo(newTempo);
  }, []);

  const createLoop = useCallback((loop: Loop) => {
    audioEngine.createLoop(loop);
  }, []);

  const toggleLoop = useCallback((loop: Loop, active: boolean) => {
    console.log('[useAudioEngine] toggleLoop:', loop.id, active, 'pattern length:', loop.pattern.length);
    if (active) {
      // createLoop will skip if already exists
      audioEngine.createLoop(loop);
      audioEngine.startLoop(loop.id);
      activeLoopsRef.current.add(loop.id);
      console.log('[useAudioEngine] Active loops now:', activeLoopsRef.current.size);
    } else {
      // Use quantized stop during playback - schedule mute at end of loop cycle
      audioEngine.scheduleStopLoop(loop.id);
      activeLoopsRef.current.delete(loop.id);
    }
  }, []);

  const removeLoop = useCallback((loopId: string) => {
    audioEngine.removeLoop(loopId);
    activeLoopsRef.current.delete(loopId);
  }, []);

  const getLoopPhase = useCallback((loopBars: number) => {
    return audioEngine.getLoopPhase(loopBars);
  }, []);

  const calculateRealignment = useCallback((loopBars: number[]) => {
    return audioEngine.calculateRealignment(loopBars);
  }, []);

  const updateLoopPattern = useCallback((loopId: string, pattern: NoteEvent[]) => {
    audioEngine.updateLoopPattern(loopId, pattern);
  }, []);

  // Schedule a pattern change at a specific bar (uses Tone.js scheduling for precise timing)
  const schedulePatternChange = useCallback((loopId: string, pattern: NoteEvent[], atBar: number) => {
    audioEngine.schedulePatternChange(loopId, pattern, atBar);
  }, []);

  const setLoopVolume = useCallback((loopId: string, volume: number) => {
    audioEngine.setLoopVolume(loopId, volume);
  }, []);

  const setLoopTranspose = useCallback((loopId: string, transpose: number) => {
    audioEngine.setLoopTranspose(loopId, transpose);
  }, []);

  // Preview pattern before committing (DJ-style pre-listen)
  const previewPattern = useCallback(async (pattern: NoteEvent[], bars: number) => {
    if (!isReady) {
      await initAudio();
    }
    audioEngine.previewPattern(pattern, bars);
  }, [isReady, initAudio]);

  const stopPreview = useCallback(() => {
    audioEngine.stopPreview();
  }, []);

  const playPreviewNote = useCallback((note: string) => {
    audioEngine.playPreviewNote(note);
  }, []);

  // Check if a loop is pending start (queued but not yet playing)
  const isLoopPendingStart = useCallback((loopId: string) => {
    return audioEngine.isLoopPendingStart(loopId);
  }, []);

  // Schedule a loop to stop at the end of its current cycle
  const scheduleStopLoop = useCallback((loopId: string) => {
    audioEngine.scheduleStopLoop(loopId);
  }, []);

  // Check if a loop is pending stop (will stop at end of cycle)
  const isLoopPendingStop = useCallback((loopId: string) => {
    return audioEngine.isLoopPendingStop(loopId);
  }, []);

  // Subscribe to loop state changes (instant callback when loop starts/stops)
  const onLoopStateChange = useCallback((listener: (loopId: string, isPlaying: boolean) => void) => {
    loopStateListenersRef.current.add(listener);
    // Return unsubscribe function
    return () => {
      loopStateListenersRef.current.delete(listener);
    };
  }, []);

  return {
    isReady,
    isPlaying,
    currentBeat,
    currentBar,
    tempo,
    initAudio, // Expose for early initialization on user gesture (iOS)
    start,
    stop,
    pause,
    changeTempo,
    createLoop,
    toggleLoop,
    removeLoop,
    getLoopPhase,
    calculateRealignment,
    updateLoopPattern,
    schedulePatternChange, // Uses Tone.js scheduling for precise timing
    setLoopVolume,
    setLoopTranspose,
    previewPattern,
    stopPreview,
    playPreviewNote,
    isLoopPendingStart,
    scheduleStopLoop,
    isLoopPendingStop,
    onLoopStateChange, // Subscribe to instant loop state changes
  };
}
