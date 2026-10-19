import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  OrbitalElements,
  OrbitPath,
  SatelliteState,
  WorkerOutput,
} from '../shared/types';

export interface EngineFrame {
  time: number;
  states: Map<number, SatelliteState>;
}
export interface OrbitEngine {
  frame: MutableRefObject<EngineFrame>;
  states: SatelliteState[];
  paths: OrbitPath[];
  failed: number[];
}

export function useOrbitEngine(
  elements: OrbitalElements[],
  offset: number,
): OrbitEngine {
  const worker = useRef<Worker | null>(null);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const frame = useRef<EngineFrame>({ time: 0, states: new Map() });
  const [states, setStates] = useState<SatelliteState[]>([]);
  const [paths, setPaths] = useState<OrbitPath[]>([]);
  const [failed, setFailed] = useState<number[]>([]);

  useEffect(() => {
    const instance = new Worker(
      new URL('./engine.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkerOutput>) => {
      const message = event.data;
      if (message.type === 'states') {
        frame.current = {
          time: message.time,
          states: new Map(message.states.map((state) => [state.id, state])),
        };
        setStates(message.states);
        setFailed(message.failed);
      } else setPaths(message.paths);
    };
    const timer = window.setInterval(
      () =>
        instance.postMessage({
          type: 'tick',
          time: Date.now() + offsetRef.current,
        }),
      500,
    );
    return () => {
      window.clearInterval(timer);
      instance.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    worker.current?.postMessage({
      type: 'elements',
      elements,
      time: Date.now() + offset,
    });
  }, [elements, offset]);

  return { frame, states, paths, failed };
}
