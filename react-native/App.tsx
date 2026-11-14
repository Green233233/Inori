import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  BackHandler,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {AppThemeProvider, useAppTheme} from './src/theme/AppThemeProvider';
import {JournalDataProvider, useJournalData} from './src/data/JournalDataProvider';
import {DEFAULT_SETTINGS, AppSettings, Category} from './src/data/types';
import {
  loadSettings as loadSettingsFromDisk,
  saveSettings as saveSettingsToDisk,
} from './src/data/storage';
import {MainTabs, MainTabKey} from './src/screens/MainTabs';
import {CategoryEntriesScreen} from './src/screens/CategoryEntriesScreen';
import {EditorScreen} from './src/screens/EditorScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {AboutScreen} from './src/screens/AboutScreen';
import {LicensesScreen} from './src/screens/LicensesScreen';
import {AmbientBackground} from './src/components/Surfaces';
import {APP_NAME} from './src/config';
import {setDebugEnabled} from './src/debug/logger';

type Route =
  | {name: 'category'; category: Category}
  | {name: 'editor'; entryId: string}
  | {name: 'settings'}
  | {name: 'about'}
  | {name: 'licenses'};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSettingsFromDisk()
      .then(loaded => {
        if (cancelled) {
          return;
        }
        setSettings(loaded);
        setDebugEnabled(loaded.debugMode);
        setSettingsReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setSettingsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettingsToDisk(next).catch(error =>
      console.warn('Failed to persist settings', error),
    );
  }, []);

  return (
    <SafeAreaProvider>
      <AppThemeProvider
        colorStyle={settings.colorStyle}
        themeMode={settings.themeMode}>
        <JournalDataProvider>
          <ThemedStatusBar />
          {settingsReady ? (
            <AppShell settings={settings} onSettingsChange={updateSettings} />
          ) : (
            <Splash />
          )}
        </JournalDataProvider>
      </AppThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const {isDark} = useAppTheme();
  return (
    <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
  );
}

function Splash() {
  const {colors} = useAppTheme();
  return (
    <View style={styles.splash}>
      <AmbientBackground />
      <Text style={[styles.splashBrand, {color: colors.primary}]}>
        {APP_NAME}
      </Text>
      <ActivityIndicator color={colors.primary} style={{marginTop: 18}} />
    </View>
  );
}

function AppShell({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const {colors} = useAppTheme();
  const insets = useSafeAreaInsets();
  const {refresh} = useJournalData();
  const [tab, setTab] = useState<MainTabKey>('home');
  const [stack, setStack] = useState<Route[]>([]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const push = useCallback((route: Route) => {
    setStack(previous => [...previous, route]);
  }, []);

  const pop = useCallback(() => {
    setStack(previous => previous.slice(0, -1));
    refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const current = stackRef.current;
      if (current.length === 0) {
        return false;
      }
      // The editor owns its back gesture (it must save first).
      if (current[current.length - 1].name === 'editor') {
        return false;
      }
      pop();
      return true;
    });
    return () => sub.remove();
  }, [pop]);

  const top = stack.length > 0 ? stack[stack.length - 1] : null;

  return (
    <View style={styles.root}>
      <AmbientBackground />
      <View
        style={{flex: 1, paddingTop: insets.top}}
        importantForAccessibility={
          stack.length > 0 ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={stack.length > 0}
        pointerEvents={stack.length > 0 ? 'none' : 'auto'}>
        <MainTabs
          activeTab={tab}
          onTabChange={setTab}
          onOpenEntry={id => push({name: 'editor', entryId: id})}
          onNewEntry={() => push({name: 'editor', entryId: 'new'})}
          onOpenCategory={category => push({name: 'category', category})}
          onOpenSettings={() => push({name: 'settings'})}
          onOpenAbout={() => push({name: 'about'})}
        />
      </View>

      {top ? (
        <View style={StyleSheet.absoluteFill}>
          <AmbientBackground />
          <View
            style={{
              flex: 1,
              paddingTop: top.name === 'editor' ? 0 : insets.top,
            }}>
            {top.name === 'category' ? (
              <CategoryEntriesScreen
                category={top.category}
                onBack={pop}
                onOpenEntry={id => push({name: 'editor', entryId: id})}
              />
            ) : null}
            {top.name === 'editor' ? (
              <EditorScreen
                key={top.entryId}
                entryId={top.entryId}
                settings={settings}
                onBack={pop}
              />
            ) : null}
            {top.name === 'settings' ? (
              <SettingsScreen
                settings={settings}
                onChange={onSettingsChange}
                onBack={pop}
              />
            ) : null}
            {top.name === 'about' ? (
              <AboutScreen
                onBack={pop}
                onOpenLicenses={() => push({name: 'licenses'})}
              />
            ) : null}
            {top.name === 'licenses' ? <LicensesScreen onBack={pop} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  splashBrand: {fontSize: 44, fontWeight: '700'},
});
