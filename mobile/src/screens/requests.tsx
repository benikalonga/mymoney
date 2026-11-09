import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Badge, Button, Card, Chips, Empty, ErrorText, Field, Muted, PinSheet, Screen, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { money, shortDate, toMinor } from '../lib/format';
import type { MoneyRequest, Quote } from '../lib/types';
import { useApp } from '../store/app';
import { colors } from '../theme';

const BOXES = ['incoming', 'outgoing'] as const;

export function RequestsScreen({ navigation }: any) {
  const { refresh, showToast, summary } = useApp();
  const [box, setBox] = useState<(typeof BOXES)[number]>('incoming');
  const [items, setItems] = useState<MoneyRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<MoneyRequest | null>(null);
  const [payFrom, setPayFrom] = useState<string | null>(null);
  const [cost, setCost] = useState<Quote | null>(null);
  const payKey = useRef(randomUUID());
  const load = useCallback(() => api<MoneyRequest[]>(`/requests?box=${box}`).then((r) => { setItems(r); setError(null); }, (e: Error) => setError(e.message)), [box]);
  useEffect(() => navigation.addListener('focus', () => void load()), [navigation, load]);
  useEffect(() => { setItems(null); void load(); }, [load]);

  const act = async (id: string, verb: string) => {
    await api(`/requests/${id}/${verb}`, 'POST', {}).catch((e: Error) => showToast(e.message, 'bad'));
    await Promise.all([load(), refresh().catch(() => {})]);
  };
  const startPay = (r: MoneyRequest) => {
    const same = summary.wallets.find((w) => w.currency === r.currency && w.balance >= r.amount);
    setPayFrom(same ? r.currency : summary.defaultCurrency);
    setPaying(r);
  };
  useEffect(() => {
    setCost(null);
    payKey.current = randomUUID();
    if (!paying || !payFrom) return;
    let current = true;
    api<Quote>('/quotes', 'POST', { method: 'mymoney', sendCurrency: payFrom, receiveCurrency: paying.currency, receiveAmount: paying.amount })
      .then((q) => { if (current) setCost(q); }, () => {});
    return () => { current = false; };
  }, [paying, payFrom]);
  const pay = async (pin: string) => {
    try {
      await api(`/requests/${paying!.id}/pay`, 'POST', { pin, idempotencyKey: payKey.current, fromCurrency: payFrom });
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) throw new Error('No connection. Your payment was not confirmed. Trying again is safe and will not pay twice.');
      throw e;
    }
    setPaying(null);
    payKey.current = randomUUID();
    showToast('Paid');
    await Promise.all([load(), refresh().catch(() => {})]);
  };

  return (
    <Screen title="Requests" onRefresh={load} footer={<Button title="Request money" icon="arrow-down" onPress={() => navigation.navigate('NewRequest')} />}>
      <Chips options={BOXES} value={box} onChange={setBox} label={(b) => (b === 'incoming' ? 'Asked of me' : 'I asked')} />
      <ErrorText text={error} />
      {!items ? <Spinner /> : items.length === 0 ? <Empty icon="mail-open-outline" text="No requests here." /> : items.map((r) => (
        <Card key={r.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ fontWeight: '700', color: colors.ink, flex: 1 }}>{r.otherName}</Text><Badge value={r.status} /></View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>{money(r.amount, r.currency)}</Text>
          {r.note ? <Text style={{ color: colors.ink }}>{r.note}</Text> : null}
          <Muted>{r.status === 'pending' ? `Expires ${shortDate(r.expiresAt)}` : shortDate(r.createdAt)}</Muted>
          {r.status === 'pending' && r.box === 'incoming' ? <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button title="Decline" kind="secondary" onPress={() => void act(r.id, 'decline')} /></View><View style={{ flex: 1 }}><Button title="Pay" onPress={() => startPay(r)} /></View></View> : null}
          {r.status === 'pending' && r.box === 'outgoing' ? <Button title="Cancel request" kind="secondary" onPress={() => void act(r.id, 'cancel')} /> : null}
        </Card>
      ))}
      <PinSheet visible={!!paying} title={paying ? `Pay ${money(paying.amount, paying.currency)}` : ''} onClose={() => setPaying(null)} onSubmit={pay}>
        <Muted>Pay from</Muted>
        <Chips options={summary.wallets.map((w) => w.currency)} value={payFrom} onChange={setPayFrom} label={(c) => money(summary.wallets.find((w) => w.currency === c)!.balance, c)} />
        {cost ? <Text style={{ fontWeight: '700', color: colors.ink }}>You pay {money(cost.total, cost.sendCurrency)}</Text> : null}
      </PinSheet>
    </Screen>
  );
}

export function NewRequestScreen({ navigation }: any) {
  const { summary, meta, showToast } = useApp();
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = toMinor(amount);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/requests', 'POST', { payer, amount: minor, currency, note: note || undefined });
      showToast('Request sent');
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Screen title="Request money" footer={<Button title="Send request" busy={busy} disabled={!payer || !minor} onPress={submit} />}>
      <ErrorText text={error} />
      <Field label="From (phone number or @tag)" autoCapitalize="none" autoCorrect={false} value={payer} onChangeText={setPayer} />
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={currency} onChange={setCurrency} />
      <Field label={`Amount in ${currency}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} />
      <Field label="What is it for? (optional)" maxLength={140} value={note} onChangeText={setNote} />
    </Screen>
  );
}
