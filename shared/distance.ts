import { EARTH_RADIUS_KM } from './orbits';
import { eciToGeodetic, gstime } from 'satellite.js';
import type { SimulationClock } from './types';

export type DistancePair = [number | null, number | null];
export interface DistanceReading {
  ids: [number, number];
  clock: SimulationClock;
  time: number;
  kilometers: number;
  earthBlocked: boolean;
  altitudeDeltaKm: number;
}

// Signed B minus A, using the same geodetic height convention as telemetry.
// Undo the scene's inertial-axis mapping before converting to Earth altitude.
export function altitudeDifferenceKm(
  a: [number, number, number],
  b: [number, number, number],
  time: number,
): number | null {
  if (![...a, ...b, time].every(Number.isFinite)) return null;
  const sidereal = gstime(new Date(time));
  const height = (position: [number, number, number]) =>
    eciToGeodetic(
      {
        x: position[0] * EARTH_RADIUS_KM,
        y: -position[2] * EARTH_RADIUS_KM,
        z: position[1] * EARTH_RADIUS_KM,
      },
      sidereal,
    ).height;
  const delta = height(b) - height(a);
  return Number.isFinite(delta) ? delta : null;
}

// Positions use Earth radii in the same inertial frame. Measure the actual 3D
// segment, including altitude, rather than an arc between ground coordinates.
export function satelliteSeparation(
  a: [number, number, number],
  b: [number, number, number],
): { kilometers: number; earthBlocked: boolean } | null {
  if (![...a, ...b].every(Number.isFinite)) return null;
  const delta = b.map((value, axis) => value - a[axis]);
  const lengthSquared = delta.reduce((sum, value) => sum + value * value, 0);
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            -a.reduce((sum, value, axis) => sum + value * delta[axis], 0) /
              lengthSquared,
          ),
        );
  const closest = a.map((value, axis) => value + delta[axis] * t);
  return {
    kilometers: Math.sqrt(lengthSquared) * EARTH_RADIUS_KM,
    earthBlocked: Math.hypot(...closest) < 1 - 1e-9,
  };
}
