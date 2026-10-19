import { Vector3 } from 'three';

export type CameraMode = 'orbit' | 'follow' | 'onboard';
export type OnboardLook = 'forward' | 'earth' | 'space';
export interface LookCommand {
  sequence: number;
  direction: OnboardLook;
}

// Earth remains the look-at target. The viewpoint lies on the Earth–satellite
// radius, outside the satellite, so both project to the center of the globe view.
export function earthFollowPosition(
  satellite: [number, number, number],
  requestedDistance: number,
): [number, number, number] {
  const radius = Math.hypot(...satellite);
  const distance = Math.max(1.15, radius + 0.15, requestedDistance);
  if (radius < 0.000001) return [0, 0, distance];
  return satellite.map((axis) => (axis / radius) * distance) as [
    number,
    number,
    number,
  ];
}

// A local orbital frame: radial up, forward along the orbit, and right across
// the orbit. This avoids the roll flips of a global north/up vector at the poles.
// It represents a viewing convention, not the spacecraft's measured attitude.
export function onboardView(
  position: [number, number, number],
  velocity: [number, number, number],
  yaw: number,
  pitch: number,
): { direction: Vector3; up: Vector3 } {
  const radial = new Vector3(...position);
  if (radial.lengthSq() < 1e-16) radial.set(0, 1, 0);
  radial.normalize();
  const forward = new Vector3(...velocity);
  forward.addScaledVector(radial, -forward.dot(radial));
  if (forward.lengthSq() < 1e-16) {
    forward.set(
      Math.abs(radial.y) < 0.9 ? 0 : 1,
      Math.abs(radial.y) < 0.9 ? 1 : 0,
      0,
    );
    forward.addScaledVector(radial, -forward.dot(radial));
  }
  forward.normalize();
  const right = new Vector3().crossVectors(forward, radial).normalize();
  const horizontal = forward
    .clone()
    .multiplyScalar(Math.cos(yaw))
    .addScaledVector(right, Math.sin(yaw));
  const viewRight = right
    .multiplyScalar(Math.cos(yaw))
    .addScaledVector(forward, -Math.sin(yaw));
  const direction = horizontal
    .multiplyScalar(Math.cos(pitch))
    .addScaledVector(radial, Math.sin(pitch))
    .normalize();
  // Construct up explicitly so looking straight down/up is well-defined too.
  const up = viewRight.cross(direction).normalize();
  return { direction, up };
}
