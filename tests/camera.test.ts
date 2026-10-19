import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { earthFollowPosition } from '../shared/camera';
import { parseElements, stateAt } from '../shared/orbits';
import fixtures from '../src/data/demo.json';

test('follow keeps both Earth and the satellite centered over a full orbit, including replay jumps', () => {
  const camera = new PerspectiveCamera(36, 1.4, 0.005, 200);
  const time = Date.UTC(2026, 9, 19);
  for (const fixture of fixtures) {
    const record = parseElements(fixture);
    for (const minutes of [0, 15, 45, 90, -30]) {
      const state = stateAt(fixture.id, record, time + minutes * 60000)!;
      for (const distance of [1.15, 4.75, 12]) {
        camera.position.set(...earthFollowPosition(state.position, distance));
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const earthScreen = new Vector3().project(camera);
        const satelliteScreen = new Vector3(...state.position).project(camera);
        assert.ok(
          Math.abs(earthScreen.x) < 1e-9 && Math.abs(earthScreen.y) < 1e-9,
        );
        assert.ok(
          Math.abs(satelliteScreen.x) < 1e-9 &&
            Math.abs(satelliteScreen.y) < 1e-9,
        );
        assert.ok(
          camera.position.length() >= Math.hypot(...state.position) + 0.149999,
        );
        assert.ok(satelliteScreen.z > -1 && satelliteScreen.z < 1);
      }
    }
  }
});
