import { useCallback, useEffect, useRef, useState } from 'react';
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

  const start = useCallback(async () => {
    if (!isReady) {
      await audioEngine.start();
      setIsReady(true);
    }
    audioEngine.play();
    setIsPlaying(true);
  }, [isReady]);

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
      await audioEngine.start();
      setIsReady(true);
    }
    audioEngine.previewPattern(pattern, bars);
  }, [isReady]);

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
