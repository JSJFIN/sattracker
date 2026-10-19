import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { onboardView, type LookCommand } from '../shared/camera';
import type { OrbitEngine } from './useOrbitEngine';

interface Props {
  selected: number | null;
  engine: OrbitEngine;
  markerPositions: Map<number, Vector3>;
  zoom: { sequence: number; factor: number };
  look: LookCommand;
  onExit: () => void;
}

const DEFAULT_PITCH = -Math.PI / 9;
const clampPitch = (pitch: number) =>
  Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

export default function OnboardCamera({
  selected,
  engine,
  markerPositions,
  zoom,
  look,
  onExit,
}: Props) {
  const { camera: activeCamera, gl } = useThree();
  const camera = activeCamera as PerspectiveCamera;
  const gaze = useRef({ yaw: 0, pitch: DEFAULT_PITCH });
  const aimAtHorizon = useRef(true);
  const target = useRef(new Vector3());
  const orientation = useRef(new Matrix4());
  const previousZoom = useRef(zoom.sequence);
  const previousLook = useRef(look.sequence);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    distance: number;
  } | null>(null);
  const keys = useRef(new Set<string>());

  // Keep the normal globe camera's lens and orientation intact when leaving.
  useLayoutEffect(() => {
    const saved = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      up: camera.up.clone(),
      fov: camera.fov,
      near: camera.near,
    };
    camera.fov = 70;
    camera.near = 0.00005;
    camera.updateProjectionMatrix();
    return () => {
      camera.position.copy(saved.position);
      camera.quaternion.copy(saved.quaternion);
      camera.up.copy(saved.up);
      camera.fov = saved.fov;
      camera.near = saved.near;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useEffect(() => {
    gaze.current = { yaw: 0, pitch: DEFAULT_PITCH };
    aimAtHorizon.current = true;
  }, [selected]);

  useEffect(() => {
    const canvas = gl.domElement;
    const previousTouchAction = canvas.style.touchAction;
    const previousTabIndex = canvas.getAttribute('tabindex');
    const previousLabel = canvas.getAttribute('aria-label');
    const previousCursor = canvas.style.cursor;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.tabIndex = 0;
    canvas.setAttribute(
      'aria-label',
      'Onboard satellite view. Drag or use arrow keys to look around. Scroll to zoom. Escape returns to Earth view.',
    );
    const zoomLens = (factor: number) => {
      camera.fov = Math.max(30, Math.min(100, camera.fov * factor));
      camera.updateProjectionMatrix();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drag.current) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      suppressClick = false;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        distance: 0,
      };
    };
    const move = (event: PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      current.distance += Math.hypot(dx, dy);
      aimAtHorizon.current = false;
      gaze.current.yaw = (gaze.current.yaw - dx * 0.004) % (Math.PI * 2);
      gaze.current.pitch = clampPitch(gaze.current.pitch + dy * 0.004);
      current.x = event.clientX;
      current.y = event.clientY;
    };
    const up = (event: PointerEvent) => {
      if (drag.current?.id !== event.pointerId) return;
      // Prevent a look-around drag from selecting another satellite on release.
      if (drag.current.distance > 4) suppressClick = true;
      drag.current = null;
      canvas.style.cursor = 'grab';
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    };
    let suppressClick = false;
    const click = (event: MouseEvent) => {
      if (suppressClick) {
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomLens(Math.exp(Math.max(-0.2, Math.min(0.2, event.deltaY * 0.001))));
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit();
      } else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
      ) {
        event.preventDefault();
        keys.current.add(event.key);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      keys.current.delete(event.key);
    };
    const blur = () => {
      keys.current.clear();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('click', click, true);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('keydown', keydown);
    canvas.addEventListener('keyup', keyup);
    canvas.addEventListener('blur', blur);
    return () => {
      if (drag.current && canvas.hasPointerCapture(drag.current.id))
        canvas.releasePointerCapture(drag.current.id);
      drag.current = null;
      keys.current.clear();
      canvas.style.touchAction = previousTouchAction;
      canvas.style.cursor = previousCursor;
      if (previousTabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', previousTabIndex);
      if (previousLabel === null) canvas.removeAttribute('aria-label');
      else canvas.setAttribute('aria-label', previousLabel);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('click', click, true);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('keyup', keyup);
      canvas.removeEventListener('blur', blur);
    };
  }, [camera, gl, onExit]);

  useFrame((_, delta) => {
    if (previousZoom.current !== zoom.sequence) {
      previousZoom.current = zoom.sequence;
      camera.fov = Math.max(30, Math.min(100, camera.fov * zoom.factor));
      camera.updateProjectionMatrix();
    }
    if (previousLook.current !== look.sequence) {
      previousLook.current = look.sequence;
      aimAtHorizon.current = look.direction === 'forward';
      gaze.current = {
        yaw: 0,
        pitch:
          look.direction === 'earth'
            ? -Math.PI / 2
            : look.direction === 'space'
              ? Math.PI / 2
              : DEFAULT_PITCH,
      };
    }
    const position =
      selected === null ? undefined : markerPositions.get(selected);
    const state =
      selected === null ? undefined : engine.frame.current.states.get(selected);
    if (!position || !state) return;
    if (aimAtHorizon.current) {
      // Aim at the forward limb at any altitude: low-orbit and geostationary
      // riders should both open with Earth in view. Scene Earth radius is one.
      gaze.current.pitch = -Math.acos(1 / Math.max(1, position.length()));
      aimAtHorizon.current = false;
    }
    const step = Math.min(delta, 0.1) * 0.9;
    gaze.current.yaw +=
      (Number(keys.current.has('ArrowRight')) -
        Number(keys.current.has('ArrowLeft'))) *
      step;
    gaze.current.pitch = clampPitch(
      gaze.current.pitch +
        (Number(keys.current.has('ArrowUp')) -
          Number(keys.current.has('ArrowDown'))) *
          step,
    );
    // Use exactly the rendered, interpolated satellite position so camera motion
    // stays smooth during normal, paused, accelerated and reversed playback.
    camera.position.copy(position);
    const { direction, up } = onboardView(
      position.toArray(),
      state.velocity,
      gaze.current.yaw,
      gaze.current.pitch,
    );
    // Keep camera.up unchanged: OrbitControls uses it when constructing the
    // next globe camera. Apply the local orbital up directly to orientation.
    orientation.current.lookAt(
      position,
      target.current.copy(position).add(direction),
      up,
    );
    camera.quaternion.setFromRotationMatrix(orientation.current);
    camera.updateMatrixWorld();
  }, -0.25);

  return null;
}
