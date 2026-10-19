import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { create } from '@react-three/test-renderer';
import { ecfToEci, geodeticToEcf, gstime } from 'satellite.js';
import { Vector3, type InterleavedBufferAttribute } from 'three';
import type { Line2 } from 'three-stdlib';
import {
  satelliteSeparation,
  altitudeDifferenceKm,
  type DistancePair,
  type DistanceReading,
} from '../shared/distance';
import {
  EARTH_RADIUS_KM,
  parseElements,
  stateAt,
  toScene,
} from '../shared/orbits';
import type {
  OrbitalElements,
  SatelliteSelection,
  SimulationClock,
} from '../shared/types';
import type { OrbitEngine } from '../src/useOrbitEngine';
import DistanceMeasurement from '../src/DistanceMeasurement';
import fixtures from '../src/data/demo.json';

test('satellite distance measures the 3D segment in kilometers, including altitude, with symmetric endpoints', () => {
  const sameGroundPoint = satelliteSeparation([1.1, 0, 0], [1.2, 0, 0])!;
  assert.ok(
    Math.abs(sameGroundPoint.kilometers - EARTH_RADIUS_KM * 0.1) < 1e-9,
  );
  const a: [number, number, number] = [1.1, 0, 0];
  const b: [number, number, number] = [1.1, 0.003, 0.004];
  assert.ok(
    Math.abs(satelliteSeparation(a, b)!.kilometers - 0.005 * EARTH_RADIUS_KM) <
      1e-9,
  );
  assert.deepEqual(satelliteSeparation(a, b), satelliteSeparation(b, a));
  assert.equal(satelliteSeparation(a, a)!.kilometers, 0);
  assert.equal(satelliteSeparation(a, [NaN, 0, 0]), null);
});

test('altitude difference uses geodetic heights at different latitudes and identifies the higher satellite', () => {
  const time = Date.UTC(2026, 9, 19);
  const sidereal = gstime(new Date(time));
  const position = (latitude: number, height: number) =>
    toScene(
      ecfToEci(
        geodeticToEcf({
          latitude: (latitude * Math.PI) / 180,
          longitude: -1.2,
          height,
        }),
        sidereal,
      ),
    );
  const a = position(0, 400);
  const sameAltitude = position(75, 400);
  const higher = position(-60, 650);
  assert.ok(
    Math.abs(altitudeDifferenceKm(a, sameAltitude, time)!) < 1e-8,
    'equal heights at different latitudes must not be mistaken for a difference in Earth-center radii',
  );
  assert.ok(Math.abs(altitudeDifferenceKm(a, higher, time)! - 250) < 1e-8);
  assert.ok(Math.abs(altitudeDifferenceKm(higher, a, time)! + 250) < 1e-8);
  assert.equal(altitudeDifferenceKm(a, [NaN, 0, 0], time), null);
});

test('line of sight checks the finite segment against Earth without changing the measured separation', () => {
  const blocked = satelliteSeparation([-1.1, 0, 0], [1.1, 0, 0])!;
  assert.equal(blocked.earthBlocked, true);
  assert.ok(Math.abs(blocked.kilometers - 2.2 * EARTH_RADIUS_KM) < 1e-9);
  assert.equal(
    satelliteSeparation([-2, 1, 0], [2, 1, 0])!.earthBlocked,
    false,
    'a tangent segment is not inside Earth',
  );
  assert.equal(
    satelliteSeparation([-2, 0.99, 0], [2, 0.99, 0])!.earthBlocked,
    true,
  );
  assert.equal(
    satelliteSeparation([2, 0, 0], [3, 0, 0])!.earthBlocked,
    false,
    'the extended infinite line must not count',
  );
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test('measurement follows rendered endpoints, handles hidden and missing satellites, and keeps line visibility independent of the readout', async (context) => {
  let now = 0;
  context.mock.method(performance, 'now', () => now);
  const time = Date.UTC(2026, 9, 19);
  const [a, b] = fixtures.slice(0, 2).map((fixture, index) => ({
    ...stateAt(fixture.id, parseElements(fixture), time)!,
    position: [1.1, index * 0.1, 0] as [number, number, number],
    velocity: [0, 0, 0] as [number, number, number],
  }));
  const elements: OrbitalElements[] = fixtures.slice(0, 2).map((fixture) => ({
    ...fixture,
    epoch: time,
    fetchedAt: time,
    nextRefreshAt: time + 3600000,
    source: 'demo',
    stale: false,
  }));
  const selections: SatelliteSelection[] = [a, b].map((satellite) => ({
    id: satellite.id,
    visible: true,
    color: '#fff',
  }));
  const markerPositions = new Map([
    [a.id, new Vector3(...a.position)],
    [b.id, new Vector3(1.1, 0.2, 0)],
  ]);
  const engine: OrbitEngine = {
    frame: {
      current: {
        time,
        until: time + 1000,
        states: new Map([
          [a.id, a],
          [b.id, b],
        ]),
        futureStates: new Map(),
      },
    },
    states: [a, b],
    paths: [],
    failed: [],
  };
  const readings: (DistanceReading | null)[] = [];
  const props = {
    pair: [a.id, b.id] as DistancePair,
    showLine: true,
    engine,
    elements,
    selections,
    markerPositions,
    clock: { anchorTime: time, anchorRealTime: 0, rate: 0 } as SimulationClock,
    onReading: (reading: DistanceReading | null) => {
      readings.push(reading);
    },
  };
  const renderer = await create(createElement(DistanceMeasurement, props));
  const last = () => readings.at(-1);
  const advance = async () => {
    now += 300;
    await renderer.advanceFrames(1, 1 / 60);
  };
  try {
    await advance();
    const line = renderer.scene.findByType('Line2').instance as Line2;
    const geometry = line.geometry;
    assert.equal(line.visible, true);
    assert.ok(Math.abs(last()!.kilometers - 0.2 * EARTH_RADIUS_KM) < 1e-9);
    const initialAltitudeDelta = last()!.altitudeDeltaKm;
    assert.ok(
      initialAltitudeDelta > 0,
      'altitude difference uses the same rendered endpoints',
    );
    const end = geometry.getAttribute(
      'instanceEnd',
    ) as InterleavedBufferAttribute;
    assert.ok(Math.abs(end.getY(0) - 0.2) < 1e-7);

    markerPositions.get(b.id)!.set(1.1, 0.3, 0);
    await advance();
    assert.equal(line.geometry, geometry, 'geometry is reused while moving');
    assert.ok(Math.abs(end.getY(0) - 0.3) < 1e-7);
    assert.ok(Math.abs(last()!.kilometers - 0.3 * EARTH_RADIUS_KM) < 1e-9);
    assert.ok(
      last()!.altitudeDeltaKm > initialAltitudeDelta,
      'the altitude difference updates as the satellites move',
    );

    props.showLine = false;
    await renderer.update(createElement(DistanceMeasurement, props));
    await advance();
    assert.equal(line.visible, false);
    assert.ok(last(), 'turning the line off retains the numerical reading');

    props.showLine = true;
    props.selections = selections.map((satellite) => ({
      ...satellite,
      visible: satellite.id !== b.id,
    }));
    await renderer.update(createElement(DistanceMeasurement, props));
    await advance();
    assert.equal(line.visible, false);
    assert.ok(
      Math.abs(last()!.kilometers - 0.1 * EARTH_RADIUS_KM) < 1e-9,
      'hidden endpoints use current orbital states instead of stale marker positions',
    );

    props.elements = [elements[0]];
    await renderer.update(createElement(DistanceMeasurement, props));
    await advance();
    assert.equal(
      last(),
      null,
      'a missing historical element set must not produce a reading from old worker state',
    );

    props.elements = elements;
    props.clock = { anchorTime: time - 60000, anchorRealTime: 0, rate: 0 };
    await renderer.update(createElement(DistanceMeasurement, props));
    await advance();
    assert.equal(
      last(),
      null,
      'seeking outside the worker frame waits for fresh positions',
    );

    props.clock = { anchorTime: time, anchorRealTime: 0, rate: 0 };
    props.pair = [a.id, a.id];
    await renderer.update(createElement(DistanceMeasurement, props));
    await advance();
    assert.equal(last(), null, 'two different satellites are required');
    assert.equal(line.visible, false);
  } finally {
    await renderer.unmount();
  }
});
