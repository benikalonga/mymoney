import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, Chips, Empty, ErrorText, Field, Line, Muted, PinSheet, Row, Screen, SectionTitle, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { money, shortDate, titleCase, toMinor } from '../lib/format';
import type { Notification, Pot, Quote, Recipient, Schedule } from '../lib/types';
import { useApp } from '../store/app';
import { colors } from '../theme';

export function AddMoneyScreen({ navigation }: any) {
  const { summary, meta, refresh } = useApp();
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [provider, setProvider] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(randomUUID());
  const minor = toMinor(amount);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api('/topups', 'POST', { currency, amount: minor, provider, idempotencyKey: key.current });
      void refresh().catch(() => {});
      navigation.replace('Transaction', { id: t.id });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Screen title="Add money" footer={<Button title="Add money" busy={busy} disabled={!minor || !provider} onPress={submit} />}>
      <ErrorText text={error} />
      <SectionTitle>Currency</SectionTitle>
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={currency} onChange={(c) => { setCurrency(c); key.current = randomUUID(); }} />
      <Field label={`Amount in ${currency}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={(t) => { setAmount(t); key.current = randomUUID(); }} />
      <SectionTitle>Pay with</SectionTitle>
      <Chips options={meta?.providers.topup ?? []} value={provider} onChange={setProvider} />
    </Screen>
  );
}

export function ExchangeScreen({ navigation }: any) {
  const { summary, meta, refresh, showToast } = useApp();
  const codes = meta?.currencies.map((c) => c.code) ?? [];
  const [from, setFrom] = useState(summary.wallets.some((w) => w.currency === summary.defaultCurrency) ? summary.defaultCurrency : summary.wallets[0]?.currency ?? summary.defaultCurrency);
  const [to, setTo] = useState(codes.find((c) => c !== from) ?? 'USD');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const key = useRef(randomUUID());
  const minor = toMinor(amount);
  const getQuote = () => api<Quote>('/quotes', 'POST', { method: 'exchange', sendCurrency: from, receiveCurrency: to, sendAmount: minor }).then(setQuote);
  useEffect(() => {
    setQuote(null);
    setError(null);
    key.current = randomUUID();
    if (!minor || from === to) return;
    const timer = setTimeout(() => { getQuote().catch((e: Error) => setError(e.message)); }, 400);
    return () => clearTimeout(timer);
  }, [from, to, minor]);
  const wallet = summary.wallets.find((w) => w.currency === from);
  const short = !!quote && (wallet?.balance ?? 0) < quote.total;
  const confirm = async (pin: string) => {
    try {
      await api('/exchange', 'POST', { quoteId: quote!.id, pin, idempotencyKey: key.current });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'QUOTE_EXPIRED') {
        setPinOpen(false);
        await getQuote().catch(() => {});
        setError('The rate was updated. Please check it and confirm again.');
        return;
      }
      throw e;
    }
    setPinOpen(false);
    await refresh().catch(() => {});
    showToast('Exchanged');
    navigation.goBack();
  };
  return (
    <Screen title="Exchange" footer={<Button title="Exchange" disabled={!quote || short} onPress={() => setPinOpen(true)} />}>
      <ErrorText text={error} />
      <SectionTitle>From</SectionTitle>
      <Chips options={summary.wallets.map((w) => w.currency)} value={from} onChange={setFrom} label={(c) => money(summary.wallets.find((w) => w.currency === c)!.balance, c)} />
      <SectionTitle>To</SectionTitle>
      <Chips options={codes.filter((c) => c !== from)} value={to} onChange={setTo} />
      <Field label={`Amount in ${from}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      {quote ? (
        <Card>
          <Line label="You receive" value={money(quote.receiveAmount, quote.receiveCurrency)} strong />
          <Line label="Rate" value={`1 ${from} = ${quote.rate.toFixed(4)} ${to}`} />
          <Line label="Fee" value={money(quote.fee, from)} />
          <Line label="Total to pay" value={money(quote.total, from)} strong />
          {short ? <Text style={{ color: colors.bad }}>You do not have enough {from}.</Text> : null}
        </Card>
      ) : null}
      <PinSheet visible={pinOpen} title="Confirm exchange" onClose={() => setPinOpen(false)} onSubmit={confirm} />
    </Screen>
  );
}

export function GoalsScreen({ navigation }: any) {
  const [pots, setPots] = useState<Pot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => api<Pot[]>('/pots').then((p) => { setPots(p); setError(null); }, (e: Error) => setError(e.message));
  useEffect(() => navigation.addListener('focus', () => void load()), [navigation]);
  return (
    <Screen onRefresh={load} footer={<Button title="New goal" icon="add" onPress={() => navigation.navigate('NewGoal')} />}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink }}>Savings goals</Text>
      <Muted>Set money aside so you do not spend it by accident.</Muted>
      <ErrorText text={error} />
      {!pots ? <Spinner /> : pots.length === 0 ? <Empty icon="flag-outline" text="Create a goal for something you are saving toward." /> : pots.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" onPress={() => navigation.navigate('Goal', { pot: p })}>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ fontWeight: '700', fontSize: 16, color: colors.ink, flex: 1 }}>{p.name}</Text><Text style={{ fontWeight: '700', color: colors.brand }}>{Math.round(p.progress * 100)}%</Text></View>
            <View style={{ height: 8, backgroundColor: colors.brandSoft, borderRadius: 4, overflow: 'hidden' }}><View style={{ height: 8, width: `${p.progress * 100}%`, backgroundColor: colors.brand }} /></View>
            <Muted>{money(p.balance, p.currency)} of {money(p.target, p.currency)}{p.targetDate ? ` · by ${shortDate(p.targetDate)}` : ''}</Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

export function NewGoalScreen({ navigation }: any) {
  const { summary, meta } = useApp();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState('');
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = toMinor(target);
  const dateBad = !!date && !/^\d{4}-\d{2}-\d{2}$/.test(date);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/pots', 'POST', { name, target: minor, currency, targetDate: date || undefined });
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Screen title="New goal" footer={<Button title="Create goal" busy={busy} disabled={!name || !minor || dateBad} onPress={save} />}>
      <ErrorText text={error} />
      <Field label="Name" placeholder="School fees" maxLength={40} value={name} onChangeText={setName} />
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={currency} onChange={setCurrency} />
      <Field label={`Target in ${currency}`} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
      <Field label="Target date (optional, YYYY-MM-DD)" keyboardType="numbers-and-punctuation" value={date} onChangeText={setDate} error={dateBad ? 'Use the format YYYY-MM-DD' : null} />
    </Screen>
  );
}

export function GoalScreen({ route, navigation }: any) {
  const { refresh, showToast } = useApp();
  const [pot, setPot] = useState<Pot>(route.params.pot);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = toMinor(amount);
  const move = async (action: 'deposit' | 'withdraw') => {
    setBusy(true);
    setError(null);
    try {
      setPot(await api<Pot>(`/pots/${pot.id}/${action}`, 'POST', { amount: minor, idempotencyKey: randomUUID() }));
      setAmount('');
      void refresh().catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const close = () => Alert.alert('Close this goal?', `${money(pot.balance, pot.currency)} will go back to your wallet.`, [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Close goal', style: 'destructive', onPress: async () => {
      try {
        await api(`/pots/${pot.id}`, 'DELETE');
        void refresh().catch(() => {});
        showToast('Goal closed');
        navigation.goBack();
      } catch (e) { setError((e as Error).message); }
    } },
  ]);
  return (
    <Screen title={pot.name}>
      <ErrorText text={error} />
      <Card style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 30, fontWeight: '800', color: colors.ink }}>{money(pot.balance, pot.currency)}</Text>
        <Muted>{Math.round(pot.progress * 100)}% of {money(pot.target, pot.currency)}</Muted>
      </Card>
      <Field label={`Amount in ${pot.currency}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <Button title="Add to goal" busy={busy} disabled={!minor} onPress={() => void move('deposit')} />
      <Button title="Take out" kind="secondary" disabled={!minor || busy} onPress={() => void move('withdraw')} />
      <Button title="Close goal" kind="danger" onPress={close} />
    </Screen>
  );
}

export function SchedulesScreen({ navigation }: any) {
  const { showToast } = useApp();
  const [items, setItems] = useState<Schedule[] | null>(null);
  const load = () => api<Schedule[]>('/schedules').then(setItems, (e: Error) => { setItems([]); showToast(e.message, 'bad'); });
  useEffect(() => navigation.addListener('focus', () => void load()), [navigation]);
  const update = async (s: Schedule) => { await api(`/schedules/${s.id}`, 'PATCH', { status: s.status === 'active' ? 'paused' : 'active' }).catch((e: Error) => showToast(e.message, 'bad')); await load(); };
  const remove = (s: Schedule) => Alert.alert('Delete this scheduled payment?', undefined, [{ text: 'Keep', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { await api(`/schedules/${s.id}`, 'DELETE').catch((e: Error) => showToast(e.message, 'bad')); await load(); } }]);
  return (
    <Screen title="Scheduled payments" onRefresh={load} footer={<Button title="New scheduled payment" icon="add" onPress={() => navigation.navigate('NewSchedule')} />}>
      {!items ? <Spinner /> : items.length === 0 ? <Empty icon="repeat-outline" text="Pay rent, school fees or family automatically." /> : items.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ fontWeight: '700', fontSize: 16, flex: 1, color: colors.ink }}>{s.recipientName}</Text><Badge value={s.status} /></View>
          <Text style={{ color: colors.ink }}>{money(s.amount, s.currency)} · {titleCase(s.frequency)}</Text>
          <Muted>Next: {shortDate(s.nextRunAt)}</Muted>
          {s.lastResult ? <Muted>Last: {s.lastResult}</Muted> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={s.status === 'active' ? 'Pause' : 'Resume'} kind="secondary" onPress={() => void update(s)} /></View>
            <View style={{ flex: 1 }}><Button title="Delete" kind="danger" onPress={() => remove(s)} /></View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const FREQUENCIES = ['monthly', 'weekly'] as const;

export function NewScheduleScreen({ navigation }: any) {
  const { recipients, summary } = useApp();
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<(typeof FREQUENCIES)[number]>('monthly');
  const [start, setStart] = useState(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [pinOpen, setPinOpen] = useState(false);
  const minor = toMinor(amount);
  const dateBad = !/^\d{4}-\d{2}-\d{2}$/.test(start);
  const save = async (pin: string) => {
    await api('/schedules', 'POST', { recipientId: recipient!.id, currency, amount: minor, frequency, startDate: start, pin });
    setPinOpen(false);
    navigation.goBack();
  };
  return (
    <Screen title="New scheduled payment" footer={<Button title="Save" disabled={!recipient || !minor || dateBad} onPress={() => setPinOpen(true)} />}>
      <SectionTitle>Pay</SectionTitle>
      {recipients.length === 0 ? <Muted>Add a recipient first.</Muted> : <Chips options={recipients.map((r) => r.id)} value={recipient?.id ?? null} onChange={(id) => setRecipient(recipients.find((r) => r.id === id)!)} label={(id) => recipients.find((r) => r.id === id)!.name} />}
      <SectionTitle>From</SectionTitle>
      <Chips options={summary.wallets.map((w) => w.currency)} value={currency} onChange={setCurrency} />
      <Field label={`Amount in ${currency}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <SectionTitle>How often</SectionTitle>
      <Chips options={FREQUENCIES} value={frequency} onChange={setFrequency} label={titleCase} />
      <Field label="First payment (YYYY-MM-DD)" keyboardType="numbers-and-punctuation" value={start} onChangeText={setStart} error={dateBad ? 'Use the format YYYY-MM-DD' : null} />
      <Muted>Payments use the exchange rate on the day. If your balance is short, we try again the next day and pause after three tries.</Muted>
      <PinSheet visible={pinOpen} title="Confirm schedule" onClose={() => setPinOpen(false)} onSubmit={save} />
    </Screen>
  );
}

export function RatesScreen() {
  const { summary, meta, showToast } = useApp();
  const [base, setBase] = useState(summary.defaultCurrency);
  const [rates, setRates] = useState<{ currency: string; name: string; rate: number }[] | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [target, setTarget] = useState('');
  const [to, setTo] = useState<string | null>(null);
  const loadAlerts = () => api<any[]>('/rate-alerts').then(setAlerts, () => {});
  useEffect(() => { void loadAlerts(); }, []);
  useEffect(() => { setRates(null); api(`/rates?base=${base}`).then((r) => setRates(r.rates), (e: Error) => showToast(e.message, 'bad')); }, [base]);
  const current = rates?.find((r) => r.currency === to)?.rate;
  const value = Number(target);
  const addAlert = async () => {
    try {
      await api('/rate-alerts', 'POST', { from: base, to, target: value, direction: value >= (current ?? 0) ? 'above' : 'below' });
      setTarget('');
      showToast('Alert set');
      await loadAlerts();
    } catch (e) { showToast((e as Error).message, 'bad'); }
  };
  const remove = async (id: string) => { await api(`/rate-alerts/${id}`, 'DELETE').catch(() => {}); await loadAlerts(); };
  return (
    <Screen title="Exchange rates">
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={base} onChange={(c) => { setBase(c); setTo(null); }} />
      <Card style={{ gap: 0 }}>
        {!rates ? <Spinner /> : rates.map((r) => <Row key={r.currency} title={r.currency} sub={r.name} onPress={() => setTo(r.currency)} right={<Text style={{ fontWeight: '700', color: r.currency === to ? colors.brand : colors.ink }}>{r.rate.toFixed(4)}</Text>} />)}
      </Card>
      <SectionTitle>Rate alerts</SectionTitle>
      {to ? (
        <Card>
          <Field label={`Tell me when 1 ${base} reaches this many ${to}`} keyboardType="decimal-pad" value={target} onChangeText={setTarget} />
          <Button title="Set alert" disabled={!(value > 0)} onPress={() => void addAlert()} />
        </Card>
      ) : <Muted>Tap a currency above to set an alert.</Muted>}
      {alerts.map((a) => <Row key={a.id} icon="notifications-outline" title={`${a.from} to ${a.to} ${a.direction} ${a.target}`} sub={a.active ? 'Watching' : 'Triggered'} right={<Pressable accessibilityRole="button" accessibilityLabel="Delete alert" hitSlop={8} onPress={() => void remove(a.id)}><Ionicons name="close" size={20} color={colors.faint} /></Pressable>} />)}
    </Screen>
  );
}

export function NotificationsScreen({ navigation }: any) {
  const refreshApp = useApp((a) => a.refresh);
  const [items, setItems] = useState<Notification[] | null>(null);
  const load = async () => {
    const r = await api<{ items: Notification[] }>('/notifications');
    setItems(r.items);
    await api('/notifications/read', 'POST', {});
    void refreshApp().catch(() => {});
  };
  useEffect(() => { load().catch(() => setItems([])); }, []);
  return (
    <Screen title="Notifications" onRefresh={load}>
      {!items ? <Spinner /> : items.length === 0 ? <Empty icon="notifications-off-outline" text="Nothing yet." /> : items.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" disabled={!n.transactionId} onPress={() => navigation.navigate('Transaction', { id: n.transactionId })}>
          <Card style={!n.readAt ? { borderColor: colors.mint, borderWidth: 1 } : undefined}>
            <Text style={{ fontWeight: '700', color: colors.ink }}>{n.title}</Text>
            <Text style={{ color: colors.ink }}>{n.body}</Text>
            <Muted>{shortDate(n.createdAt)}</Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
