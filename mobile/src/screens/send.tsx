import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chips, Empty, ErrorText, Field, Line, Muted, PinSheet, Row, Screen, SectionTitle, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { methodLabel, money, titleCase, toMinor } from '../lib/format';
import type { Quote, Recipient, Transaction } from '../lib/types';
import { useApp } from '../store/app';
import { colors } from '../theme';

export function SendScreen({ navigation, route }: any) {
  const { recipients, summary, meta, refresh, showToast } = useApp();
  const preset = route.params?.recipientId as string | undefined;
  const [recipient, setRecipient] = useState<Recipient | null>(() => recipients.find((r) => r.id === preset) ?? null);
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pricing, setPricing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'amount' | 'review'>('amount');
  const [pinOpen, setPinOpen] = useState(false);
  // One key per attempt, so a retry after a dropped connection cannot pay twice.
  const attemptKey = useRef(randomUUID());

  useEffect(() => {
    if (preset) setRecipient(recipients.find((r) => r.id === preset) ?? null);
  }, [preset, recipients]);

  const minor = toMinor(amount);
  const fetchQuote = async () => {
    if (!recipient || !minor) return null;
    const q = await api<Quote>('/quotes', 'POST', { recipientId: recipient.id, sendCurrency: currency, sendAmount: minor });
    setQuote(q);
    return q;
  };

  useEffect(() => {
    setQuote(null);
    setError(null);
    setPricing(false);
    if (!recipient || !minor) return;
    setPricing(true);
    let current = true;
    const timer = setTimeout(() => {
      api<Quote>('/quotes', 'POST', { recipientId: recipient.id, sendCurrency: currency, sendAmount: minor })
        .then((q) => { if (current) setQuote(q); }, (e: Error) => { if (current) setError(e.message); })
        .finally(() => { if (current) setPricing(false); });
    }, 450);
    return () => { current = false; clearTimeout(timer); };
  }, [recipient, currency, minor]);

  useEffect(() => { attemptKey.current = randomUUID(); }, [recipient, currency, minor]);

  if (!recipient) {
    return (
      <Screen title="Send money" onRefresh={refresh}>
        <Button title="Add a recipient" kind="secondary" icon="person-add-outline" onPress={() => navigation.navigate('RecipientForm')} />
        <SectionTitle>Who are you paying?</SectionTitle>
        <Card style={{ gap: 0 }}>
          {recipients.length === 0 ? <Empty icon="people-outline" text="Add someone to send them money." /> : recipients.map((r) => (
            <Row key={r.id} icon="person-outline" title={r.name} sub={`${methodLabel(r.method, r.provider)} · ${r.currency}`} onPress={() => setRecipient(r)} right={r.favorite ? <Ionicons name="star" size={16} color={colors.mint} /> : undefined} />
          ))}
        </Card>
      </Screen>
    );
  }

  const wallet = summary.wallets.find((w) => w.currency === currency);
  const short = !!quote && (wallet?.balance ?? 0) < quote.total;

  const confirm = async (pin: string) => {
    try {
      const t = await api<Transaction>('/transfers', 'POST', { quoteId: quote!.id, pin, idempotencyKey: attemptKey.current, note: note || undefined, category: category ?? undefined });
      setPinOpen(false);
      void refresh().catch(() => {});
      showToast(t.status === 'completed' ? 'Money sent' : 'Transfer started');
      navigation.replace('Transaction', { id: t.id });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'QUOTE_EXPIRED' || e.code === 'QUOTE_USED')) {
        await fetchQuote().catch(() => {});
        setPinOpen(false);
        setError('The rate was updated. Please check the new amounts and confirm again.');
        return;
      }
      if (e instanceof ApiError && e.status === 0) throw new Error('No connection. Your transfer was not confirmed. Trying again is safe and will not pay twice.');
      throw e;
    }
  };

  if (step === 'review' && quote) {
    return (
      <Screen title="Review" footer={<Button title={`Send ${money(quote.total, quote.sendCurrency)}`} onPress={() => setPinOpen(true)} />}>
        <ErrorText text={error} />
        <Card>
          <Line label="To" value={recipient.name} strong />
          <Line label="Via" value={methodLabel(recipient.method, recipient.provider)} />
          <Line label="They receive" value={money(quote.receiveAmount, quote.receiveCurrency)} strong />
          <Line label="You send" value={money(quote.sendAmount, quote.sendCurrency)} />
          <Line label="Fee" value={quote.fee ? money(quote.fee, quote.sendCurrency) : 'Free'} />
          {quote.sendCurrency !== quote.receiveCurrency ? <Line label="Rate" value={`1 ${quote.sendCurrency} = ${quote.rate.toFixed(4)} ${quote.receiveCurrency}`} /> : null}
          <Line label="Total to pay" value={money(quote.total, quote.sendCurrency)} strong />
          {category ? <Line label="Category" value={titleCase(category)} /> : null}
          {note ? <Line label="Note" value={note} /> : null}
        </Card>
        <Muted>This price is locked for 5 minutes.</Muted>
        <Button title="Change details" kind="secondary" onPress={() => setStep('amount')} />
        <PinSheet visible={pinOpen} title="Confirm transfer" onClose={() => setPinOpen(false)} onSubmit={confirm} />
      </Screen>
    );
  }

  return (
    <Screen title="Send money" footer={<Button title="Continue" disabled={!quote || pricing || short} onPress={() => { setError(null); setStep('review'); }} />}>
      <Card style={{ gap: 0 }}><Row icon="person-outline" title={recipient.name} sub={`${methodLabel(recipient.method, recipient.provider)} · ${recipient.currency}`} onPress={() => { setRecipient(null); navigation.setParams({ recipientId: undefined }); }} right={<Text style={{ color: colors.brand, fontWeight: '700' }}>Change</Text>} /></Card>
      <SectionTitle>Pay from</SectionTitle>
      <Chips options={summary.wallets.map((w) => w.currency)} value={currency} onChange={setCurrency} label={(c) => { const w = summary.wallets.find((x) => x.currency === c)!; return money(w.balance, c); }} />
      <Field label={`Amount in ${currency}`} keyboardType="decimal-pad" placeholder="0.00" value={amount} onChangeText={setAmount} error={amount && !minor ? 'Enter a valid amount' : null} />
      <ErrorText text={error} />
      {pricing ? <Spinner /> : null}
      {quote && !pricing ? (
        <Card>
          <Line label="They receive" value={money(quote.receiveAmount, quote.receiveCurrency)} strong />
          <Line label="Fee" value={quote.fee ? money(quote.fee, quote.sendCurrency) : 'Free'} />
          {quote.sendCurrency !== quote.receiveCurrency ? <Line label="Rate" value={`1 ${quote.sendCurrency} = ${quote.rate.toFixed(4)} ${quote.receiveCurrency}`} /> : null}
          <Line label="Total to pay" value={money(quote.total, quote.sendCurrency)} strong />
          {short ? <Text style={{ color: colors.bad, marginTop: 4 }}>You do not have enough {currency}. Add money or pay from another wallet.</Text> : null}
        </Card>
      ) : null}
      <SectionTitle>What is it for?</SectionTitle>
      <Chips options={meta?.categories ?? []} value={category} onChange={setCategory} label={titleCase} />
      <Field label="Note (optional)" maxLength={140} value={note} onChangeText={setNote} />
      <View style={{ height: 4 }} />
    </Screen>
  );
}
