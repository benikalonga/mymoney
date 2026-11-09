import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Chips, Empty, ErrorText, Field, Muted, Row, Screen } from '../components/ui';
import { api } from '../lib/api';
import { methodLabel } from '../lib/format';
import type { Recipient } from '../lib/types';
import { useApp } from '../store/app';
import { colors } from '../theme';

export function RecipientsScreen({ navigation }: any) {
  const { recipients, refresh, showToast } = useApp();
  const toggle = async (r: Recipient) => {
    await api(`/recipients/${r.id}`, 'PATCH', { favorite: !r.favorite }).catch((e: Error) => showToast(e.message, 'bad'));
    await refresh().catch(() => {});
  };
  const remove = (r: Recipient) => Alert.alert(`Remove ${r.name}?`, 'Any scheduled payments to them will be paused.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await api(`/recipients/${r.id}`, 'DELETE').catch((e: Error) => showToast(e.message, 'bad')); await refresh().catch(() => {}); } },
  ]);
  return (
    <Screen title="Recipients" onRefresh={refresh} footer={<Button title="Add a recipient" icon="person-add-outline" onPress={() => navigation.navigate('RecipientForm')} />}>
      <Card style={{ gap: 0 }}>
        {recipients.length === 0 ? <Empty icon="people-outline" text="No recipients yet." /> : recipients.map((r) => (
          <Row key={r.id} icon="person-outline" title={r.name} sub={`${methodLabel(r.method, r.provider)} · ${r.account} · ${r.currency}`} onPress={() => navigation.navigate('Send', { recipientId: r.id })}
            right={
              <View style={{ flexDirection: 'row', gap: 14 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={r.favorite ? 'Remove from favourites' : 'Add to favourites'} hitSlop={8} onPress={() => void toggle(r)}><Ionicons name={r.favorite ? 'star' : 'star-outline'} size={20} color={r.favorite ? colors.mint : colors.faint} /></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${r.name}`} hitSlop={8} onPress={() => remove(r)}><Ionicons name="trash-outline" size={20} color={colors.faint} /></Pressable>
              </View>
            } />
        ))}
      </Card>
    </Screen>
  );
}

const METHODS = ['mymoney', 'mobile_money', 'bank'] as const;
const METHOD_LABEL = { mymoney: 'MyMoney user', mobile_money: 'Mobile money', bank: 'Bank' };

export function RecipientFormScreen({ navigation }: any) {
  const { meta, summary, refresh } = useApp();
  const [method, setMethod] = useState<(typeof METHODS)[number]>('mymoney');
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [currency, setCurrency] = useState(summary.defaultCurrency);
  const [found, setFound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isUser = method === 'mymoney';
  const lookup = () => {
    setFound(null);
    if (isUser && account.trim().length >= 3) api(`/users/lookup?q=${encodeURIComponent(account.trim())}`).then((r) => setFound(`${r.name} (@${r.tag})`), () => setFound(null));
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/recipients', 'POST', { method, account, currency, name: isUser ? undefined : name, provider: isUser ? undefined : provider ?? undefined });
      await refresh().catch(() => {});
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const providers = method === 'bank' ? meta?.providers.bank : meta?.providers.mobile_money;
  return (
    <Screen title="Add recipient" footer={<Button title="Save recipient" busy={busy} disabled={!account || (!isUser && (!name || !provider))} onPress={save} />}>
      <ErrorText text={error} />
      <Chips options={METHODS} value={method} onChange={(m) => { setMethod(m); setProvider(null); setFound(null); }} label={(m) => METHOD_LABEL[m]} />
      {!isUser && <Field label="Full name" autoCapitalize="words" value={name} onChangeText={setName} />}
      {!isUser && <><Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>{method === 'bank' ? 'Bank' : 'Provider'}</Text><Chips options={providers ?? []} value={provider} onChange={setProvider} /></>}
      <Field label={isUser ? 'Phone number or @tag' : method === 'bank' ? 'Account number' : 'Phone number'} autoCapitalize="none" autoCorrect={false} value={account} onChangeText={setAccount} onBlur={lookup} keyboardType={method === 'bank' ? 'number-pad' : 'default'} />
      {found ? <Muted style={{ color: colors.ok, fontWeight: '600' }}>Found: {found}</Muted> : null}
      <Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>They receive in</Text>
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={currency} onChange={setCurrency} />
    </Screen>
  );
}
