import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, Chips, ErrorText, Field, Line, Muted, PinInput, Row, Screen, SectionTitle, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, money, titleCase } from '../lib/format';
import { useApp } from '../store/app';
import { colors } from '../theme';

const chevron = <Ionicons name="chevron-forward" size={18} color={colors.faint} />;

export function ProfileScreen({ navigation }: any) {
  const { user, signOut, showToast, refresh } = useApp();
  const go = (s: string) => () => navigation.navigate(s);
  if (!user) return <Screen><Spinner /></Screen>;
  const invite = () => Share.share({ message: `Join me on MyMoney. Use my invite code ${user.referralCode} and we both get a bonus after your first payment.` });
  const copyTag = async () => { await Clipboard.setStringAsync(`@${user.tag}`); showToast('Tag copied'); };
  return (
    <Screen onRefresh={refresh}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink }}>{user.firstName} {user.lastName}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy your tag" onPress={() => void copyTag()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={{ color: colors.brand, fontWeight: '700' }}>@{user.tag}</Text><Ionicons name="copy-outline" size={15} color={colors.brand} /></Pressable>
      <Muted>{user.phone}</Muted>
      <Card style={{ backgroundColor: colors.forest }}>
        <Text style={{ color: colors.white, fontWeight: '700', fontSize: 16 }}>Invite a friend</Text>
        <Text style={{ color: '#BFD2CC' }}>You both get a bonus after their first payment. Your code is {user.referralCode}.</Text>
        <Button title="Share invite" icon="share-social-outline" kind="secondary" onPress={() => void invite()} />
      </Card>
      <SectionTitle>Account</SectionTitle>
      <Card style={{ gap: 0 }}>
        <Row icon="create-outline" title="Edit profile" onPress={go('EditProfile')} right={chevron} />
        <Row icon="shield-checkmark-outline" title="Identity verification" onPress={go('Verify')} right={<Badge value={user.kycStatus === 'none' ? 'Not started' : user.kycStatus} />} />
        <Row icon="speedometer-outline" title="Limits" sub={`Tier ${user.tier}`} onPress={go('Limits')} right={chevron} />
      </Card>
      <SectionTitle>Security</SectionTitle>
      <Card style={{ gap: 0 }}>
        <Row icon="keypad-outline" title="Change PIN" onPress={go('ChangePin')} right={chevron} />
        <Row icon="phone-portrait-outline" title="Signed-in devices" onPress={go('Devices')} right={chevron} />
      </Card>
      <Button title="Sign out" kind="danger" onPress={() => Alert.alert('Sign out?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])} />
    </Screen>
  );
}

export function EditProfileScreen({ navigation }: any) {
  const { user, setUser, meta, showToast } = useApp();
  const [form, setForm] = useState({ firstName: user!.firstName, lastName: user!.lastName, email: user!.email ?? '', tag: user!.tag });
  const [currency, setCurrency] = useState(user!.defaultCurrency);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser(await api('/me', 'PATCH', { ...form, email: form.email || null, defaultCurrency: currency }));
      showToast('Saved');
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Screen title="Edit profile" footer={<Button title="Save" busy={busy} onPress={save} />}>
      <ErrorText text={error} />
      <Field label="First name" value={form.firstName} onChangeText={set('firstName')} />
      <Field label="Last name" value={form.lastName} onChangeText={set('lastName')} />
      <Field label="Email" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={set('email')} />
      <Field label="Tag" autoCapitalize="none" autoCorrect={false} value={form.tag} onChangeText={set('tag')} />
      <SectionTitle>Main currency</SectionTitle>
      <Chips options={meta?.currencies.map((c) => c.code) ?? []} value={currency} onChange={setCurrency} />
    </Screen>
  );
}

const DOCS = ['national_id', 'passport', 'drivers_licence'] as const;

export function VerifyScreen({ navigation }: any) {
  const { refresh, showToast } = useApp();
  const [state, setState] = useState<any>(null);
  const [form, setForm] = useState({ legalName: '', dateOfBirth: '', documentNumber: '', address: '' });
  const [doc, setDoc] = useState<(typeof DOCS)[number]>('national_id');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/kyc').then(setState, (e: Error) => setError(e.message)); }, []);
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/kyc', 'POST', { ...form, documentType: doc });
      await refresh().catch(() => {});
      showToast('Submitted for review');
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (!state) return <Screen title="Identity verification">{error ? <ErrorText text={error} /> : <Spinner />}</Screen>;
  if (state.status === 'pending' || state.status === 'approved') {
    return (
      <Screen title="Identity verification">
        <Card style={{ alignItems: 'center', gap: 10 }}>
          <Ionicons name={state.status === 'approved' ? 'shield-checkmark' : 'time-outline'} size={44} color={colors.brand} />
          <Text style={{ fontWeight: '800', fontSize: 18, color: colors.ink }}>{state.status === 'approved' ? 'You are verified' : 'We are checking your details'}</Text>
          <Muted>{state.status === 'approved' ? `You are on tier ${state.tier}.` : 'We will notify you when it is done.'}</Muted>
        </Card>
      </Screen>
    );
  }
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(form.dateOfBirth);
  return (
    <Screen title="Identity verification" footer={<Button title="Submit" busy={busy} disabled={!form.legalName || !dateOk || !form.documentNumber || !form.address} onPress={submit} />}>
      {state.latest?.reason ? <ErrorText text={`Last attempt: ${state.latest.reason}`} /> : null}
      <ErrorText text={error} />
      <Muted>Verifying raises your limits. Use the details exactly as they appear on your document.</Muted>
      <Field label="Legal full name" autoCapitalize="words" value={form.legalName} onChangeText={set('legalName')} />
      <Field label="Date of birth (YYYY-MM-DD)" keyboardType="numbers-and-punctuation" value={form.dateOfBirth} onChangeText={set('dateOfBirth')} />
      <SectionTitle>Document</SectionTitle>
      <Chips options={DOCS} value={doc} onChange={setDoc} label={titleCase} />
      <Field label="Document number" autoCapitalize="characters" value={form.documentNumber} onChangeText={set('documentNumber')} />
      <Field label="Home address" value={form.address} onChangeText={set('address')} />
    </Screen>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  return (
    <View style={{ gap: 5, marginBottom: 10 }}>
      <Line label={label} value={`${money(used, 'USD')} of ${money(limit, 'USD')}`} />
      <View style={{ height: 8, backgroundColor: colors.brandSoft, borderRadius: 4, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.min(100, (used / limit) * 100)}%`, backgroundColor: colors.brand }} /></View>
    </View>
  );
}

export function LimitsScreen() {
  const [l, setL] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api('/me/limits').then(setL, (e: Error) => setError(e.message)); }, []);
  return (
    <Screen title="Limits">
      <ErrorText text={error} />
      {!l ? (!error && <Spinner />) : (
        <Card>
          <Line label="Tier" value={String(l.tier)} strong />
          <Line label="Per transfer" value={money(l.singleUsd, 'USD')} />
          <View style={{ height: 8 }} />
          <Meter label="Last 24 hours" used={l.usedDailyUsd} limit={l.dailyUsd} />
          <Meter label="This month" used={l.usedMonthlyUsd} limit={l.monthlyUsd} />
        </Card>
      )}
    </Screen>
  );
}

export function ChangePinScreen({ navigation }: any) {
  const showToast = useApp((a) => a.showToast);
  const [currentPin, setCurrent] = useState('');
  const [newPin, setNew] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (newPin !== repeat) return setError('The new PINs do not match');
    setBusy(true);
    setError(null);
    try {
      await api('/auth/pin', 'POST', { currentPin, newPin });
      showToast('PIN changed. Other devices were signed out.');
      navigation.goBack();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const label = { fontWeight: '600', fontSize: 13, color: colors.ink } as const;
  return (
    <Screen title="Change PIN" footer={<Button title="Change PIN" busy={busy} disabled={currentPin.length !== 6 || newPin.length !== 6 || repeat.length !== 6} onPress={submit} />}>
      <ErrorText text={error} />
      <Text style={label}>Current PIN</Text><PinInput value={currentPin} onChange={setCurrent} />
      <Text style={label}>New PIN</Text><PinInput value={newPin} onChange={setNew} />
      <Text style={label}>Repeat new PIN</Text><PinInput value={repeat} onChange={setRepeat} />
    </Screen>
  );
}

export function DevicesScreen() {
  const [items, setItems] = useState<any[] | null>(null);
  const showToast = useApp((a) => a.showToast);
  const load = () => api<any[]>('/sessions').then(setItems, (e: Error) => { setItems([]); showToast(e.message, 'bad'); });
  useEffect(() => { void load(); }, []);
  const revoke = async (id: string) => { await api(`/sessions/${id}`, 'DELETE').catch((e: Error) => showToast(e.message, 'bad')); await load(); };
  return (
    <Screen title="Signed-in devices" onRefresh={load}>
      {!items ? <Spinner /> : <Card style={{ gap: 0 }}>{items.map((d) => <Row key={d.id} icon="phone-portrait-outline" title={d.device} sub={`Last active ${dateTime(d.lastSeenAt)}`} right={d.current ? <Badge value="active" /> : <Pressable accessibilityRole="button" onPress={() => void revoke(d.id)}><Text style={{ color: colors.bad, fontWeight: '700' }}>Sign out</Text></Pressable>} />)}</Card>}
    </Screen>
  );
}
