import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Share, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Button, Card, Chips, Empty, ErrorText, Line, Muted, Row, Screen, Spinner, type IconName } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, methodLabel, money, titleCase, txTitle } from '../lib/format';
import type { Transaction } from '../lib/types';
import { colors } from '../theme';

const ICONS: Record<string, IconName> = { topup: 'add', exchange: 'swap-horizontal', pot_deposit: 'wallet-outline', pot_withdrawal: 'wallet-outline', bonus: 'gift-outline', adjustment: 'create-outline' };

export function TxRow({ t, onPress }: { t: Transaction; onPress: () => void }) {
  const icon: IconName = ICONS[t.type] ?? (t.direction === 'in' ? 'arrow-down' : 'arrow-up');
  const lost = t.status === 'failed' || t.status === 'reversed';
  const sign = t.direction === 'in' ? '+' : '−';
  return (
    <Row icon={icon} title={txTitle(t)} sub={dateTime(t.createdAt)} onPress={onPress}
      right={
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={{ fontWeight: '700', color: lost ? colors.faint : t.direction === 'in' ? colors.ok : colors.ink, textDecorationLine: lost ? 'line-through' : 'none' }}>{sign}{money(t.sendAmount, t.sendCurrency)}</Text>
          {t.status !== 'completed' ? <Badge value={t.status} /> : null}
        </View>
      } />
  );
}

const FILTERS = ['All', 'Sent', 'Received', 'Pending'] as const;

export function ActivityScreen({ navigation, route }: any) {
  const currency = route.params?.currency as string | undefined;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [items, setItems] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (next: number) => {
    const params = new URLSearchParams({ page: String(next), limit: '25' });
    if (q) params.set('q', q);
    if (currency) params.set('currency', currency);
    if (filter === 'Sent') params.set('direction', 'out');
    if (filter === 'Received') params.set('direction', 'in');
    if (filter === 'Pending') params.set('status', 'pending');
    try {
      const r = await api<{ items: Transaction[]; hasMore: boolean }>(`/transactions?${params}`);
      setItems((old) => (next === 1 ? r.items : [...old, ...r.items]));
      setHasMore(r.hasMore);
      setPage(next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [q, filter, currency]);

  useEffect(() => {
    const timer = setTimeout(() => void load(1), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);
  useEffect(() => navigation.addListener('focus', () => void load(1)), [navigation, load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={{ padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink }}>Activity{currency ? ` · ${currency}` : ''}</Text>
          {currency ? <Pressable accessibilityRole="button" onPress={() => navigation.setParams({ currency: undefined })}><Text style={{ color: colors.brand, fontWeight: '700' }}>All currencies</Text></Pressable> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: colors.line }}>
          <Ionicons name="search" size={18} color={colors.faint} />
          <TextInput accessibilityLabel="Search activity" style={{ flex: 1, color: colors.ink, fontSize: 15 }} placeholder="Search name, reference or note" placeholderTextColor={colors.faint} value={q} onChangeText={setQ} autoCorrect={false} />
          {q ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
        </View>
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
        <ErrorText text={error} />
      </View>
      {loading ? <Spinner /> : (
        <FlatList
          data={items} keyExtractor={(t) => t.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          renderItem={({ item }) => <TxRow t={item} onPress={() => navigation.navigate('Transaction', { id: item.id })} />}
          ListEmptyComponent={<Empty icon="receipt-outline" text={q ? 'Nothing matches your search.' : 'No activity yet.'} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(1); setRefreshing(false); }} />}
          onEndReachedThreshold={0.4} onEndReached={() => { if (hasMore) void load(page + 1); }}
          ListFooterComponent={hasMore ? <ActivityIndicator color={colors.brand} style={{ padding: 16 }} /> : undefined}
        />
      )}
    </SafeAreaView>
  );
}

const NOTES: Record<string, string> = {
  review: 'We are doing a quick safety check. Your money is held safely until it finishes.',
  pending: 'On its way. This usually takes a moment.',
};

export function TransactionScreen({ route, navigation }: any) {
  const id = route.params.id as string;
  const [t, setT] = useState<Transaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<Transaction>(`/transactions/${id}`).then(setT, (e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const live = t?.status === 'pending' || t?.status === 'review';
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [live, load]);

  if (!t) return <Screen title="Details">{error ? <ErrorText text={error} /> : <Spinner />}</Screen>;
  const out = t.direction === 'out';
  const converted = t.sendCurrency !== t.receiveCurrency;
  const share = () => Share.share({ message: [`MyMoney receipt ${t.reference}`, `${titleCase(t.status)}, ${dateTime(t.createdAt)}`, `${out ? 'To' : 'From'}: ${txTitle(t)}`, `Amount: ${money(t.receiveAmount, t.receiveCurrency)}`].join('\n') });
  return (
    <Screen title="Details" right={<Pressable accessibilityRole="button" accessibilityLabel="Share receipt" onPress={share} hitSlop={10}><Ionicons name="share-outline" size={23} color={colors.ink} /></Pressable>}>
      <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }}>
        <Muted>{txTitle(t)}</Muted>
        <Text style={{ fontSize: 32, fontWeight: '800', color: colors.ink }} adjustsFontSizeToFit numberOfLines={1}>{out ? '−' : '+'}{money(t.sendAmount, t.sendCurrency)}</Text>
        <View style={{ alignSelf: 'center' }}><Badge value={t.status} /></View>
      </View>
      {NOTES[t.status] ? <Card style={{ backgroundColor: colors.infoSoft }}><Text style={{ color: colors.info }}>{NOTES[t.status]}</Text></Card> : null}
      {t.failureReason ? <Card style={{ backgroundColor: colors.badSoft }}><Text style={{ color: colors.bad }}>{t.failureReason}</Text></Card> : null}
      <Card>
        <Line label="Reference" value={t.reference} />
        <Line label="Date" value={dateTime(t.createdAt)} />
        {t.method && t.method !== 'topup' && t.method !== 'exchange' ? <Line label="Sent via" value={methodLabel(t.method, t.provider)} /> : null}
        {t.account ? <Line label="Account" value={t.account} /> : null}
        {t.fee > 0 ? <Line label="Fee" value={money(t.fee, t.sendCurrency)} /> : null}
        {out && t.fee > 0 ? <Line label="Total paid" value={money(t.sendAmount + t.fee, t.sendCurrency)} strong /> : null}
        {converted ? <Line label="Rate" value={`1 ${t.sendCurrency} = ${t.rate.toFixed(4)} ${t.receiveCurrency}`} /> : null}
        {converted ? <Line label={t.status === 'completed' ? 'Received' : 'They receive'} value={money(t.receiveAmount, t.receiveCurrency)} strong /> : null}
        {t.category ? <Line label="Category" value={titleCase(t.category)} /> : null}
        {t.note ? <Line label="Note" value={t.note} /> : null}
      </Card>
      {t.recipientId && t.type === 'transfer' ? <Button title="Send again" icon="repeat" onPress={() => navigation.navigate('Send', { recipientId: t.recipientId })} /> : null}
    </Screen>
  );
}
