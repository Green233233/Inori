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
import {partnerSummaries} from '../sync/partnerStore';

interface JournalDataValue {
  entries: EntrySummary[];
  ownEntries: EntrySummary[];
  partnerEntries: EntrySummary[];
  favorites: EntrySummary[];
  stats: Stats;
  loading: boolean;
  refresh: () => Promise<void>;
}

const JournalDataContext = createContext<JournalDataValue | null>(null);

export function JournalDataProvider({children}: {children: React.ReactNode}) {
  const [ownEntries, setOwnEntries] = useState<EntrySummary[]>([]);
  const [partnerEntries, setPartnerEntries] = useState<EntrySummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await loadIndex();
      setOwnEntries(list);
    } catch (error) {
      console.warn('Failed to load journal index', error);
      setOwnEntries([]);
    }
    try {
      setPartnerEntries(await partnerSummaries());
    } catch {
      setPartnerEntries([]);
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
    const entries = [...ownEntries, ...partnerEntries].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const favorites = ownEntries.filter(item => item.isFavorite);
    return {
      entries,
      ownEntries,
      partnerEntries,
      favorites,
      stats: computeStats(ownEntries),
      loading,
      refresh,
    };
  }, [ownEntries, partnerEntries, loading, refresh]);

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
