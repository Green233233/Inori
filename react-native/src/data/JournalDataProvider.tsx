import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {EntrySummary} from './types';
import {computeStats, loadIndex, Stats} from './storage';
import {migrateLegacyEntries} from './migration';

interface JournalDataValue {
  entries: EntrySummary[];
  favorites: EntrySummary[];
  stats: Stats;
  loading: boolean;
  refresh: () => Promise<void>;
}

const JournalDataContext = createContext<JournalDataValue | null>(null);

export function JournalDataProvider({children}: {children: React.ReactNode}) {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await loadIndex();
      setEntries(list);
    } catch (error) {
      console.warn('Failed to load journal index', error);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await migrateLegacyEntries();
      } catch (error) {
        console.warn('Legacy migration skipped', error);
      }
      await refresh();
    })();
  }, [refresh]);

  const value = useMemo<JournalDataValue>(() => {
    const favorites = entries.filter(item => item.isFavorite);
    return {
      entries,
      favorites,
      stats: computeStats(entries),
      loading,
      refresh,
    };
  }, [entries, loading, refresh]);

  return (
    <JournalDataContext.Provider value={value}>
      {children}
    </JournalDataContext.Provider>
  );
}

export function useJournalData(): JournalDataValue {
  const ctx = useContext(JournalDataContext);
  if (!ctx) {
    throw new Error('useJournalData must be used inside JournalDataProvider');
  }
  return ctx;
}
