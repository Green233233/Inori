import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
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
import {QiProvider, useQi} from './src/features/qi/QiProvider';
import {ConsentGate} from './src/features/onboarding/ConsentGate';
import {AuthScreen} from './src/features/auth/AuthScreen';
import {PairingScreen} from './src/features/pair/PairingScreen';
import {isPartnerEntry} from './src/sync/partnerStore';
import {PermissionCenter} from './src/features/device/PermissionCenter';
import {ControlCenter} from './src/features/control/ControlCenter';
import {UsageStatsScreen} from './src/features/control/UsageStatsScreen';
import {AppLimitScreen} from './src/features/control/AppLimitScreen';
import {showToast} from './src/components/toast';
import {TrailScreen} from './src/features/control/Trail';
import {AuthorizationStatus} from './src/features/device/AuthorizationStatus';
import {PartnerLocation} from './src/features/device/PartnerLocation';
import CouponDetail from './src/features/coupons/CouponDetail';
import CouponRedeem from './src/features/coupons/CouponRedeem';
import {ResponseConfig} from './src/features/settings/ResponseConfig';
import {AutoRules} from './src/features/settings/AutoRules';
import {AppearanceScreen} from './src/features/settings/AppearanceScreen';
import {SharedSpace} from './src/features/shared/SharedSpace';
import {PairManage} from './src/features/pair/PairManage';
import {TasksScreen} from './src/features/tasks/TasksScreen';
import {RemindersScreen} from './src/features/reminders/RemindersScreen';
import {AlbumScreen} from './src/features/album/AlbumScreen';
import {NotificationsScreen} from './src/features/notifications/NotificationsScreen';
import {JournalSettingsScreen} from './src/screens/JournalSettingsScreen';
import {applyUiScale} from './src/theme/uiScale';
import type {Coupon} from './src/data/pairTypes';

type Route =
  | {name: 'category'; category: Category}
  | {name: 'editor'; entryId: string; readOnly?: boolean}
  | {name: 'permissionCenter'}
  | {name: 'controlCenter'}
  | {name: 'usageStats'}
  | {name: 'appLimit'}
  | {name: 'authorizationStatus'}
  | {name: 'partnerLocation'}
  | {name: 'couponDetail'; coupon: Coupon}
  | {name: 'couponRedeem'; coupon?: Coupon}
  | {name: 'responseConfig'}
  | {name: 'autoRules'}
  | {name: 'appearance'}
  | {name: 'sharedSpace'}
  | {name: 'pairManage'}
  | {name: 'tasks'}
  | {name: 'trail'}
  | {name: 'reminders'}
  | {name: 'album'}
  | {name: 'notifications'}
  | {name: 'journalSettings'}
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
        applyUiScale(loaded.uiScale);
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
          <QiProvider>
            <ThemedStatusBar />
            {settingsReady ? (
              <QiRoot
                key={settings.uiScale}
                settings={settings}
                onSettingsChange={updateSettings}
              />
            ) : (
              <Splash />
            )}
          </QiProvider>
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

function QiRoot({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const {stage} = useQi();
  if (stage === 'loading') {
    return <Splash />;
  }
  if (stage === 'consent') {
    return (
      <View style={styles.gate}>
        <AmbientBackground />
        <ConsentGate />
      </View>
    );
  }
  if (stage === 'auth') {
    return (
      <View style={styles.gate}>
        <AmbientBackground />
        <AuthScreen />
      </View>
    );
  }
  if (stage === 'pairing') {
    return (
      <View style={styles.gate}>
        <AmbientBackground />
        <PairingScreen />
      </View>
    );
  }
  return (
    <AppShell settings={settings} onSettingsChange={onSettingsChange} />
  );
}

function AppShell({
  settings,
  onSettingsChange,
}: {
  settings: AppSettings;
  onSettingsChange: (next: AppSettings) => void;
}) {
  const insets = useSafeAreaInsets();
  const {syncNow, lastSyncAt, sendAppLimit, state: qiState} = useQi();
  const partnerName = qiState.pair
    ? qiState.pair.myRole === 'MASTER'
      ? qiState.pair.puppyName
      : qiState.pair.ownerName
    : '对方';
  const {refresh} = useJournalData();
  const [tab, setTab] = useState<MainTabKey>('home');
  const [stack, setStack] = useState<Route[]>([]);
  const [closing, setClosing] = useState(false);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const mainProgress = useRef(new Animated.Value(0)).current;

  const push = useCallback((route: Route) => {
    setClosing(false);
    setStack(previous => [...previous, route]);
  }, []);

  const openEntry = useCallback(
    async (id: string) => {
      const partner = await isPartnerEntry(id).catch(() => false);
      // 编辑与只读统一走 WebView 编辑器；对方的日记用同一页面但只读。
      push({name: 'editor', entryId: id, readOnly: partner});
    },
    [push],
  );

  const finishPop = useCallback(() => {
    setStack(previous => previous.slice(0, -1));
    setClosing(false);
    refresh();
  }, [refresh]);

  const pop = useCallback(() => {
    setClosing(true);
  }, []);

  useEffect(() => {
    syncNow().catch(() => undefined);
  }, [syncNow]);

  useEffect(() => {
    if (lastSyncAt) {
      refresh();
    }
  }, [lastSyncAt, refresh]);

  useEffect(() => {
    Animated.timing(mainProgress, {
      toValue: stack.length > 0 ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [mainProgress, stack.length]);

  useEffect(() => {
    if (!closing) {
      return;
    }
    const timer = setTimeout(finishPop, 240);
    return () => clearTimeout(timer);
  }, [closing, finishPop]);

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
      <Animated.View
        style={{
          flex: 1,
          paddingTop: insets.top,
          opacity: mainProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [1, 0.82],
          }),
          transform: [
            {
              scale: mainProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0.985],
              }),
            },
          ],
        }}
        importantForAccessibility={
          stack.length > 0 ? 'no-hide-descendants' : 'auto'
        }
        accessibilityElementsHidden={stack.length > 0}
        pointerEvents={stack.length > 0 ? 'none' : 'auto'}>
        <MainTabs
          activeTab={tab}
          onTabChange={setTab}
          onOpenEntry={openEntry}
          onNewEntry={() => push({name: 'editor', entryId: 'new'})}
          onOpenCategory={category => push({name: 'category', category})}
          onOpenSettings={() => push({name: 'settings'})}
          onOpenAbout={() => push({name: 'about'})}
          onOpenQi={() => push({name: 'pairManage'})}
          onOpenPermissionCenter={() => push({name: 'permissionCenter'})}
          onOpenControlCenter={() => push({name: 'controlCenter'})}
          onOpenAuthorizationStatus={() => push({name: 'authorizationStatus'})}
          onOpenPartnerLocation={() => push({name: 'partnerLocation'})}
          onOpenCoupon={coupon => push({name: 'couponDetail', coupon})}
          onRedeemCoupon={coupon => push({name: 'couponRedeem', coupon})}
          onOpenResponseConfig={() => push({name: 'responseConfig'})}
          onOpenAutoRules={() => push({name: 'autoRules'})}
          onOpenAppearance={() => push({name: 'appearance'})}
          onOpenSharedSpace={() => push({name: 'sharedSpace'})}
          onOpenTasks={() => push({name: 'tasks'})}
          onOpenTrail={() => push({name: 'trail'})}
          onOpenReminders={() => push({name: 'reminders'})}
          onOpenAlbum={() => push({name: 'album'})}
          onOpenNotifications={() => push({name: 'notifications'})}
          onOpenJournalSettings={() => push({name: 'journalSettings'})}
        />
      </Animated.View>

      {top ? (
        <RouteLayer
          key={`${top.name}-${'entryId' in top ? top.entryId : ''}`}
          closing={closing}>
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
                onOpenEntry={openEntry}
                onNewEntry={() => push({name: 'editor', entryId: 'new'})}
              />
            ) : null}
            {top.name === 'editor' ? (
              <EditorScreen
                key={top.entryId}
                entryId={top.entryId}
                settings={settings}
                readOnly={top.readOnly}
                onBack={pop}
              />
            ) : null}
            {top.name === 'permissionCenter' ? (
              <PermissionCenter onBack={pop} />
            ) : null}
            {top.name === 'controlCenter' ? (
              <ControlCenter
                onBack={pop}
                onOpenUsage={() => push({name: 'usageStats'})}
                onOpenAppLimit={() => push({name: 'appLimit'})}
              />
            ) : null}
            {top.name === 'usageStats' ? <UsageStatsScreen onBack={pop} /> : null}
            {top.name === 'appLimit' ? (
              <AppLimitScreen
                onBack={pop}
                partnerName={partnerName}
                onToast={showToast}
                onSendRules={sendAppLimit}
              />
            ) : null}
            {top.name === 'authorizationStatus' ? (
              <AuthorizationStatus onBack={pop} />
            ) : null}
            {top.name === 'partnerLocation' ? (
              <PartnerLocation onBack={pop} />
            ) : null}
            {top.name === 'couponDetail' ? (
              <CouponDetail
                coupon={top.coupon}
                onBack={pop}
                onRedeem={coupon => push({name: 'couponRedeem', coupon})}
              />
            ) : null}
            {top.name === 'couponRedeem' ? (
              <CouponRedeem
                initialCoupon={top.coupon}
                onBack={pop}
                onRedeemed={() => pop()}
              />
            ) : null}
            {top.name === 'responseConfig' ? (
              <ResponseConfig onBack={pop} />
            ) : null}
            {top.name === 'autoRules' ? <AutoRules onBack={pop} /> : null}
            {top.name === 'appearance' ? <AppearanceScreen onBack={pop} /> : null}
            {top.name === 'sharedSpace' ? (
              <SharedSpace onBack={pop} />
            ) : null}
            {top.name === 'pairManage' ? (
              <PairManage onBack={pop} />
            ) : null}
            {top.name === 'trail' ? <TrailScreen onBack={pop} /> : null}
            {top.name === 'tasks' ? (
              <TasksScreen onBack={pop} />
            ) : null}
            {top.name === 'reminders' ? (
              <RemindersScreen onBack={pop} />
            ) : null}
            {top.name === 'album' ? (
              <AlbumScreen onBack={pop} />
            ) : null}
            {top.name === 'journalSettings' ? (
              <JournalSettingsScreen
                settings={settings}
                onChange={onSettingsChange}
                onBack={pop}
              />
            ) : null}
            {top.name === 'notifications' ? (
              <NotificationsScreen onBack={pop} />
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
        </RouteLayer>
      ) : null}
    </View>
  );
}

function RouteLayer({
  children,
  closing,
}: {
  children: React.ReactNode;
  closing: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [progress]);

  useEffect(() => {
    if (!closing) {
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [closing, progress]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          opacity: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [26, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  gate: {flex: 1},
  splash: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  splashBrand: {fontSize: 44, fontWeight: '700'},
});
