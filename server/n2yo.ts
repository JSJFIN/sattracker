import { twoline2satrec } from 'satellite.js';
import { epochFromRecord, stateAt } from '../shared/orbits';
import type { ApiStatus, OrbitalElements } from '../shared/types';
import { Store } from './store';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number = 503,
  ) {
    super(message);
  }
}

function catalogId(field: string): number {
  const prefix = field[0];
  if (/\d/.test(prefix)) return Number(field);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return (alphabet.indexOf(prefix) + 10) * 10000 + Number(field.slice(1));
}

export function validateTle(
  id: number,
  tle: unknown,
): { line1: string; line2: string; epoch: number } {
  if (typeof tle !== 'string')
    throw new ApiError('N2YO returned no orbital elements.', 502);
  const lines = tle.trim().split(/\r?\n/);
  if (
    lines.length !== 2 ||
    !lines[0].startsWith('1 ') ||
    !lines[1].startsWith('2 ')
  ) {
    throw new ApiError('N2YO returned invalid orbital elements.', 502);
  }
  for (const line of lines) {
    const checksum =
      [...line.slice(0, 68)].reduce(
        (sum, character) =>
          sum +
          (/\d/.test(character)
            ? Number(character)
            : character === '-'
              ? 1
              : 0),
        0,
      ) % 10;
    if (
      line.length < 69 ||
      checksum !== Number(line[68]) ||
      catalogId(line.slice(2, 7)) !== id
    ) {
      throw new ApiError(
        'Orbital element checksum or satellite ID did not match.',
        502,
      );
    }
  }
  const record = twoline2satrec(lines[0], lines[1]);
  const epoch = epochFromRecord(record);
  if (!Number.isFinite(epoch) || !stateAt(id, record, epoch))
    throw new ApiError('These orbital elements cannot be propagated.', 502);
  return { line1: lines[0], line2: lines[1], epoch };
}

interface Options {
  key: () => string;
  budget: number;
  refreshHours: number;
  fetch?: typeof fetch;
  now?: () => number;
  spacingMs?: number;
}

export class N2yoService {
  private inFlight = new Map<number, Promise<OrbitalElements>>();
  private failures = new Map<number, { until: number; error: ApiError }>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequestAt = 0;
  private now: () => number;
  constructor(
    readonly store: Store,
    readonly options: Options,
  ) {
    this.now = options.now ?? Date.now;
  }

  status(): ApiStatus {
    const time = this.now();
    return {
      configured: Boolean(this.options.key()),
      serverTime: time,
      budget: this.options.budget,
      used: this.store.used(time),
      reportedUsage:
        this.store.readNumber('reportedAt') > time - 3600000
          ? this.store.readNumber('reportedUsage')
          : null,
      pausedUntil: this.store.readNumber('pausedUntil'),
      refreshHours: this.options.refreshHours,
    };
  }

  async get(id: number): Promise<OrbitalElements> {
    const cached = this.store.get(id);
    const now = this.now();
    if (cached && cached.nextRefreshAt > now)
      return { ...cached, stale: false };
    try {
      const pending = this.inFlight.get(id);
      if (pending) return await pending;
      const failure = this.failures.get(id);
      if (failure && failure.until > now) throw failure.error;
      const operation = this.queue.then(() => this.request(id));
      this.queue = operation.catch(() => undefined);
      this.inFlight.set(id, operation);
      try {
        return await operation;
      } finally {
        this.inFlight.delete(id);
      }
    } catch (error) {
      const safeError =
        error instanceof ApiError
          ? error
          : new ApiError('N2YO is unavailable. Please try again shortly.');
      if (this.options.key())
        this.failures.set(id, {
          until: this.now() + (safeError.status === 404 ? 600000 : 60000),
          error: safeError,
        });
      if (cached) return { ...cached, stale: true, warning: safeError.message };
      throw safeError;
    }
  }

  private async request(id: number): Promise<OrbitalElements> {
    const key = this.options.key();
    if (!key)
      throw new ApiError('Add N2YO_API_KEY to .env to enable live tracking.');
    const delay = this.nextRequestAt - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const now = this.now();
    if (!this.store.reserve(now, this.options.budget)) {
      throw new ApiError(
        'Hourly API budget reached. Cached satellites will keep moving.',
        429,
      );
    }
    this.nextRequestAt = Date.now() + (this.options.spacingMs ?? 1100);
    // The URL contains the secret: never log it or forward upstream errors to the client.
    const url = `https://api.n2yo.com/rest/v1/satellite/tle/${id}&apiKey=${encodeURIComponent(key)}`;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch {
      throw new ApiError(
        'Could not reach N2YO. Cached satellites will keep moving.',
      );
    }
    if (response.status === 429) {
      this.store.setNumber('pausedUntil', now + 3600000);
      throw new ApiError(
        'N2YO rate limit reached. Requests paused for one hour.',
        429,
      );
    }
    if (response.status === 401 || response.status === 403) {
      this.store.setNumber('pausedUntil', now + 60000);
      throw new ApiError(
        'N2YO rejected the API key. Check N2YO_API_KEY in .env. Requests paused for one minute.',
        502,
      );
    }
    if (response.status === 404)
      throw new ApiError('Satellite not found in N2YO.', 404);
    if (!response.ok)
      throw new ApiError('N2YO is temporarily unavailable.', 502);
    let data: {
      info?: { satid?: number; satname?: string; transactionscount?: number };
      tle?: string;
      error?: unknown;
    };
    try {
      data = await response.json();
    } catch {
      throw new ApiError('N2YO returned an unreadable response.', 502);
    }
    const usage = data.info?.transactionscount;
    if (typeof usage === 'number' && Number.isFinite(usage) && usage >= 0) {
      this.store.setNumber('reportedUsage', usage);
      this.store.setNumber('reportedAt', this.now());
      if (usage >= this.options.budget)
        this.store.setNumber('pausedUntil', this.now() + 3600000);
    }
    if (data.error || !data.tle) {
      // N2YO sometimes returns API failures as HTTP 200. Pause globally rather than retrying every satellite.
      const rateLimited = /limit|maximum|exceeded|too many|quota/i.test(
        String(data.error || ''),
      );
      this.store.setNumber(
        'pausedUntil',
        this.now() + (rateLimited ? 3600000 : 60000),
      );
      throw new ApiError(
        'N2YO could not supply this satellite. Check the ID and API key.',
        502,
      );
    }
    if (data.info?.satid !== id)
      throw new ApiError('N2YO returned a different satellite.', 502);
    const elements = validateTle(id, data.tle);
    const fetchedAt = this.now();
    const satellite: OrbitalElements = {
      id,
      name: String(data.info.satname || `NORAD ${id}`).slice(0, 120),
      ...elements,
      fetchedAt,
      nextRefreshAt: fetchedAt + this.options.refreshHours * 3600000,
      source: 'n2yo',
      stale: false,
    };
    this.store.put(satellite);
    return satellite;
  }
}
