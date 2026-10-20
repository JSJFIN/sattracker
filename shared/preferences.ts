import { COLORS, DEFAULT_IDS } from './catalog';
import type { SatelliteSelection } from './types';

export interface EarthAppearance {
  style: 'imagery' | 'natural' | 'gray' | 'countries';
  borders: boolean;
  names: boolean;
}
export interface GlobeLayers {
  orbits: boolean;
  labels: boolean;
  trails: boolean;
  sunlight: boolean;
  grid: boolean;
}
export interface Preferences {
  selections: SatelliteSelection[];
  selected: number | null;
  mode: 'live' | 'demo';
  controlsMinimized: boolean;
  layers: GlobeLayers;
  cameraMode: 'orbit' | 'follow' | 'onboard';
  appearance: EarthAppearance;
  historyOpen: boolean;
  measuring: boolean;
  distancePair: [number | null, number | null];
  showDistanceLine: boolean;
}
export function defaultPreferences(): Preferences {
  return {
    selections: DEFAULT_IDS.map((id, index) => ({
      id,
      color: COLORS[index % COLORS.length],
      visible: true,
    })),
    selected: DEFAULT_IDS[0] ?? null,
    mode: 'live',
    controlsMinimized: false,
    layers: {
      orbits: true,
      labels: true,
      trails: false,
      sunlight: true,
      grid: false,
    },
    cameraMode: 'orbit',
    appearance: { style: 'imagery', borders: false, names: false },
    historyOpen: false,
    measuring: false,
    distancePair: [null, null],
    showDistanceLine: true,
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown) =>
  Number.isSafeInteger(value) &&
  Number(value) >= 1 &&
  Number(value) <= 999999999;
const nullableId = (value: unknown) => value === null || id(value);
const booleanFields = (value: unknown, keys: string[]) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => typeof value[key] === 'boolean');

/** Accept only known settings; credentials and arbitrary payloads cannot be stored here. */
export function parsePreferencePatch(value: unknown): Partial<Preferences> {
  if (!object(value)) throw new Error('Invalid settings.');
  const defaults = defaultPreferences();
  for (const [key, item] of Object.entries(value)) {
    let valid = false;
    switch (key) {
      case 'selections':
        valid =
          Array.isArray(item) &&
          item.length <= 50 &&
          new Set(item.map((v) => v?.id)).size === item.length &&
          item.every(
            (v) =>
              object(v) &&
              Object.keys(v).length === 3 &&
              id(v.id) &&
              typeof v.color === 'string' &&
              /^#[0-9a-fA-F]{6}$/.test(v.color) &&
              typeof v.visible === 'boolean',
          );
        break;
      case 'selected':
        valid = nullableId(item);
        break;
      case 'distancePair':
        valid =
          Array.isArray(item) && item.length === 2 && item.every(nullableId);
        break;
      case 'mode':
        valid = item === 'live' || item === 'demo';
        break;
      case 'cameraMode':
        valid =
          typeof item === 'string' &&
          ['orbit', 'follow', 'onboard'].includes(item);
        break;
      case 'layers':
        valid = booleanFields(item, Object.keys(defaults.layers));
        break;
      case 'appearance':
        valid =
          object(item) &&
          Object.keys(item).length === 3 &&
          typeof item.style === 'string' &&
          ['imagery', 'natural', 'gray', 'countries'].includes(item.style) &&
          typeof item.borders === 'boolean' &&
          typeof item.names === 'boolean';
        break;
      default:
        valid =
          Object.hasOwn(defaults, key) &&
          typeof defaults[key as keyof Preferences] === 'boolean' &&
          typeof item === 'boolean';
    }
    if (!valid) throw new Error('Invalid settings.');
  }
  return value as Partial<Preferences>;
}
export function parsePreferences(value: unknown): Preferences {
  const patch = parsePreferencePatch(value);
  if (Object.keys(patch).length !== Object.keys(defaultPreferences()).length)
    throw new Error('Incomplete settings.');
  return normalizePreferences(patch as Preferences);
}
export function normalizePreferences(value: Preferences): Preferences {
  const ids = new Set(value.selections.map((v) => v.id));
  const selected =
    value.selected !== null && ids.has(value.selected) ? value.selected : null;
  return {
    ...value,
    selected,
    cameraMode: selected === null ? 'orbit' : value.cameraMode,
    distancePair: value.distancePair.map((v) =>
      v !== null && ids.has(v) ? v : null,
    ) as Preferences['distancePair'],
  };
}
