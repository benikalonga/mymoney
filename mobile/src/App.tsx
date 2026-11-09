import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfflineBar, Toast } from './components/ui';
import { RootNavigator } from './navigation';
import { LockScreen } from './screens/auth';
import { useApp } from './store/app';
import { colors } from './theme';

const LOCK_AFTER_MS = 5 * 60_000;
const REFRESH_MS = 30_000;

export default function App() {
  const { ready, signedIn, boot, refresh } = useApp();
  const [locked, setLocked] = useState(false);
  const leftAt = useRef<number | null>(null);

  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    if (!signedIn) { setLocked(false); return; }
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh().catch(() => {}); }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (leftAt.current && Date.now() - leftAt.current > LOCK_AFTER_MS) setLocked(true);
        leftAt.current = null;
        void refresh().catch(() => {});
      } else if (leftAt.current === null) {
        leftAt.current = Date.now();
      }
    });
    return () => { clearInterval(timer); sub.remove(); };
  }, [signedIn, refresh]);

  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.forest }}><ActivityIndicator color={colors.mint} /></View>;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <OfflineBar />
      {locked && signedIn ? <LockScreen onUnlock={() => setLocked(false)} /> : <NavigationContainer><RootNavigator /></NavigationContainer>}
      <Toast />
    </SafeAreaProvider>
  );
}
