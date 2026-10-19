import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpolatedPosition, simulationTime } from '../shared/clock';
import { EARTH_RADIUS_KM, parseElements, stateAt } from '../shared/orbits';
import fixtures from '../src/data/demo.json';

test('simulation clock pauses, seeks, accelerates and reverses without drifting', () => {
  assert.equal(
    simulationTime({ anchorTime: 5000, anchorRealTime: 1000, rate: 0 }, 999999),
    5000,
  );
  assert.equal(
    simulationTime({ anchorTime: 5000, anchorRealTime: 1000, rate: 10 }, 1500),
    10000,
  );
  assert.equal(
    simulationTime({ anchorTime: 5000, anchorRealTime: 1000, rate: -1 }, 1500),
    4500,
  );
  assert.equal(
    simulationTime({ anchorTime: -2000, anchorRealTime: 0, rate: 1 }, 10000),
    8000,
  );
});

test('replay interpolation follows full propagation within 10 meters, forward and backward up to 60x', () => {
  const start = Date.UTC(2026, 9, 19);
  for (const fixture of fixtures) {
    const record = parseElements(fixture);
    const current = stateAt(fixture.id, record, start)!;
    for (const rate of [-60, -10, -1, 0, 1, 10, 60]) {
      const end = start + rate * 1000;
      const future = stateAt(fixture.id, record, end)!;
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const time = start + (end - start) * fraction;
        const expected = stateAt(fixture.id, record, time)!;
        const actual = interpolatedPosition(current, future, start, end, time);
        const error = Math.hypot(
          ...actual.map(
            (position, axis) =>
              (position - expected.position[axis]) * EARTH_RADIUS_KM,
          ),
        );
        assert.ok(
          error < 0.01,
          `${fixture.name} at ${rate}x: ${error * 1000} m`,
        );
      }
    }
  }
});
