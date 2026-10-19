import type { SimulationClock, SatelliteState } from './types';

export const simulationTime = (clock: SimulationClock, realTime = Date.now()) =>
  clock.anchorTime + (realTime - clock.anchorRealTime) * clock.rate;

// Cubic Hermite interpolation uses two propagated states. It follows orbital curvature
// smoothly even at accelerated/reverse playback rates, without per-frame API requests.
export function interpolatedPosition(
  state: SatelliteState,
  future: SatelliteState | undefined,
  start: number,
  end: number,
  time: number,
): [number, number, number] {
  if (!future || start === end) return state.position;
  const u = Math.min(1, Math.max(0, (time - start) / (end - start)));
  const seconds = (end - start) / 1000;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  return state.position.map(
    (position, axis) =>
      h00 * position +
      h10 * seconds * state.velocity[axis] +
      h01 * future.position[axis] +
      h11 * seconds * future.velocity[axis],
  ) as [number, number, number];
}
