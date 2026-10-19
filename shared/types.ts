export interface OrbitalElements {
  id: number;
  name: string;
  line1: string;
  line2: string;
  epoch: number;
  fetchedAt: number;
  nextRefreshAt: number;
  source: 'n2yo' | 'demo';
  stale: boolean;
  warning?: string;
}

export interface ApiStatus {
  configured: boolean;
  serverTime: number;
  budget: number;
  used: number;
  reportedUsage: number | null;
  pausedUntil: number;
  refreshHours: number;
}

export interface SatelliteSelection {
  id: number;
  color: string;
  visible: boolean;
}
export interface SatelliteState {
  id: number;
  position: [number, number, number];
  velocity: [number, number, number];
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  period: number;
  inclination: number;
}
export interface OrbitPath {
  id: number;
  points: [number, number, number][];
}
export type WorkerInput =
  | { type: 'elements'; elements: OrbitalElements[]; time: number }
  | { type: 'tick'; time: number };
export type WorkerOutput =
  | { type: 'states'; time: number; states: SatelliteState[]; failed: number[] }
  | { type: 'paths'; paths: OrbitPath[] };
