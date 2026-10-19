import { useEffect, useRef, useState } from 'react';
import type { HistoryFrame, HistorySummary } from '../shared/types';

export function useArchive(ids: number[], replay: boolean, time: number) {
  const key = [...ids].sort((a, b) => a - b).join(',');
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [cache, setCache] = useState<{
    key: string;
    savedAt: number;
    frame: HistoryFrame;
  } | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const nextTry = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (!key) {
      setSummary({ start: null, end: Date.now(), satellites: [] });
      return;
    }
    const refresh = async () => {
      try {
        const response = await fetch(`/api/history?ids=${key}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data: HistorySummary = await response.json();
        if (!controller.signal.aborted) {
          setSummary(data);
          setSummaryError('');
        }
      } catch {
        if (!controller.signal.aborted)
          setSummaryError(
            'Saved history is unavailable. Check the local data service.',
          );
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key]);

  const valid = Boolean(
    cache &&
    cache.key === key &&
    time >= cache.frame.validFrom &&
    (cache.frame.validUntil === null || time < cache.frame.validUntil),
  );
  useEffect(() => {
    if (
      !replay ||
      !key ||
      (valid && cache && Date.now() - cache.savedAt < 15000) ||
      pending.current ||
      Date.now() < nextTry.current
    )
      return;
    pending.current = true;
    const requestTime = Math.floor(time);
    void (async () => {
      try {
        const response = await fetch(
          `/api/history/elements?ids=${key}&at=${requestTime}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!response.ok) throw new Error();
        const frame: HistoryFrame = await response.json();
        if (mounted.current) {
          setCache({ key, savedAt: Date.now(), frame });
          setError('');
        }
      } catch {
        nextTry.current = Date.now() + 5000;
        if (mounted.current)
          setError(
            'Could not load saved orbital elements. Check the local data service.',
          );
      } finally {
        pending.current = false;
        if (mounted.current) setRevision((value) => value + 1);
      }
    })();
  }, [replay, key, time, valid, cache, revision, summary]);

  return {
    summary,
    summaryError,
    error,
    elements: valid && cache ? cache.frame.elements : null,
    missingIds: valid && cache ? cache.frame.missingIds : [],
    loading: replay && Boolean(key) && !valid && !error,
  };
}
