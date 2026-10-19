import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { create } from '@react-three/test-renderer';
import { PerspectiveCamera, Vector3 } from 'three';
import OnboardCamera from '../src/OnboardCamera';
import type { OrbitEngine } from '../src/useOrbitEngine';
import type { LookCommand } from '../shared/camera';
import { parseElements, stateAt } from '../shared/orbits';
import fixtures from '../src/data/demo.json';

// Exercise the real camera component in Fiber's Node test renderer, without a
// browser, WebGL context, network access, or the satellite worker.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test('onboard camera rides the satellite, accepts look/zoom input, and cleans up when returning to Earth', async () => {
  const fixture = fixtures[0];
  const state = stateAt(
    fixture.id,
    parseElements(fixture),
    Date.UTC(2026, 9, 19),
  )!;
  const positions = new Map([[fixture.id, new Vector3(...state.position)]]);
  const engine: OrbitEngine = {
    frame: {
      current: {
        time: 0,
        until: 0,
        states: new Map([[fixture.id, state]]),
        futureStates: new Map(),
      },
    },
    states: [state],
    paths: [],
    failed: [],
  };
  const camera = new PerspectiveCamera(36, 1.4, 0.005, 200);
  camera.position.set(2.6, 1.5, 3.7);
  camera.lookAt(0, 0, 0);
  const savedPosition = camera.position.clone();
  const savedOrientation = camera.quaternion.clone();
  const events = new EventTarget();
  const attributes = new Map([['aria-label', 'Globe']]);
  const captured = new Set<number>();
  let exits = 0;
  let canvas!: HTMLCanvasElement;
  const props = {
    selected: fixture.id,
    engine,
    markerPositions: positions,
    zoom: { sequence: 0, factor: 1 },
    look: { sequence: 0, direction: 'forward' } as LookCommand,
    onExit: () => {
      exits++;
    },
  };
  const renderer = await create(createElement(OnboardCamera, props), {
    camera,
    beforeReturn: (element) => {
      canvas = element;
      Object.assign(element, {
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) =>
          attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
        focus: () => {},
        setPointerCapture: (id: number) => captured.add(id),
        hasPointerCapture: (id: number) => captured.has(id),
        releasePointerCapture: (id: number) => captured.delete(id),
      });
      element.style.touchAction = 'pan-y';
    },
  });
  const emit = (type: string, values: Record<string, unknown> = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), values);
    events.dispatchEvent(event);
    return event;
  };
  try {
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(camera.position.equals(positions.get(fixture.id)!));
    assert.equal(camera.fov, 70);
    const openingRay = camera.getWorldDirection(new Vector3());
    assert.ok(openingRay.dot(camera.position) < 0);
    assert.ok(
      Math.abs(camera.position.clone().cross(openingRay).length() - 1) < 1e-9,
      'opening gaze aims at the forward Earth horizon',
    );
    assert.equal(canvas.style.touchAction, 'none');
    assert.ok(
      camera.up.equals(new Vector3(0, 1, 0)),
      'orbital gaze must not change the globe controls up vector',
    );

    const beforeLook = camera.quaternion.clone();
    emit('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    emit('pointermove', { pointerId: 1, clientX: 200, clientY: 130 });
    emit('pointerup', { pointerId: 1 });
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(Math.abs(beforeLook.dot(camera.quaternion)) < 0.999);
    assert.ok(
      camera.position.equals(positions.get(fixture.id)!),
      'looking around must not move the eye away from the satellite',
    );
    assert.equal(captured.size, 0);

    assert.equal(emit('wheel', { deltaY: -100 }).defaultPrevented, true);
    assert.ok(camera.fov < 70);
    props.zoom = { sequence: 1, factor: 0.8 };
    props.look = { sequence: 1, direction: 'earth' };
    await renderer.update(createElement(OnboardCamera, props));
    await renderer.advanceFrames(1, 1 / 60);
    const direction = camera.getWorldDirection(new Vector3());
    assert.ok(direction.dot(camera.position.clone().normalize()) < -0.999999);
    assert.ok(camera.fov >= 30 && camera.fov < 60);

    // Worker interpolation can advance or seek in either direction; the camera
    // consumes the marker's current rendered position, including while paused.
    const moved = stateAt(
      fixture.id,
      parseElements(fixture),
      Date.UTC(2026, 9, 19, 0, 20),
    )!;
    positions.get(fixture.id)!.set(...moved.position);
    engine.frame.current.states.set(fixture.id, moved);
    await renderer.advanceFrames(1, 1 / 60);
    assert.ok(camera.position.equals(positions.get(fixture.id)!));
    const earthDirection = camera.getWorldDirection(new Vector3());
    assert.ok(
      earthDirection.dot(camera.position.clone().normalize()) < -0.999999,
    );

    emit('keydown', { key: 'ArrowUp' });
    await renderer.advanceFrames(1, 0.1);
    emit('keyup', { key: 'ArrowUp' });
    assert.ok(
      camera.getWorldDirection(new Vector3()).dot(earthDirection) < 0.999,
    );
    emit('keydown', { key: 'Escape' });
    assert.equal(exits, 1);
  } finally {
    await renderer.unmount();
  }
  assert.ok(camera.position.equals(savedPosition));
  assert.ok(Math.abs(camera.quaternion.dot(savedOrientation)) > 0.999999);
  assert.equal(camera.fov, 36);
  assert.equal(camera.near, 0.005);
  assert.equal(canvas.style.touchAction, 'pan-y');
  assert.equal(attributes.get('aria-label'), 'Globe');
  assert.equal(attributes.has('tabindex'), false);
  assert.equal(emit('wheel', { deltaY: -100 }).defaultPrevented, false);
  emit('keydown', { key: 'Escape' });
  assert.equal(exits, 1, 'onboard listeners are removed on exit');
});
