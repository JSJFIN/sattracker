import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  OrbitalElements,
  OrbitPath,
  SatelliteState,
  WorkerOutput,
  SimulationClock,
} from '../shared/types';
import { simulationTime } from '../shared/clock';

export interface EngineFrame {
  time: number;
  until: number;
  states: Map<number, SatelliteState>;
  futureStates: Map<number, SatelliteState>;
}
export interface OrbitEngine {
  frame: MutableRefObject<EngineFrame>;
  states: SatelliteState[];
  paths: OrbitPath[];
  failed: number[];
}

export function useOrbitEngine(
  elements: OrbitalElements[],
  clock: SimulationClock,
): OrbitEngine {
  const worker = useRef<Worker | null>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const frame = useRef<EngineFrame>({
    time: 0,
    until: 0,
    states: new Map(),
    futureStates: new Map(),
  });
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
          until: message.until,
          states: new Map(message.states.map((state) => [state.id, state])),
          futureStates: new Map(
            message.futureStates.map((state) => [state.id, state]),
          ),
        };
        setStates(message.states);
        setFailed(message.failed);
      } else setPaths(message.paths);
    };
    const timer = window.setInterval(
      () =>
        instance.postMessage({
          type: 'tick',
          time: simulationTime(clockRef.current),
          rate: clockRef.current.rate,
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
      time: simulationTime(clock),
      rate: clock.rate,
    });
  }, [elements, clock]);

  return { frame, states, paths, failed };
}
