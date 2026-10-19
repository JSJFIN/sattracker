import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiStatus,
  OrbitalElements,
  SatelliteSelection,
} from '../shared/types';

export function useTracker(selections: SatelliteSelection[], enabled: boolean) {
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [serverError, setServerError] = useState('');
  const [records, setRecords] = useState<Record<number, OrbitalElements>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const recordRef = useRef(records);
  const pending = useRef(new Set<number>());
  const mounted = useRef(true);
  const updateStatus = useCallback(async () => {
    const sentAt = Date.now();
    try {
      const response = await fetch('/api/status', {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      const next: ApiStatus = await response.json();
      // Normalize server time to when the response was received; local rendering uses this clock.
      next.serverTime += (Date.now() - sentAt) / 2;
      if (mounted.current) {
        setStatus(next);
        setServerError('');
      }
    } catch {
      if (mounted.current)
        setServerError(
          'Local data service is unavailable. Check that npm run dev is running.',
        );
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void updateStatus();
    const timer = setInterval(() => void updateStatus(), 15000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [updateStatus]);

  const sync = useCallback(async () => {
    if (!enabled || !status?.configured) return;
    await Promise.all(
      selections.map(async ({ id }) => {
        const cached = recordRef.current[id];
        if (
          pending.current.has(id) ||
          (cached && !cached.stale && cached.nextRefreshAt > Date.now())
        )
          return;
        pending.current.add(id);
        setLoading((previous) => new Set(previous).add(id));
        try {
          // The server serializes upstream requests. Allow enough time for all 50 selected satellites.
          const response = await fetch(`/api/satellites/${id}`, {
            signal: AbortSignal.timeout(120000),
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error || 'Could not load this satellite.');
          const record = body as OrbitalElements;
          recordRef.current = { ...recordRef.current, [id]: record };
          if (mounted.current) {
            setRecords(recordRef.current);
            setErrors((previous) => {
              const next = { ...previous };
              delete next[id];
              return next;
            });
          }
        } catch (error) {
          if (mounted.current)
            setErrors((previous) => ({
              ...previous,
              [id]:
                error instanceof Error
                  ? error.message
                  : 'Could not load satellite.',
            }));
        } finally {
          pending.current.delete(id);
          if (mounted.current)
            setLoading((previous) => {
              const next = new Set(previous);
              next.delete(id);
              return next;
            });
        }
      }),
    );
    await updateStatus();
  }, [enabled, selections, status?.configured, updateStatus]);

  useEffect(() => {
    void sync();
    const timer = setInterval(() => void sync(), 60000);
    return () => clearInterval(timer);
  }, [sync]);

  return { status, serverError, records, errors, loading, sync, updateStatus };
}
