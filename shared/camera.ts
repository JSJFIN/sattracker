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
