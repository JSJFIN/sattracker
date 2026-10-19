import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { InterleavedBufferAttribute } from 'three';
import type { Line2, LineSegments2 } from 'three-stdlib';
import type {
  OrbitalElements,
  SatelliteSelection,
  SimulationClock,
} from '../shared/types';
import { interpolatedPosition, simulationTime } from '../shared/clock';
import {
  satelliteSeparation,
  altitudeDifferenceKm,
  type DistancePair,
  type DistanceReading,
} from '../shared/distance';
import type { OrbitEngine } from './useOrbitEngine';

interface Props {
  pair: DistancePair;
  showLine: boolean;
  engine: OrbitEngine;
  clock: SimulationClock;
  elements: OrbitalElements[];
  selections: SatelliteSelection[];
  onReading: (reading: DistanceReading | null) => void;
}
const INITIAL_POINTS: [number, number, number][] = [
  [0, 0, 0],
  [0, 0, 0],
];

export default function DistanceMeasurement({
  pair,
  showLine,
  engine,
  clock,
  elements,
  selections,
  onReading,
}: Props) {
  const line = useRef<Line2 | LineSegments2>(null!);
  const lastPublished = useRef(-Infinity);
  const available = useMemo(
    () => new Set(elements.map((element) => element.id)),
    [elements],
  );
  const visible = useMemo(
    () =>
      new Set(
        selections
          .filter((satellite) => satellite.visible)
          .map((satellite) => satellite.id),
      ),
    [selections],
  );
  useFrame(() => {
    const frame = engine.frame.current;
    const time = simulationTime(clock);
    const withinFrame =
      time >= Math.min(frame.time, frame.until) &&
      time <= Math.max(frame.time, frame.until);
    const position = (id: number | null): [number, number, number] | null => {
      if (id === null || !available.has(id) || !withinFrame) return null;
      const state = frame.states.get(id);
      if (!state) return null;
      // Quantitative measurements use orbital positions. Marker easing after a
      // TLE change is a visual effect and must never change the measured range.
      return interpolatedPosition(
        state,
        frame.futureStates.get(id),
        frame.time,
        frame.until,
        time,
      );
    };
    const a = position(pair[0]);
    const b = position(pair[1]);
    const separation =
      a && b && pair[0] !== pair[1] ? satelliteSeparation(a, b) : null;
    line.current.visible = Boolean(
      showLine && separation && visible.has(pair[0]!) && visible.has(pair[1]!),
    );
    if (a && b && line.current.visible) {
      // Update the existing GPU buffer without allocating a new geometry per frame.
      const start = line.current.geometry.getAttribute(
        'instanceStart',
      ) as InterleavedBufferAttribute;
      const end = line.current.geometry.getAttribute(
        'instanceEnd',
      ) as InterleavedBufferAttribute;
      start.setXYZ(0, ...a);
      end.setXYZ(0, ...b);
      start.data.needsUpdate = true;
    }
    const now = performance.now();
    if (now - lastPublished.current >= 250) {
      lastPublished.current = now;
      const altitudeDeltaKm = a && b ? altitudeDifferenceKm(a, b, time) : null;
      onReading(
        separation && altitudeDeltaKm !== null
          ? {
              ids: pair as [number, number],
              clock,
              time,
              ...separation,
              altitudeDeltaKm,
            }
          : null,
      );
    }
  }, -0.35);
  return (
    <Line
      ref={line}
      points={INITIAL_POINTS}
      color="#f5c980"
      lineWidth={1.5}
      transparent
      opacity={0.9}
      depthWrite={false}
      frustumCulled={false}
    />
  );
}
