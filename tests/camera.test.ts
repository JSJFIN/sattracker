import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { earthFollowPosition, onboardView } from '../shared/camera';
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

test('onboard Earth view points at the globe center from the satellite throughout full orbits and replay seeks', () => {
  const camera = new PerspectiveCamera(70, 1.4, 0.00005, 200);
  const time = Date.UTC(2026, 9, 19);
  for (const fixture of fixtures) {
    const record = parseElements(fixture);
    const initial = stateAt(fixture.id, record, time)!;
    for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1, -0.25]) {
      const state = stateAt(
        fixture.id,
        record,
        time + fraction * initial.period * 60000,
      )!;
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const { direction, up } = onboardView(
          state.position,
          state.velocity,
          yaw,
          -Math.PI / 2,
        );
        camera.position.set(...state.position);
        camera.up.copy(up);
        camera.lookAt(camera.position.clone().add(direction));
        camera.updateMatrixWorld();
        const earthScreen = new Vector3().project(camera);
        assert.ok(
          Math.abs(earthScreen.x) < 1e-9 && Math.abs(earthScreen.y) < 1e-9,
        );
        assert.ok(earthScreen.z > -1 && earthScreen.z < 1);
        assert.ok(Math.abs(direction.dot(up)) < 1e-12);
        assert.ok(Math.abs(up.length() - 1) < 1e-12);
        const space = onboardView(
          state.position,
          state.velocity,
          yaw,
          Math.PI / 2,
        );
        assert.ok(
          space.direction.dot(camera.position.clone().normalize()) > 1 - 1e-12,
        );
      }
    }
  }
});

test('onboard look remains stable across both poles and all gaze directions, without north-up roll flips', () => {
  for (const [yaw, pitch] of [
    [0, 0],
    [0, -Math.PI / 9],
    [Math.PI / 2, 0.8],
    [-Math.PI, -1],
    [2.5, Math.PI / 2],
    [-2.5, -Math.PI / 2],
  ]) {
    let previous: ReturnType<typeof onboardView> | undefined;
    for (let step = 0; step <= 720; step++) {
      const angle = (step * Math.PI) / 360;
      const position: [number, number, number] = [
        Math.cos(angle) * 1.1,
        Math.sin(angle) * 1.1,
        0,
      ];
      const velocity: [number, number, number] = [
        -Math.sin(angle) * 0.001,
        Math.cos(angle) * 0.001,
        0,
      ];
      const view = onboardView(position, velocity, yaw, pitch);
      assert.ok(Math.abs(view.direction.length() - 1) < 1e-12);
      assert.ok(Math.abs(view.up.length() - 1) < 1e-12);
      assert.ok(Math.abs(view.direction.dot(view.up)) < 1e-12);
      assert.ok(
        Math.abs(
          view.direction.dot(new Vector3(...position).normalize()) -
            Math.sin(pitch),
        ) < 1e-12,
      );
      if (previous) {
        assert.ok(previous.direction.dot(view.direction) > 0.9999);
        assert.ok(previous.up.dot(view.up) > 0.9999);
      }
      previous = view;
    }
  }
});

test('onboard orientation has a finite, orthogonal fallback for degenerate state vectors', () => {
  for (const [position, velocity] of [
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
    ],
    [
      [1, 0, 0],
      [0, 0, 0],
    ],
  ] as [number[], number[]][]) {
    const view = onboardView(
      position as [number, number, number],
      velocity as [number, number, number],
      0,
      0,
    );
    assert.ok(Math.abs(view.direction.length() - 1) < 1e-12);
    assert.ok(Math.abs(view.up.length() - 1) < 1e-12);
    assert.ok(Math.abs(view.direction.dot(view.up)) < 1e-12);
  }
});
