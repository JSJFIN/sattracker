import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Preferences } from '../shared/preferences';
import { PreferencesClient } from './preferencesClient';

// One client also avoids duplicate initialization under React StrictMode.
export const preferencesClient = new PreferencesClient();
export function usePreferences() {
  const snapshot = useSyncExternalStore(
    preferencesClient.subscribe,
    preferencesClient.getSnapshot,
  );
  useEffect(() => {
    void preferencesClient.load();
    const flush = () => {
      void preferencesClient.flush();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  return snapshot;
}
export function usePreferenceState<K extends keyof Preferences>(
  key: K,
): [Preferences[K], Dispatch<SetStateAction<Preferences[K]>>] {
  const set = useCallback(
    (action: SetStateAction<Preferences[K]>) =>
      preferencesClient.set(key, action),
    [key],
  );
  return [preferencesClient.getSnapshot().settings![key], set];
}
