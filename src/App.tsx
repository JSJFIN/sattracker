import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
} from 'react';
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  EyeOff,
  Globe2,
  Grid2X2,
  Info,
  LoaderCircle,
  Maximize2,
  Minus,
  Orbit,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Sun,
  Tag,
  Trash2,
  X,
  History,
  Telescope,
} from 'lucide-react';
import { CATALOG, COLORS, DEFAULT_IDS } from '../shared/catalog';
import { epochFromRecord, parseElements } from '../shared/orbits';
import type {
  OrbitalElements,
  SatelliteSelection,
  SimulationClock,
} from '../shared/types';
import { simulationTime } from '../shared/clock';
import type { CameraMode, LookCommand, OnboardLook } from '../shared/camera';
import demoRecords from './data/demo.json';
import Scene, { type Layers } from './Scene';
import { useOrbitEngine } from './useOrbitEngine';
import { useTracker } from './useTracker';
import { useArchive } from './useArchive';
import Timeline from './Timeline';
import {
  EARTH_STYLES,
  EARTH_PREFERENCE_KEY,
  initialEarthAppearance,
} from './earthStyles';

const DEMO_EPOCH = Date.UTC(2026, 9, 19, 0, 0, 0);
const EMPTY_ELEMENTS: OrbitalElements[] = [];
const demo: OrbitalElements[] = demoRecords.map((record) => ({
  ...record,
  epoch: epochFromRecord(parseElements(record)),
  fetchedAt: DEMO_EPOCH,
  nextRefreshAt: Number.MAX_SAFE_INTEGER,
  source: 'demo',
  stale: false,
}));
const starter = new Map<number, (typeof CATALOG)[number]>(
  CATALOG.map((item) => [item.id, item]),
);
const friendlyName = (id: number, fallback?: string) =>
  starter.get(id)?.name || fallback || `NORAD ${id}`;
const format = (value: number | undefined, digits = 0) =>
  value === undefined
    ? '—'
    : value.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const utc = (time: number) =>
  new Date(time).toLocaleString('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

function initialSelections(): SatelliteSelection[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem('orbit-satellites') || 'null',
    );
    if (Array.isArray(saved) && saved.length <= 50) {
      const ids = new Set<number>();
      return saved.filter((item): item is SatelliteSelection => {
        if (
          !item ||
          !Number.isSafeInteger(item.id) ||
          item.id < 1 ||
          item.id > 999999999 ||
          ids.has(item.id) ||
          !/^#[0-9a-fA-F]{6}$/.test(item.color) ||
          typeof item.visible !== 'boolean'
        )
          return false;
        ids.add(item.id);
        return true;
      });
    }
  } catch {
    /* A browser can disable storage; the tracker still works for this session. */
  }
  return DEFAULT_IDS.map((id, index) => ({
    id,
    color: COLORS[index % COLORS.length],
    visible: true,
  }));
}

interface SearchEntry {
  id: number;
  name: string;
}

function AddSatellite({
  existing,
  onAdd,
  onClose,
  demoMode,
}: {
  existing: SatelliteSelection[];
  onAdd: (id: number) => void;
  onClose: () => void;
  demoMode: boolean;
}) {
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<SearchEntry[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [date, setDate] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    const controller = new AbortController();
    fetch('/api/catalog', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data) => {
        setCatalog(data.satellites);
        setDate(data.updatedAt);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setCatalogError(true);
      });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusable = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, a[href]',
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      controller.abort();
      document.removeEventListener('keydown', keydown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  const results = useMemo(() => {
    const search = query.trim().toLowerCase();
    const available = demoMode ? demo : catalog;
    if (!search)
      return CATALOG.map((item) => ({ id: item.id, name: item.name }));
    const found = available.filter((item) => {
      const alias = starter.get(item.id);
      return (
        item.name.toLowerCase().includes(search) ||
        String(item.id).includes(search) ||
        alias?.name.toLowerCase().includes(search) ||
        alias?.description.toLowerCase().includes(search)
      );
    });
    return found
      .sort(
        (a, b) =>
          (String(b.id) === search ? 1 : 0) -
            (String(a.id) === search ? 1 : 0) || a.name.localeCompare(b.name),
      )
      .slice(0, 40);
  }, [query, catalog, demoMode]);
  const numeric =
    /^\d{1,9}$/.test(query.trim()) && Number(query.trim()) > 0
      ? Number(query.trim())
      : null;
  const canDirect =
    numeric && !results.some((item) => item.id === numeric) && !demoMode;
  const tracked = new Set(existing.map((item) => item.id));
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-title"
        ref={dialog}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">BUILD YOUR WATCHLIST</span>
            <h2 id="search-title">Find a satellite</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close satellite search"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <label className="search-box large">
          <Search size={18} />
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name or NORAD ID…"
            aria-label="Search satellites by name or NORAD ID"
          />
        </label>
        <div className="search-meta">
          <span>{query ? 'SEARCH RESULTS' : 'SUGGESTED SATELLITES'}</span>
          <span>{existing.length} / 50 tracked</span>
        </div>
        <div className="search-results">
          {canDirect && (
            <SearchResult
              entry={{ id: numeric, name: `NORAD ${numeric}` }}
              tracked={tracked.has(numeric)}
              full={existing.length >= 50}
              onAdd={onAdd}
            />
          )}
          {results.map((item) => (
            <SearchResult
              key={item.id}
              entry={item}
              tracked={tracked.has(item.id)}
              full={existing.length >= 50}
              onAdd={onAdd}
            />
          ))}
          {!results.length && !canDirect && (
            <p className="empty-search">
              No matching satellites.{' '}
              {demoMode
                ? 'Switch to live mode to search the full catalogue.'
                : 'Try another name, or enter a NORAD ID directly.'}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <ShieldCheck size={15} />
          <span>
            {demoMode
              ? 'Demo uses 10 bundled satellites. No API requests.'
              : catalogError
                ? 'Catalogue unavailable. You can still add a numeric NORAD ID.'
                : `${catalog.length.toLocaleString()} active satellites · Catalogue ${date || 'loading'} · Search uses no API calls`}
          </span>
        </div>
      </div>
    </div>
  );
}

function SearchResult({
  entry,
  tracked,
  full,
  onAdd,
}: {
  entry: SearchEntry;
  tracked: boolean;
  full: boolean;
  onAdd: (id: number) => void;
}) {
  return (
    <button
      className="search-result"
      disabled={tracked || full}
      onClick={() => onAdd(entry.id)}
    >
      <span className="result-icon">
        <Orbit size={20} />
      </span>
      <span className="result-text">
        <strong>{friendlyName(entry.id, entry.name)}</strong>
        <small>
          {starter.get(entry.id)?.description || entry.name}{' '}
          <span>· NORAD {entry.id}</span>
        </small>
      </span>
      <span className={tracked ? 'result-tracked' : 'result-add'}>
        {tracked ? (
          <>
            <Check size={14} /> Tracked
          </>
        ) : full ? (
          'Limit reached'
        ) : (
          <Plus size={17} />
        )}
      </span>
    </button>
  );
}

export default function App() {
  const [selections, setSelections] =
    useState<SatelliteSelection[]>(initialSelections);
  const [selected, setSelected] = useState<number | null>(
    () => initialSelections()[0]?.id ?? null,
  );
  const [mode, setMode] = useState<'live' | 'demo'>('live');
  const initializedMode = useRef(false);
  const [filter, setFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [controlsMinimized, setControlsMinimized] = useState(() => {
    try {
      return localStorage.getItem('orbit-view-controls-minimized') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        'orbit-view-controls-minimized',
        String(controlsMinimized),
      );
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [controlsMinimized]);
  const [layers, setLayers] = useState<Layers>({
    orbits: true,
    labels: true,
    trails: false,
    sunlight: true,
    grid: false,
  });
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const follow = cameraMode === 'follow';
  const onboard = cameraMode === 'onboard';
  const [look, setLook] = useState<LookCommand>({
    sequence: 0,
    direction: 'forward',
  });
  const leaveOnboard = useCallback(() => setCameraMode('orbit'), []);
  const lookOnboard = (direction: OnboardLook) =>
    setLook((previous) => ({ sequence: previous.sequence + 1, direction }));
  const [appearance, setAppearance] = useState(initialEarthAppearance);
  useEffect(() => {
    try {
      localStorage.setItem(EARTH_PREFERENCE_KEY, JSON.stringify(appearance));
    } catch {
      // Style switching still works when browser storage is unavailable.
    }
  }, [appearance]);
  const [reset, setReset] = useState(0);
  const [zoom, setZoom] = useState({ sequence: 0, factor: 1 });
  const [help, setHelp] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [demoOffset] = useState(() => DEMO_EPOCH - Date.now());
  const [replay, setReplay] = useState<SimulationClock | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const tracker = useTracker(selections, mode === 'live');
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!tracker.status) return;
    setClockOffset(tracker.status.serverTime - Date.now());
    if (!initializedMode.current) {
      initializedMode.current = true;
      if (!tracker.status.configured) setMode('demo');
    }
  }, [tracker.status]);
  useEffect(() => {
    try {
      localStorage.setItem('orbit-satellites', JSON.stringify(selections));
    } catch {
      /* Session-only if storage is blocked. */
    }
  }, [selections]);
  const clock = useMemo<SimulationClock>(
    () =>
      mode === 'live' && replay
        ? replay
        : {
            anchorTime: mode === 'demo' ? demoOffset : clockOffset,
            anchorRealTime: 0,
            rate: 1,
          },
    [mode, replay, demoOffset, clockOffset],
  );
  const renderTime = Date.now();
  const displayTime = simulationTime(clock, renderTime);
  const liveTime = renderTime + clockOffset;
  const archive = useArchive(
    selections.map((item) => item.id),
    mode === 'live' && replay !== null,
    displayTime,
  );
  const liveElements = useMemo(
    () =>
      selections.flatMap(({ id }) => {
        const record =
          mode === 'demo'
            ? demo.find((item) => item.id === id)
            : tracker.records[id];
        return record ? [record] : [];
      }),
    [selections, mode, tracker.records],
  );
  const elements =
    mode === 'live' && replay
      ? (archive.elements ?? EMPTY_ELEMENTS)
      : liveElements;
  const engine = useOrbitEngine(elements, clock);
  useEffect(() => {
    if (!replay || mode !== 'live') return;
    if (replay.rate > 0 && displayTime >= liveTime) setReplay(null);
    const start = archive.summary?.start;
    if (replay.rate < 0 && start != null && displayTime <= start) {
      setReplay({ anchorTime: start, anchorRealTime: Date.now(), rate: 0 });
    }
  }, [displayTime, liveTime, replay, mode, archive.summary?.start]);
  const seekTime = (time: number, rate = 0) => {
    if (time >= liveTime) {
      setReplay(null);
      return;
    }
    setReplay({ anchorTime: time, anchorRealTime: Date.now(), rate });
  };
  const changeRate = (rate: number) => {
    if (replay)
      setReplay({
        anchorTime: simulationTime(replay),
        anchorRealTime: Date.now(),
        rate,
      });
  };
  const selectedElement = elements.find((element) => element.id === selected);
  const selectedState = engine.states.find((state) => state.id === selected);
  const selectedSelection = selections.find(
    (selection) => selection.id === selected,
  );
  const selectedInfo = selected ? starter.get(selected) : undefined;
  const selectedError = selected ? tracker.errors[selected] : undefined;
  const epochAge = selectedElement
    ? Math.max(0, (displayTime - selectedElement.epoch) / 3600000)
    : 0;
  const oldElements =
    selectedElement &&
    (selectedElement.stale ||
      displayTime >= selectedElement.nextRefreshAt ||
      epochAge > 72);
  const filtered = selections.filter(({ id }) =>
    `${friendlyName(id, elements.find((item) => item.id === id)?.name)} ${id}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  const visibleCount = selections.filter(
    (item) =>
      item.visible && elements.some((element) => element.id === item.id),
  ).length;
  const paused = tracker.status && tracker.status.pausedUntil > now;
  const closeSearch = useMemo(() => () => setSearchOpen(false), []);
  const addSatellite = (id: number) => {
    setSelections((previous) =>
      previous.length >= 50 || previous.some((item) => item.id === id)
        ? previous
        : [
            ...previous,
            {
              id,
              color: COLORS[previous.length % COLORS.length],
              visible: true,
            },
          ],
    );
    setSelected(id);
    setCameraMode('orbit');
  };
  const removeSatellite = (id: number) => {
    setSelections((previous) => previous.filter((item) => item.id !== id));
    if (selected === id) {
      setSelected(selections.find((item) => item.id !== id)?.id ?? null);
      setCameraMode('orbit');
    }
  };
  const selectSatellite = (id: number) => {
    setSelected(id);
    setSelections((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, visible: true } : item,
      ),
    );
  };
  const toggleLayer = (key: keyof Layers) =>
    setLayers((previous) => ({ ...previous, [key]: !previous[key] }));

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Orbit satellite tracker">
          <span className="brand-symbol">
            <Orbit size={29} strokeWidth={1.5} />
          </span>
          <span>
            ORBIT<small>SATELLITE TRACKER</small>
          </span>
        </a>
        <div className="header-clock">
          <span
            className={`status-dot ${mode === 'demo' || replay ? 'amber' : ''}`}
          />
          {new Date(displayTime)
            .toLocaleDateString('en-GB', {
              timeZone: 'UTC',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
            .toUpperCase()}
          <span className="clock-divider" />
          {new Date(displayTime).toLocaleTimeString('en-GB', {
            timeZone: 'UTC',
            hour12: false,
          })}
          <span className="utc-tag">UTC</span>
        </div>
        <div className="header-right">
          <div className="mode-switch" aria-label="Data mode">
            {(['live', 'demo'] as const).map((value) => (
              <button
                key={value}
                className={
                  mode === value && !(value === 'live' && replay)
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  initializedMode.current = true;
                  setMode(value);
                  setReplay(null);
                  setCameraMode('orbit');
                }}
              >
                {value === 'live' ? <Radio size={12} /> : null}
                {value === 'live' ? 'Live' : 'Demo'}
              </button>
            ))}
          </div>
          <span className="local-label">
            <span className="status-dot" />
            LOCAL SESSION
          </span>
          <button
            className={`icon-button ${help ? 'active' : ''}`}
            onClick={() => setHelp((value) => !value)}
            aria-label="About this tracker"
            aria-expanded={help}
          >
            <Info size={18} />
          </button>
        </div>
      </header>

      {help && (
        <div className="help-panel">
          <button
            className="icon-button"
            aria-label="Close information"
            onClick={() => setHelp(false)}
          >
            <X size={16} />
          </button>
          <h3>A little closer to space.</h3>
          <p>
            Use a satellite's crosshair to look directly down at it, with Earth
            centered beneath it. History & replay reconstructs saved orbits at a
            chosen UTC time; earlier, unrecorded satellites are hidden.
          </p>
          <p>
            Positions are predicted locally from orbital elements. Drag to
            rotate, scroll to zoom, and select a satellite to inspect or follow
            it. Go onboard to ride at the satellite’s position. Drag or use the
            arrow keys to look around; Earth, Space and Look ahead set your
            gaze. This simulated view follows the orbit, not the spacecraft’s
            actual attitude.
          </p>
          <p>
            Orbital distances use Earth’s scale; satellite markers are enlarged.
            TLE data cannot tell us a spacecraft’s actual attitude.
          </p>
          <p>
            Earth imagery: NASA Earth Observatory. Map styles, borders and
            country names: Natural Earth (public domain). Name catalogue and
            demo snapshot: CelesTrak, 19 Oct 2026. Live orbital elements: N2YO.
          </p>
          <a href="https://www.n2yo.com/api/" target="_blank" rel="noreferrer">
            N2YO API reference <ArrowUpRight size={12} />
          </a>
        </div>
      )}

      <main className="workspace">
        <aside className="watchlist panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">YOUR CONSTELLATION</span>
              <h1>
                Tracked satellites <span>{selections.length}</span>
              </h1>
            </div>
          </div>
          <button
            className="add-button"
            onClick={() => setSearchOpen(true)}
            disabled={selections.length >= 50}
          >
            <Plus size={17} /> Add satellite<span>50 max</span>
          </button>
          <label className="search-box">
            <Search size={15} />
            <input
              aria-label="Filter tracked satellites"
              placeholder="Filter name or NORAD ID"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            {filter && (
              <button
                className="clear-filter"
                aria-label="Clear filter"
                onClick={() => setFilter('')}
              >
                <X size={13} />
              </button>
            )}
          </label>
          <div className="list-heading">
            <span>SATELLITE</span>
            <span>ACTIONS</span>
          </div>
          <div className="satellite-list">
            {filtered.map((selection) => {
              const element = elements.find((item) => item.id === selection.id);
              const state = engine.states.find(
                (item) => item.id === selection.id,
              );
              const failed =
                mode === 'live' && !replay && tracker.errors[selection.id];
              const loading =
                mode === 'live' && !replay && tracker.loading.has(selection.id);
              const unavailableDemo = mode === 'demo' && !element;
              return (
                <div
                  key={selection.id}
                  className={`satellite-row ${selected === selection.id ? 'selected' : ''} ${selection.visible ? '' : 'hidden'}`}
                  style={{ '--sat-color': selection.color } as CSSProperties}
                >
                  <button
                    className="satellite-select"
                    onClick={() => selectSatellite(selection.id)}
                  >
                    <span className="satellite-dot" />
                    <span className="satellite-name">
                      <strong>
                        {friendlyName(selection.id, element?.name)}
                      </strong>
                      <small>
                        {loading ? (
                          <>
                            <LoaderCircle size={10} className="spin" /> Fetching
                            elements
                          </>
                        ) : failed ? (
                          'Data unavailable'
                        ) : unavailableDemo ? (
                          'Available in live mode'
                        ) : (
                          `#${selection.id} · ${state ? `${format(state.altitude)} km` : replay && archive.missingIds.includes(selection.id) ? 'Not yet recorded' : 'Awaiting elements'}`
                        )}
                      </small>
                    </span>
                  </button>
                  <button
                    className={`row-follow ${follow && selected === selection.id ? 'active' : ''}`}
                    aria-label={`Center & follow ${friendlyName(selection.id, element?.name)}`}
                    title="Center & follow satellite"
                    aria-pressed={follow && selected === selection.id}
                    onClick={() => {
                      selectSatellite(selection.id);
                      setCameraMode('follow');
                    }}
                  >
                    <Crosshair size={15} />
                  </button>
                  <button
                    className="row-visibility"
                    aria-label={`${selection.visible ? 'Hide' : 'Show'} ${friendlyName(selection.id, element?.name)}`}
                    aria-pressed={selection.visible}
                    onClick={() => {
                      setSelections((previous) =>
                        previous.map((item) =>
                          item.id === selection.id
                            ? { ...item, visible: !item.visible }
                            : item,
                        ),
                      );
                      if (selection.id === selected) setCameraMode('orbit');
                    }}
                  >
                    {selection.visible ? (
                      <Eye size={15} />
                    ) : (
                      <EyeOff size={15} />
                    )}
                  </button>
                  <button
                    className="row-delete"
                    aria-label={`Remove ${friendlyName(selection.id, element?.name)}`}
                    onClick={() => removeSatellite(selection.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
            {!filtered.length && (
              <div className="empty-list">
                <Orbit size={27} />
                <p>
                  {selections.length
                    ? 'No satellites match your filter.'
                    : 'Your constellation starts here.'}
                </p>
                {!selections.length && (
                  <button onClick={() => setSearchOpen(true)}>
                    Find a satellite <ChevronRight size={13} />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="api-card">
            <div className="api-heading">
              <span>
                <ShieldCheck size={14} /> API budget
              </span>
              <strong>
                {tracker.status?.used ?? 0}
                <small> / {tracker.status?.budget ?? 800}</small>
              </strong>
            </div>
            <div className="budget-track">
              <span
                style={{
                  width: `${Math.min(100, ((tracker.status?.used ?? 0) / (tracker.status?.budget ?? 800)) * 100)}%`,
                }}
              />
            </div>
            <p>
              {paused
                ? 'Requests paused · cached orbits continue'
                : 'Requests in the last hour · shared across tabs'}
            </p>
            <div className="cache-note">
              <span
                className={`status-dot ${mode === 'demo' ? 'amber' : tracker.status?.configured ? '' : 'muted'}`}
              />
              {mode === 'demo'
                ? 'Demo · no N2YO requests'
                : tracker.status?.configured
                  ? `N2YO connected · ${tracker.status.refreshHours}h cache`
                  : 'Waiting for N2YO API key'}
            </div>
          </div>
        </aside>

        <section
          className="globe-area"
          aria-label="Interactive 3D satellite globe"
        >
          <Scene
            selections={selections}
            elements={elements}
            engine={engine}
            selected={selected}
            onSelect={selectSatellite}
            clock={clock}
            layers={layers}
            appearance={appearance}
            cameraMode={cameraMode}
            look={look}
            onExitOnboard={leaveOnboard}
            reset={reset}
            zoom={zoom}
          />
          <div className="scene-heading">
            <span className="eyebrow">
              {onboard ? 'ONBOARD VIEW' : 'ORBITAL VIEW'}
            </span>
            <h2>
              {onboard && selectedSelection
                ? `Aboard ${friendlyName(selectedSelection.id, selectedElement?.name)}`
                : 'Earth & its companions'}
              <span>.</span>
            </h2>
            <p>
              {visibleCount} satellites visible <span>·</span>{' '}
              {mode === 'live'
                ? replay
                  ? 'History replay · saved orbital elements'
                  : 'Real-time prediction'
                : 'Recorded orbital snapshot'}
            </p>
          </div>
          <section
            className={`view-controls ${controlsMinimized ? 'minimized' : ''}`}
            aria-label="Globe controls"
          >
            <h2 className="view-controls-heading">
              <button
                aria-label={
                  controlsMinimized
                    ? 'Expand view controls'
                    : 'Minimize view controls'
                }
                aria-expanded={!controlsMinimized}
                aria-controls="view-controls-content"
                onClick={() => setControlsMinimized((previous) => !previous)}
              >
                View controls
                {controlsMinimized ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </button>
            </h2>
            <div
              id="view-controls-content"
              className="view-controls-body"
              hidden={controlsMinimized}
            >
              {selectedSelection && (
                <div className="satellite-camera-modes">
                  <button
                    className={`follow-button ${follow ? 'following' : ''}`}
                    disabled={!selectedState || !selectedSelection.visible}
                    aria-pressed={follow}
                    onClick={() => setCameraMode(follow ? 'orbit' : 'follow')}
                  >
                    <Crosshair size={16} />
                    {follow
                      ? 'Stop following'
                      : `Follow ${friendlyName(selectedSelection.id, selectedElement?.name)}`}
                    <ChevronRight size={14} />
                  </button>
                  <button
                    className={`follow-button onboard-button ${onboard ? 'following' : ''}`}
                    disabled={
                      !onboard &&
                      (!selectedState ||
                        !selectedElement ||
                        !selectedSelection.visible)
                    }
                    aria-pressed={onboard}
                    onClick={() => setCameraMode(onboard ? 'orbit' : 'onboard')}
                  >
                    <Telescope size={16} />
                    {onboard ? 'Return to Earth view' : 'Go onboard'}
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
              {onboard && (
                <div className="onboard-controls">
                  <p role="status">
                    <Telescope size={13} /> Onboard{' '}
                    {selected
                      ? friendlyName(selected, selectedElement?.name)
                      : ''}
                  </p>
                  {(!selectedState || !selectedElement) && (
                    <p>Waiting for orbital data…</p>
                  )}
                  <div aria-label="Onboard look direction">
                    <button onClick={() => lookOnboard('forward')}>
                      Look ahead
                    </button>
                    <button onClick={() => lookOnboard('earth')}>Earth</button>
                    <button onClick={() => lookOnboard('space')}>Space</button>
                  </div>
                  <small>
                    Drag to look around. Scroll to change field of view.
                  </small>
                  <small>Simulated orbital viewpoint.</small>
                </div>
              )}
              {(tracker.serverError ||
                (mode === 'live' &&
                  tracker.status &&
                  !tracker.status.configured)) && (
                <div className="connection-notice">
                  <Info size={17} />
                  <span>
                    {tracker.serverError ||
                      'Add your N2YO_API_KEY to .env. It will be picked up automatically.'}
                  </span>
                  <button
                    onClick={() => {
                      initializedMode.current = true;
                      setMode('demo');
                    }}
                  >
                    View demo
                  </button>
                </div>
              )}
              {mode === 'demo' && (
                <div className="demo-notice">
                  <span className="status-dot amber" />
                  DEMO SNAPSHOT · 19 OCT 2026{' '}
                  <span>Not current satellite positions</span>
                </div>
              )}
              {mode === 'live' && replay && (
                <div className="replay-notice" role="status">
                  <History size={13} />
                  <span>
                    {archive.error ||
                      (archive.loading
                        ? 'Loading saved orbital elements…'
                        : archive.missingIds.length
                          ? `${archive.missingIds.length} selected satellite(s) not yet recorded at this time`
                          : `History replay · ${replay.rate === 0 ? 'paused' : `${replay.rate}× playback`}`)}
                  </span>
                  <button onClick={() => setReplay(null)}>
                    Return to live
                  </button>
                </div>
              )}
              <div className="camera-tools">
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() =>
                    setZoom((previous) => ({
                      sequence: previous.sequence + 1,
                      factor: 0.8,
                    }))
                  }
                >
                  <Plus size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() =>
                    setZoom((previous) => ({
                      sequence: previous.sequence + 1,
                      factor: 1.25,
                    }))
                  }
                >
                  <Minus size={18} />
                </button>
                <span />
                <button
                  className="icon-button"
                  aria-label="Reset camera"
                  title="Reset view"
                  onClick={() => {
                    setCameraMode('orbit');
                    setReset((value) => value + 1);
                  }}
                >
                  <Maximize2 size={17} />
                </button>
              </div>
              <fieldset className="earth-appearance">
                <legend>Earth style</legend>
                <div className="earth-style-options">
                  {EARTH_STYLES.map((style) => (
                    <button
                      key={style.id}
                      className={appearance.style === style.id ? 'active' : ''}
                      aria-pressed={appearance.style === style.id}
                      onClick={() =>
                        setAppearance((previous) => ({
                          ...previous,
                          style: style.id,
                        }))
                      }
                    >
                      <span
                        className={`earth-swatch earth-swatch-${style.id}`}
                      />
                      {style.name}
                    </button>
                  ))}
                </div>
                <div className="earth-map-overlays">
                  <label>
                    <input
                      type="checkbox"
                      checked={appearance.borders}
                      onChange={(event) =>
                        setAppearance((previous) => ({
                          ...previous,
                          borders: event.target.checked,
                        }))
                      }
                    />
                    Country borders
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={appearance.names}
                      onChange={(event) =>
                        setAppearance((previous) => ({
                          ...previous,
                          names: event.target.checked,
                        }))
                      }
                    />
                    Country names
                  </label>
                </div>
              </fieldset>
              {follow && selectedState && (
                <div className="follow-badge">
                  <Crosshair size={13} />
                  Following{' '}
                  {selected
                    ? friendlyName(selected, selectedElement?.name)
                    : ''}
                  <button
                    onClick={() => setCameraMode('orbit')}
                    aria-label="Stop following"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="scene-bottom">
                {mode === 'live' && (
                  <>
                    <button
                      className={`history-toggle ${historyOpen || replay ? 'active' : ''}`}
                      onClick={() => setHistoryOpen((value) => !value)}
                      aria-expanded={historyOpen}
                      aria-controls="history-playback"
                    >
                      <History size={14} />
                      History & replay
                    </button>
                    {historyOpen && (
                      <Timeline
                        summary={archive.summary}
                        error={archive.summaryError}
                        time={displayTime}
                        liveTime={liveTime}
                        replay={replay}
                        onSeek={seekTime}
                        onRate={changeRate}
                        onLive={() => setReplay(null)}
                      />
                    )}
                  </>
                )}
                <div className="view-caption">
                  <span className="earth-dot" />
                  EARTH TO SCALE<span className="caption-divider">/</span>
                  MARKERS ENLARGED
                </div>
                <div className="layer-toolbar" aria-label="Globe layers">
                  {(
                    [
                      { key: 'orbits', label: 'Orbits', icon: Orbit },
                      { key: 'labels', label: 'Labels', icon: Tag },
                      { key: 'trails', label: 'Trails', icon: Activity },
                      { key: 'sunlight', label: 'Sunlight', icon: Sun },
                      { key: 'grid', label: 'Grid', icon: Grid2X2 },
                    ] as const
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      className={layers[key] ? 'active' : ''}
                      aria-pressed={layers[key]}
                      onClick={() => toggleLayer(key)}
                    >
                      <Icon size={15} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <p className="gesture-hint">
                  {onboard ? (
                    <>
                      Drag / arrow keys to look <span>·</span> Esc to exit
                    </>
                  ) : follow ? (
                    <>
                      View locked above satellite <span>·</span> Scroll to zoom
                    </>
                  ) : (
                    <>
                      Drag to orbit <span>·</span> Scroll to zoom <span>·</span>{' '}
                      Click to explore
                    </>
                  )}
                </p>
              </div>
            </div>
          </section>
        </section>

        <aside className="details panel">
          <div className="detail-heading">
            <span className="eyebrow">SATELLITE INSIGHT</span>
            <span className="detail-cross">
              <Crosshair size={15} />
            </span>
          </div>
          {selectedSelection ? (
            <>
              <div
                className="satellite-emblem"
                style={
                  { '--sat-color': selectedSelection.color } as CSSProperties
                }
              >
                <div className="emblem-orbit" />
                <Orbit size={43} strokeWidth={1} />
                <span className="emblem-star" />
              </div>
              <div className="detail-title">
                <span className="category-pill">
                  {selectedInfo?.category || 'SATELLITE'}
                </span>
                <h2>
                  {friendlyName(selectedSelection.id, selectedElement?.name)}
                </h2>
                <p>
                  {selectedInfo?.description ||
                    selectedElement?.name ||
                    'Earth-orbiting satellite'}
                </p>
                <span className="norad-tag">NORAD {selectedSelection.id}</span>
              </div>

              {selectedError && mode === 'live' && !replay && (
                <div className="data-warning">
                  {selectedError}
                  <button onClick={() => void tracker.sync()}>Retry</button>
                </div>
              )}
              {replay && archive.missingIds.includes(selectedSelection.id) && (
                <div className="data-warning">
                  This satellite had not been recorded at the selected time.
                  Choose a later time or return to live.
                </div>
              )}
              {engine.failed.includes(selectedSelection.id) && (
                <div className="data-warning">
                  The orbit cannot be calculated from these elements. The
                  satellite may have decayed.
                </div>
              )}
              <div className="telemetry-heading">
                <span className="eyebrow">ORBITAL TELEMETRY</span>
                <span
                  className={`status-dot ${selectedState ? '' : 'muted'}`}
                />
              </div>
              <div className="telemetry-grid">
                <div>
                  <span>Altitude</span>
                  <strong>
                    {format(selectedState?.altitude)}
                    <small>km</small>
                  </strong>
                </div>
                <div>
                  <span>Velocity</span>
                  <strong>
                    {format(selectedState?.speed, 2)}
                    <small>km/s</small>
                  </strong>
                </div>
                <div>
                  <span>Inclination</span>
                  <strong>
                    {format(selectedState?.inclination, 2)}
                    <small>°</small>
                  </strong>
                </div>
                <div>
                  <span>Orbit period</span>
                  <strong>
                    {format(selectedState?.period, 1)}
                    <small>min</small>
                  </strong>
                </div>
              </div>
              <div className="position-heading">
                <Globe2 size={14} />
                <span>SUBSATELLITE POSITION</span>
              </div>
              <div className="coordinates">
                <div>
                  <span>Latitude</span>
                  <strong>
                    {selectedState
                      ? `${format(Math.abs(selectedState.latitude), 3)}° ${selectedState.latitude >= 0 ? 'N' : 'S'}`
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>Longitude</span>
                  <strong>
                    {selectedState
                      ? `${format(Math.abs(selectedState.longitude), 3)}° ${selectedState.longitude >= 0 ? 'E' : 'W'}`
                      : '—'}
                  </strong>
                </div>
              </div>
              <div className="data-source">
                <div>
                  <span className="eyebrow">ORBITAL ELEMENTS</span>
                  <span className={`source-tag ${oldElements ? 'warn' : ''}`}>
                    {mode === 'demo'
                      ? 'SNAPSHOT'
                      : replay
                        ? 'HISTORY'
                        : oldElements
                          ? 'STALE'
                          : selectedElement
                            ? 'CACHED'
                            : 'PENDING'}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Epoch (UTC)</dt>
                    <dd>
                      {selectedElement
                        ? utc(selectedElement.epoch)
                        : 'Awaiting data'}
                    </dd>
                  </div>
                  <div>
                    <dt>Element age</dt>
                    <dd>
                      {selectedElement ? `${format(epochAge, 1)} hours` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {mode === 'demo'
                        ? 'CelesTrak snapshot'
                        : replay
                          ? 'Saved N2YO · SGP4'
                          : 'N2YO · SGP4 prediction'}
                    </dd>
                  </div>
                </dl>
                {oldElements && (
                  <p className="old-warning">
                    {selectedElement.warning ||
                      (epochAge > 72
                        ? 'These elements are over 72 hours old. Prediction accuracy may be reduced.'
                        : 'A scheduled refresh was not available at this time. Positions use the last saved orbital elements.')}
                  </p>
                )}
              </div>
              <a
                className="external-link"
                href={`https://www.n2yo.com/satellite/?s=${selectedSelection.id}`}
                target="_blank"
                rel="noreferrer"
              >
                View on N2YO <ArrowUpRight size={14} />
              </a>
              <button
                className="remove-detail"
                onClick={() => removeSatellite(selectedSelection.id)}
              >
                <Trash2 size={13} /> Remove from watchlist
              </button>
            </>
          ) : (
            <div className="empty-details">
              <Orbit size={40} />
              <h2>Space to explore.</h2>
              <p>
                Select a satellite to see its orbit and current predicted
                position.
              </p>
            </div>
          )}
        </aside>
      </main>
      <footer className="app-footer">
        <span>
          <span className="status-dot" />
          LOCAL ORBIT PROPAGATION <span className="footer-divider">/</span> SGP4
        </span>
        <span className="footer-credit">
          {appearance.style === 'imagery'
            ? `EARTH · NASA${appearance.borders || appearance.names ? ' / NATURAL EARTH' : ' EARTH OBSERVATORY'}`
            : 'MAPS · NATURAL EARTH'}
        </span>
        <span>
          <Globe2 size={12} />
          {elements.length} / {selections.length} ORBITS LOADED
        </span>
      </footer>
      {searchOpen && (
        <AddSatellite
          existing={selections}
          onAdd={addSatellite}
          onClose={closeSearch}
          demoMode={mode === 'demo'}
        />
      )}
    </div>
  );
}
