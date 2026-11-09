import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Empty, Muted, Row, SectionTitle, type IconName } from '../components/ui';
import { money } from '../lib/format';
import { useApp } from '../store/app';
import { colors } from '../theme';
import { TxRow } from './activity';

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={23} color={colors.forest} /></View>
      <Text style={{ color: colors.white, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function HomeScreen({ navigation }: any) {
  const { user, summary, recent, incoming, unread, refresh, online } = useApp();
  const [refreshing, setRefreshing] = useState(false);
  useFocusEffect(useCallback(() => {
    void refresh().catch(() => {});
    const stack = navigation.getParent();
    // The offline banner is light, so the status bar needs dark text above it.
    stack?.setOptions({ statusBarStyle: online ? 'light' : 'dark' });
    return () => stack?.setOptions({ statusBarStyle: 'dark' });
  }, [refresh, navigation, online]));
  const pull = async () => { setRefreshing(true); await refresh().catch(() => {}); setRefreshing(false); };
  const go = (screen: string, params?: object) => () => navigation.navigate(screen, params);
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} />}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.forest, paddingHorizontal: 20, paddingBottom: 26, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Text style={{ color: colors.white, fontSize: 17, fontWeight: '700' }}>Hi, {user?.firstName ?? 'there'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Notifications, ${unread} unread`} onPress={go('Notifications')} hitSlop={10}>
              <Ionicons name="notifications-outline" size={24} color={colors.white} />
              {unread > 0 && <View style={{ position: 'absolute', top: -5, right: -6, backgroundColor: colors.mint, borderRadius: 9, minWidth: 18, alignItems: 'center', paddingHorizontal: 4 }}><Text style={{ fontSize: 11, fontWeight: '800', color: colors.forest }}>{unread > 99 ? '99+' : unread}</Text></View>}
            </Pressable>
          </View>
          <Text style={{ color: '#BFD2CC', marginTop: 20 }}>Total balance</Text>
          <Text style={{ color: colors.white, fontSize: 36, fontWeight: '800', letterSpacing: -1 }} adjustsFontSizeToFit numberOfLines={1}>{money(summary.totalInDefault, summary.defaultCurrency)}</Text>
          {summary.held.map((h) => <Text key={h.currency} style={{ color: '#BFD2CC', fontSize: 13 }}>{money(h.amount, h.currency)} on its way</Text>)}
          <View style={{ flexDirection: 'row', marginTop: 22 }}>
            <Action icon="add" label="Add money" onPress={go('AddMoney')} />
            <Action icon="arrow-up" label="Send" onPress={go('Send')} />
            <Action icon="arrow-down" label="Request" onPress={go('Requests')} />
            <Action icon="swap-horizontal" label="Exchange" onPress={go('Exchange')} />
          </View>
        </SafeAreaView>

        <View style={{ padding: 16, gap: 12 }}>
          {user?.kycStatus === 'none' && (
            <Pressable accessibilityRole="button" onPress={go('Verify')}><Card style={{ backgroundColor: colors.warnSoft, flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="shield-checkmark-outline" size={22} color={colors.warn} /><Text style={{ flex: 1, color: colors.warn, fontWeight: '600' }}>Verify your identity to raise your limits</Text><Ionicons name="chevron-forward" size={18} color={colors.warn} /></Card></Pressable>
          )}
          {incoming.length > 0 && (
            <Pressable accessibilityRole="button" onPress={go('Requests')}><Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Ionicons name="mail-unread-outline" size={22} color={colors.brand} /><View style={{ flex: 1 }}><Text style={{ fontWeight: '700', color: colors.ink }}>{incoming[0].otherName} asked for {money(incoming[0].amount, incoming[0].currency)}</Text>{incoming.length > 1 && <Muted>and {incoming.length - 1} more</Muted>}</View><Ionicons name="chevron-forward" size={18} color={colors.faint} /></Card></Pressable>
          )}

          <SectionTitle>Wallets</SectionTitle>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {summary.wallets.map((w) => (
              <Pressable key={w.id} accessibilityRole="button" onPress={go('Activity', { currency: w.currency })}><Card style={{ width: 150 }}><Muted>{w.currency}</Muted><Text style={{ fontWeight: '800', fontSize: 18, color: colors.ink }} numberOfLines={1} adjustsFontSizeToFit>{(w.balance / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text></Card></Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={go('Rates')}><Card style={{ width: 110, height: 78, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="trending-up" size={20} color={colors.brand} /><Muted>Rates</Muted></Card></Pressable>
          </ScrollView>

          <SectionTitle>Do more</SectionTitle>
          <Card style={{ gap: 0 }}>
            <Row icon="people-outline" title="Recipients" sub="People and accounts you pay" onPress={go('Recipients')} right={<Ionicons name="chevron-forward" size={18} color={colors.faint} />} />
            <Row icon="repeat-outline" title="Scheduled payments" sub="Weekly or monthly, automatically" onPress={go('Schedules')} right={<Ionicons name="chevron-forward" size={18} color={colors.faint} />} />
            <Row icon="pie-chart-outline" title="Insights" sub="Where your money went" onPress={go('Insights')} right={<Ionicons name="chevron-forward" size={18} color={colors.faint} />} />
          </Card>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><SectionTitle>Recent activity</SectionTitle><Pressable accessibilityRole="button" onPress={go('Activity')}><Text style={{ color: colors.brand, fontWeight: '700' }}>See all</Text></Pressable></View>
          <Card style={{ gap: 0 }}>
            {recent.length === 0 ? <Empty icon="receipt-outline" text="Add money to get started." /> : recent.slice(0, 5).map((t) => <TxRow key={t.id} t={t} onPress={go('Transaction', { id: t.id })} />)}
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
