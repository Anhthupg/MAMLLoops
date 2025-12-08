import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { audioEngine } from '../audio/AudioEngine';
import type { Loop, NoteEvent } from '../types';

export function useAudioEngine() {
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [currentBar, setCurrentBar] = useState(0);
  const [tempo, setTempo] = useState(120);
  const activeLoopsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    audioEngine.onBeat((beat, bar) => {
      setCurrentBeat(beat);
      setCurrentBar(bar);
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
        setIsReady(true);
        console.log('Audio context started successfully');
      } catch (err) {
        console.error('Failed to start audio:', err);
      }
    }
  }, [isReady]);

  const start = useCallback(async () => {
    // Ensure audio is initialized first
    if (!isReady) {
      await initAudio();
    }
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
    if (active) {
      // createLoop will skip if already exists
      audioEngine.createLoop(loop);
      audioEngine.startLoop(loop.id);
      activeLoopsRef.current.add(loop.id);
    } else {
      // stopLoop just mutes - keeps sequence running for sync
      audioEngine.stopLoop(loop.id);
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
    setLoopVolume,
    setLoopTranspose,
    previewPattern,
    stopPreview,
    playPreviewNote,
  };
}
