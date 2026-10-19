import {
  twoline2satrec,
  propagate,
  eciToGeodetic,
  gstime,
  degreesLat,
  degreesLong,
  type SatRec,
} from 'satellite.js';
import type { OrbitalElements, SatelliteState, OrbitPath } from './types';

export const EARTH_RADIUS_KM = 6378.137;
export const JULIAN_UNIX_EPOCH = 2440587.5;
export const epochFromRecord = (record: SatRec) =>
  (record.jdsatepoch - JULIAN_UNIX_EPOCH) * 86400000;

// TEME/ECI Z is north. Three.js Y is up; the negative Y-to-Z mapping preserves handedness.
export function toScene(vector: {
  x: number;
  y: number;
  z: number;
}): [number, number, number] {
  return [
    vector.x / EARTH_RADIUS_KM,
    vector.z / EARTH_RADIUS_KM,
    -vector.y / EARTH_RADIUS_KM,
  ];
}

export function stateAt(
  id: number,
  record: SatRec,
  time: number,
): SatelliteState | null {
  const date = new Date(time);
  const result = propagate(record, date);
  if (!result) return null;
  const { position, velocity } = result;
  if (
    ![
      position.x,
      position.y,
      position.z,
      velocity.x,
      velocity.y,
      velocity.z,
    ].every(Number.isFinite)
  )
    return null;
  const geodetic = eciToGeodetic(position, gstime(date));
  return {
    id,
    position: toScene(position),
    velocity: toScene(velocity),
    latitude: degreesLat(geodetic.latitude),
    longitude: degreesLong(geodetic.longitude),
    altitude: geodetic.height,
    speed: Math.hypot(velocity.x, velocity.y, velocity.z),
    period: (2 * Math.PI) / record.no,
    inclination: (record.inclo * 180) / Math.PI,
  };
}

export function orbitAt(id: number, record: SatRec, time: number): OrbitPath {
  const duration = Math.min(((2 * Math.PI) / record.no) * 60000, 7 * 86400000);
  const points: [number, number, number][] = [];
  for (let i = 0; i <= 256; i++) {
    const state = stateAt(id, record, time + duration * (i / 256 - 0.12));
    if (state) points.push(state.position);
  }
  return { id, points };
}

export function parseElements(
  elements: Pick<OrbitalElements, 'line1' | 'line2'>,
) {
  return twoline2satrec(elements.line1, elements.line2);
}
