import {
  defaultPreferences,
  parsePreferencePatch,
  parsePreferences,
  type Preferences,
} from '../shared/preferences';

const LEGACY_KEYS = [
  'orbit-satellites',
  'orbit-earth-appearance',
  'orbit-view-controls-minimized',
] as const;
type BrowserStorage = Pick<Storage, 'getItem' | 'removeItem'>;
export function legacyPreferences(storage?: BrowserStorage): Preferences {
  const settings = defaultPreferences();
  if (!storage) return settings;
  const read = (key: string): unknown => {
    try {
      return JSON.parse(storage.getItem(key) ?? 'null');
    } catch {
      return null;
    }
  };
  const selections = read(LEGACY_KEYS[0]);
  if (Array.isArray(selections) && selections.length <= 50) {
    const ids = new Set<number>();
    settings.selections = selections.filter((value) => {
      try {
        parsePreferencePatch({ selections: [value] });
        if (ids.has(value.id)) return false;
        ids.add(value.id);
        return true;
      } catch {
        return false;
      }
    });
    settings.selected = settings.selections[0]?.id ?? null;
  }
  const appearance = read(LEGACY_KEYS[1]);
  if (appearance && typeof appearance === 'object') {
    const saved = appearance as Record<string, unknown>;
    const candidate = {
      style:
        typeof saved.style === 'string' &&
        ['imagery', 'natural', 'gray', 'countries'].includes(saved.style)
          ? saved.style
          : 'imagery',
      borders: typeof saved.borders === 'boolean' ? saved.borders : false,
      names: typeof saved.names === 'boolean' ? saved.names : false,
    };
    settings.appearance = parsePreferencePatch({
      appearance: candidate,
    }).appearance!;
  }
  settings.controlsMinimized = read(LEGACY_KEYS[2]) === true;
  return settings;
}

interface Snapshot {
  settings: Preferences | null;
  status: 'loading' | 'ready' | 'saving' | 'error';
}
/** Serializes patches so responses cannot undo changes made while a save is in flight. */
export class PreferencesClient {
  private snapshot: Snapshot = { settings: null, status: 'loading' };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private saving = false;
  private pending: Partial<Preferences> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private request: typeof fetch = (...args) => fetch(...args),
    private storage: () => BrowserStorage | undefined = () => {
      try {
        return localStorage;
      } catch {
        return undefined;
      }
    },
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: Snapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }
  private async api(method: string, path = '', body?: unknown) {
    const response = await this.request(`/api/preferences${path}`, {
      method,
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...(body === undefined
        ? {}
        : {
            headers: {
              'Content-Type': 'application/json',
              'X-Orbit-Settings': '1',
            },
            body: JSON.stringify(body),
            keepalive: true,
          }),
    });
    if (!response.ok) throw new Error('Settings service unavailable.');
    const value: unknown = await response.json();
    return value === null ? null : parsePreferences(value);
  }
  load = (): Promise<void> => {
    if (this.loading) return this.loading;
    if (this.snapshot.settings) return Promise.resolve();
    this.publish({ settings: null, status: 'loading' });
    this.loading = (async () => {
      try {
        let settings = await this.api('GET');
        if (!settings)
          settings = await this.api(
            'POST',
            '/initialize',
            legacyPreferences(this.storage()),
          );
        if (!settings) throw new Error('Missing settings.');
        // Only discard legacy values after SQLite has acknowledged the profile.
        const storage = this.storage();
        for (const key of LEGACY_KEYS) {
          try {
            storage?.removeItem(key);
          } catch {
            /* Restricted browser storage. */
          }
        }
        this.publish({ settings, status: 'ready' });
      } catch {
        this.publish({ settings: null, status: 'error' });
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  };
  set<K extends keyof Preferences>(
    key: K,
    action: Preferences[K] | ((previous: Preferences[K]) => Preferences[K]),
  ) {
    const previous = this.snapshot.settings;
    if (!previous) return;
    const value = typeof action === 'function' ? action(previous[key]) : action;
    if (Object.is(value, previous[key])) return;
    this.pending = { ...this.pending, [key]: value };
    this.publish({ settings: { ...previous, [key]: value }, status: 'saving' });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 150);
  }
  flush = async (): Promise<void> => {
    clearTimeout(this.timer);
    if (this.saving || !Object.keys(this.pending).length) return;
    this.saving = true;
    const patch = this.pending;
    this.pending = {};
    this.publish({ ...this.snapshot, status: 'saving' });
    try {
      const settings = await this.api('PATCH', '', patch);
      if (!settings) throw new Error('Missing settings.');
      this.publish({
        settings: { ...settings, ...this.pending },
        status: Object.keys(this.pending).length ? 'saving' : 'ready',
      });
    } catch {
      this.pending = { ...patch, ...this.pending };
      this.publish({ ...this.snapshot, status: 'error' });
    } finally {
      this.saving = false;
      if (this.snapshot.status !== 'error' && Object.keys(this.pending).length)
        this.schedule();
    }
  };
  retry = () => (this.snapshot.settings ? this.flush() : this.load());
}
