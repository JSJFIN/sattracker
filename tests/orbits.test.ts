import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoline2satrec, propagate } from 'satellite.js';
import {
  EARTH_RADIUS_KM,
  epochFromRecord,
  orbitAt,
  parseElements,
  stateAt,
  toScene,
} from '../shared/orbits';
import fixtures from '../src/data/demo.json';

test('propagation matches Vallado SGP4 verification case 00005 at its epoch', () => {
  const record = twoline2satrec(
    '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753',
    '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667',
  );
  const result = propagate(record, new Date(epochFromRecord(record)))!;
  const expected = [7022.46529266, -1400.08296755, 0.03995155];
  for (const [i, value] of [
    result.position.x,
    result.position.y,
    result.position.z,
  ].entries()) {
    assert.ok(
      Math.abs(value - expected[i]) < 0.01,
      `${i}: ${value} vs ${expected[i]}`,
    );
  }
});

test('ECI scene mapping preserves scale, handedness, and north', () => {
  assert.deepEqual(toScene({ x: EARTH_RADIUS_KM, y: 0, z: 0 }), [1, 0, -0]);
  assert.deepEqual(toScene({ x: 0, y: 0, z: EARTH_RADIUS_KM }), [0, 1, -0]);
  assert.deepEqual(toScene({ x: 0, y: EARTH_RADIUS_KM, z: 0 }), [0, 0, -1]);
});

test('bundled satellites have valid orbit paths and plausible telemetry at the snapshot time', () => {
  const time = Date.UTC(2026, 9, 19);
  for (const fixture of fixtures) {
    const record = parseElements(fixture);
    const state = stateAt(fixture.id, record, time);
    assert.ok(state, `${fixture.name} propagates`);
    assert.ok(state.altitude > 100 && state.altitude < 50000);
    assert.ok(state.latitude >= -90 && state.latitude <= 90);
    assert.ok(state.longitude >= -180 && state.longitude <= 180);
    assert.ok(state.speed > 1 && state.speed < 10);
    assert.equal(orbitAt(fixture.id, record, time).points.length, 257);
  }
});

test('half-second position/velocity dead reckoning stays within 10 meters of propagation', () => {
  const time = Date.UTC(2026, 9, 19);
  for (const fixture of fixtures) {
    const record = parseElements(fixture);
    const current = stateAt(fixture.id, record, time)!;
    const future = stateAt(fixture.id, record, time + 500)!;
    const errorKm = Math.hypot(
      ...current.position.map(
        (position, i) =>
          (position + current.velocity[i] * 0.5 - future.position[i]) *
          EARTH_RADIUS_KM,
      ),
    );
    assert.ok(errorKm < 0.01, `${fixture.name}: ${errorKm * 1000} m`);
  }
});
