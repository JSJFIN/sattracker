import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  Component,
  type ReactNode,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Billboard,
  Html,
  Line,
  OrbitControls,
  useTexture,
} from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  Group,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { gstime, jday, sunPos } from 'satellite.js';
import type {
  OrbitalElements,
  SatelliteSelection,
  SimulationClock,
} from '../shared/types';
import { interpolatedPosition, simulationTime } from '../shared/clock';
import {
  earthFollowPosition,
  type CameraMode,
  type LookCommand,
} from '../shared/camera';
import type { OrbitEngine } from './useOrbitEngine';
import { EARTH_STYLES, type EarthAppearance } from './earthStyles';
import OnboardCamera from './OnboardCamera';
import DistanceMeasurement from './DistanceMeasurement';
import type { DistancePair, DistanceReading } from '../shared/distance';

export interface Layers {
  orbits: boolean;
  labels: boolean;
  trails: boolean;
  sunlight: boolean;
  grid: boolean;
}
interface Props {
  selections: SatelliteSelection[];
  elements: OrbitalElements[];
  engine: OrbitEngine;
  selected: number | null;
  onSelect: (id: number) => void;
  clock: SimulationClock;
  layers: Layers;
  appearance: EarthAppearance;
  cameraMode: CameraMode;
  look: LookCommand;
  onExitOnboard: () => void;
  reset: number;
  zoom: { sequence: number; factor: number };
  distancePair: DistancePair | null;
  showDistanceLine: boolean;
  onDistanceReading: (reading: DistanceReading | null) => void;
}

const vertex = `varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
void main() { vUv=uv; vec4 world=modelMatrix*vec4(position,1.); vPosition=world.xyz;
vNormal=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*world; }`;
const earthFragment = `uniform sampler2D dayMap; uniform sampler2D borderMap; uniform sampler2D nameMap;
uniform vec3 sunDirection; uniform float sunlight; uniform float cartographic;
uniform float borders; uniform float names;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
void main() { vec3 day=texture2D(dayMap,vUv).rgb; float light=dot(normalize(vNormal),sunDirection);
float ambient=mix(.055,.32,cartographic);
float intensity=mix(.82,ambient+(1.-ambient)*smoothstep(-.16,.85,light),sunlight);
vec3 color=day*intensity;
vec4 border=texture2D(borderMap,vUv); vec4 name=texture2D(nameMap,vUv);
color=mix(color,border.rgb,border.a*borders);
color=mix(color,name.rgb,name.a*names);
gl_FragColor=vec4(color,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
const atmosphereFragment = `uniform vec3 sunDirection; varying vec3 vNormal; varying vec3 vPosition;
void main(){vec3 viewDirection=normalize(cameraPosition-vPosition);
float rim=pow(max(0.,1.-abs(dot(normalize(vNormal),viewDirection))),4.);
float light=.3+.7*max(0.,dot(normalize(vNormal),sunDirection));
gl_FragColor=vec4(vec3(.19,.50,.85)*light,rim*.47);
#include <colorspace_fragment>
}`;

function EarthSurface({
  clock,
  layers,
  appearance,
}: Pick<Props, 'clock' | 'layers' | 'appearance'>) {
  const surface = useRef<ShaderMaterial>(null!);
  const [dayMap, borderMap, nameMap] = useTexture([
    EARTH_STYLES.find((style) => style.id === appearance.style)!.texture,
    '/textures/earth-borders.png',
    '/textures/earth-names.png',
  ]);
  for (const texture of [dayMap, borderMap, nameMap]) {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
  }
  const uniforms = useMemo(
    () => ({
      dayMap: { value: dayMap },
      borderMap: { value: borderMap },
      nameMap: { value: nameMap },
      sunDirection: { value: new Vector3(1, 0.2, 1).normalize() },
      sunlight: { value: 1 },
      cartographic: { value: 0 },
      borders: { value: 0 },
      names: { value: 0 },
    }),
    [dayMap, borderMap, nameMap],
  );
  useFrame(() => {
    const sun = sunPos(jday(new Date(simulationTime(clock))));
    surface.current.uniforms.sunDirection.value
      .set(sun.rsun[0], sun.rsun[2], -sun.rsun[1])
      .normalize();
    surface.current.uniforms.sunlight.value = layers.sunlight ? 1 : 0;
    surface.current.uniforms.cartographic.value =
      appearance.style === 'imagery' ? 0 : 1;
    surface.current.uniforms.borders.value = appearance.borders ? 1 : 0;
    surface.current.uniforms.names.value = appearance.names ? 1 : 0;
  });
  return (
    <shaderMaterial
      ref={surface}
      vertexShader={vertex}
      fragmentShader={earthFragment}
      uniforms={uniforms}
    />
  );
}

function Earth({
  clock,
  layers,
  appearance,
  earthRef,
}: Pick<Props, 'clock' | 'layers' | 'appearance'> & {
  earthRef: RefObject<Mesh>;
}) {
  const group = useRef<Group>(null!);
  const atmosphere = useRef<ShaderMaterial>(null!);
  const atmosphereUniforms = useMemo(
    () => ({ sunDirection: { value: new Vector3(1, 0, 1).normalize() } }),
    [],
  );
  useFrame(() => {
    const time = new Date(simulationTime(clock));
    group.current.rotation.y = gstime(time);
    const sun = sunPos(jday(time));
    const direction = new Vector3(
      sun.rsun[0],
      sun.rsun[2],
      -sun.rsun[1],
    ).normalize();
    atmosphere.current.uniforms.sunDirection.value.copy(direction);
  });
  return (
    <>
      <group ref={group}>
        <mesh ref={earthRef}>
          <sphereGeometry args={[1, 96, 64]} />
          <Suspense fallback={<meshBasicMaterial color="#152b3b" />}>
            <EarthSurface
              clock={clock}
              layers={layers}
              appearance={appearance}
            />
          </Suspense>
        </mesh>
        {layers.grid && (
          <mesh>
            <sphereGeometry args={[1.002, 36, 18]} />
            <meshBasicMaterial
              color="#91cfdf"
              wireframe
              transparent
              opacity={0.065}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
      <mesh>
        <sphereGeometry args={[1.035, 64, 48]} />
        <shaderMaterial
          ref={atmosphere}
          vertexShader={vertex}
          fragmentShader={atmosphereFragment}
          uniforms={atmosphereUniforms}
          transparent
          side={BackSide}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

function Starfield() {
  const positions = useMemo(() => {
    const values = new Float32Array(2000 * 3);
    let seed = 48271;
    const random = () =>
      ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 2000; i++) {
      const angle = random() * Math.PI * 2;
      const z = random() * 2 - 1;
      const radius = 60 + random() * 30;
      values[i * 3] = Math.sqrt(1 - z * z) * Math.cos(angle) * radius;
      values[i * 3 + 1] = z * radius;
      values[i * 3 + 2] = Math.sqrt(1 - z * z) * Math.sin(angle) * radius;
    }
    return values;
  }, []);
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.065}
        color="#b3c3d9"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function Satellite({
  selection,
  element,
  engine,
  clock,
  selected,
  layers,
  onSelect,
  earthRef,
  markerPositions,
  onboard,
}: {
  selection: SatelliteSelection;
  element: OrbitalElements;
  engine: OrbitEngine;
  clock: SimulationClock;
  selected: boolean;
  layers: Layers;
  onSelect: () => void;
  earthRef: RefObject<Mesh>;
  markerPositions: Map<number, Vector3>;
  onboard: boolean;
}) {
  const group = useRef<Group>(null!);
  const core = useRef<Group>(null!);
  const target = useMemo(() => new Vector3(), []);
  const labelProjection = useMemo(() => new Vector3(), []);
  const labelCameraPosition = useMemo(() => new Vector3(), []);
  const correction = useRef(new Vector3());
  const lastElements = useRef(element.line1 + element.line2);
  const ready = useRef(false);
  const lastRenderTime = useRef<number | null>(null);
  const { camera } = useThree();
  useEffect(
    () => () => {
      markerPositions.delete(selection.id);
    },
    [selection.id, markerPositions],
  );
  useFrame((_, delta) => {
    const frame = engine.frame.current;
    const state = frame.states.get(selection.id);
    group.current.visible = Boolean(state) && selection.visible;
    if (!state) return;
    const time = simulationTime(clock);
    const seeking =
      lastRenderTime.current !== null &&
      Math.abs(time - lastRenderTime.current) >
        Math.max(2000, Math.abs(clock.rate) * Math.min(delta, 0.1) * 5000);
    lastRenderTime.current = time;
    target.set(
      ...interpolatedPosition(
        state,
        frame.futureStates.get(selection.id),
        frame.time,
        frame.until,
        time,
      ),
    );
    const key = element.line1 + element.line2;
    if (seeking) correction.current.set(0, 0, 0);
    else if (key !== lastElements.current && ready.current)
      correction.current.copy(group.current.position).sub(target);
    lastElements.current = key;
    correction.current.multiplyScalar(Math.exp(-delta * 2));
    group.current.position.copy(target).add(correction.current);
    markerPositions.set(selection.id, group.current.position);
    // A minimum screen-sized marker keeps physically tiny satellites discoverable.
    const scale = Math.min(
      3,
      Math.max(0.55, camera.position.distanceTo(target) * 0.3),
    );
    core.current.scale.setScalar(scale);
    ready.current = true;
  }, -0.5);
  return (
    <group ref={group}>
      <group ref={core} visible={!onboard}>
        <mesh
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          onPointerOver={() => {
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
          }}
        >
          <sphereGeometry args={[selected ? 0.018 : 0.012, 12, 8]} />
          <meshBasicMaterial color={selection.color} />
        </mesh>
        <Billboard>
          <mesh>
            <ringGeometry
              args={[selected ? 0.031 : 0.021, selected ? 0.034 : 0.022, 40]}
            />
            <meshBasicMaterial
              color={selection.color}
              transparent
              opacity={selected ? 0.8 : 0.32}
              depthWrite={false}
            />
          </mesh>
        </Billboard>
      </group>
      {layers.labels && !onboard && (
        <Html
          position={[0, 0, 0]}
          calculatePosition={(object, camera, size) => {
            labelProjection.setFromMatrixPosition(object.matrixWorld);
            const depth = -labelCameraPosition
              .copy(labelProjection)
              .applyMatrix4(camera.matrixWorldInverse).z;
            labelProjection.project(camera);
            // Offset in screen space so camera rotation never moves the label above the marker.
            const ringRadius =
              (selected ? 0.034 : 0.022) * (core.current?.scale.x ?? 1);
            const radiusPixels =
              (ringRadius * size.height * camera.projectionMatrix.elements[5]) /
              (2 * Math.max(depth, 0.0001));
            return [
              ((labelProjection.x + 1) * size.width) / 2 + radiusPixels + 8,
              ((1 - labelProjection.y) * size.height) / 2,
            ];
          }}
          occlude={[earthRef]}
          zIndexRange={[4, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <span
            className={`sat-label ${selected ? 'selected' : ''}`}
            style={{ borderColor: selection.color, color: selection.color }}
          >
            {element.name.replace('SPACE STATION', 'ISS')}
          </span>
        </Html>
      )}
    </group>
  );
}

function EarthCameraRig({
  selected,
  cameraMode,
  clock,
  reset,
  zoom,
  markerPositions,
}: Pick<Props, 'selected' | 'cameraMode' | 'clock' | 'reset' | 'zoom'> & {
  markerPositions: Map<number, Vector3>;
}) {
  const controls = useRef<OrbitControlsImpl>(null!);
  const follow = cameraMode === 'follow';
  const previousZoom = useRef(zoom.sequence);
  const { camera } = useThree();
  useEffect(() => {
    controls.current.target.set(0, 0, 0);
    const sun = sunPos(jday(new Date(simulationTime(clock))));
    const direction = new Vector3(
      sun.rsun[0],
      sun.rsun[2],
      -sun.rsun[1],
    ).normalize();
    direction.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 3);
    direction.y += 0.45;
    camera.position.copy(direction.normalize().multiplyScalar(4.75));
    camera.lookAt(0, 0, 0);
    controls.current.update();
  }, [reset, camera]);
  useEffect(() => {
    if (previousZoom.current === zoom.sequence) return;
    previousZoom.current = zoom.sequence;
    const center = controls.current.target;
    const distance = camera.position
      .clone()
      .sub(center)
      .multiplyScalar(zoom.factor);
    if (distance.length() < 1.15) distance.setLength(1.15);
    if (distance.length() > 22) distance.setLength(22);
    camera.position.copy(center).add(distance);
    controls.current.update();
  }, [zoom, camera]);
  useFrame(() => {
    controls.current.target.set(0, 0, 0);
    const next = selected ? markerPositions.get(selected) : undefined;
    if (follow && next) {
      controls.current.minDistance = Math.max(1.15, next.length() + 0.15);
      controls.current.maxDistance = Math.max(
        22,
        controls.current.minDistance * 2,
      );
      camera.position.set(
        ...earthFollowPosition(
          next.toArray() as [number, number, number],
          camera.position.length(),
        ),
      );
    } else {
      controls.current.minDistance = 1.15;
      controls.current.maxDistance = 22;
    }
    if (camera.position.length() < 1.04) camera.position.setLength(1.04);
    controls.current.update();
  }, -0.25);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={!follow}
      dampingFactor={0.065}
      enablePan={false}
      enableRotate={!follow}
      minDistance={1.15}
      maxDistance={22}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
    />
  );
}

function OrbitalScene(props: Props) {
  const { engine, selections, elements, selected, layers } = props;
  const earthRef = useRef<Mesh>(null!);
  const markerPositions = useMemo(() => new Map<number, Vector3>(), []);
  const visible = new Set(
    selections
      .filter((selection) => selection.visible)
      .map((selection) => selection.id),
  );
  return (
    <>
      <color attach="background" args={['#080c13']} />
      <Starfield />
      <Earth
        clock={props.clock}
        layers={layers}
        appearance={props.appearance}
        earthRef={earthRef}
      />
      {engine.paths
        .filter((path) => visible.has(path.id) && path.points.length > 1)
        .map((path) => {
          const color = selections.find(
            (selection) => selection.id === path.id,
          )!.color;
          const state = engine.frame.current.states.get(path.id);
          return (
            <group key={path.id}>
              {layers.orbits &&
                !(props.cameraMode === 'onboard' && path.id === selected) && (
                  <Line
                    points={path.points}
                    color={color}
                    transparent
                    opacity={path.id === selected ? 0.65 : 0.2}
                    lineWidth={path.id === selected ? 1.25 : 0.7}
                  />
                )}
              {layers.trails &&
                state &&
                !(props.cameraMode === 'onboard' && path.id === selected) && (
                  <Line
                    points={[...path.points.slice(0, 31), state.position]}
                    color={color}
                    transparent
                    opacity={path.id === selected ? 0.9 : 0.5}
                    lineWidth={2}
                  />
                )}
            </group>
          );
        })}
      {selections
        .filter((selection) => visible.has(selection.id))
        .map((selection) => {
          const element = elements.find(
            (element) => element.id === selection.id,
          );
          return (
            element && (
              <Satellite
                key={selection.id}
                selection={selection}
                element={element}
                engine={engine}
                clock={props.clock}
                selected={selected === selection.id}
                layers={layers}
                earthRef={earthRef}
                markerPositions={markerPositions}
                onboard={
                  props.cameraMode === 'onboard' && selected === selection.id
                }
                onSelect={() => props.onSelect(selection.id)}
              />
            )
          );
        })}
      {props.distancePair && (
        <DistanceMeasurement
          pair={props.distancePair}
          showLine={props.showDistanceLine}
          engine={engine}
          clock={props.clock}
          elements={elements}
          selections={selections}
          markerPositions={markerPositions}
          onReading={props.onDistanceReading}
        />
      )}
      {props.cameraMode === 'onboard' ? (
        <OnboardCamera
          selected={selected}
          engine={engine}
          markerPositions={markerPositions}
          zoom={props.zoom}
          look={props.look}
          onExit={props.onExitOnboard}
        />
      ) : (
        <EarthCameraRig {...props} markerPositions={markerPositions} />
      )}
    </>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <div className="scene-error">
          <strong>The 3D view could not start.</strong>
          <p>
            Enable WebGL / hardware acceleration in your browser, then reload.
          </p>
        </div>
      );
    return this.props.children;
  }
}

export default function Scene(props: Props) {
  return (
    <SceneBoundary>
      <Canvas
        camera={{ position: [2.6, 1.5, 3.7], fov: 36, near: 0.005, far: 200 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false }}
      >
        <OrbitalScene {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
