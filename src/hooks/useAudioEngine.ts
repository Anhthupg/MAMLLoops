import { useCallback, useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/AudioEngine';
import type { Loop } from '../types';

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
      audioEngine.createLoop(loop);
      audioEngine.startLoop(loop.id);
      activeLoopsRef.current.add(loop.id);
    } else {
      audioEngine.stopLoop(loop.id);
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
  };
}
