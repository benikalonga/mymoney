import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, Chips, ErrorText, Field, Muted, PinInput, Screen } from '../components/ui';
import { api } from '../lib/api';
import { useApp } from '../store/app';
import { colors } from '../theme';

export function WelcomeScreen({ navigation }: any) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.forest, padding: 24, justifyContent: 'space-between' }}>
      <View style={{ marginTop: 70, gap: 14 }}>
        <View style={{ width: 60, height: 60, borderRadius: 18, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 32, fontWeight: '900', color: colors.forest }}>M</Text></View>
        <Text style={{ color: colors.white, fontSize: 40, fontWeight: '800', letterSpacing: -1, lineHeight: 44 }}>All your money,{'\n'}every currency.</Text>
        <Text style={{ color: '#BFD2CC', fontSize: 16, lineHeight: 23 }}>Hold balances, send to friends, banks and mobile money, and save toward what matters.</Text>
      </View>
      <View style={{ gap: 10 }}>
        <Button title="Create an account" onPress={() => navigation.navigate('Register')} />
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Login')} style={{ padding: 14, alignItems: 'center' }}><Text style={{ color: colors.white, fontWeight: '700', fontSize: 15 }}>I already have an account</Text></Pressable>
      </View>
    </SafeAreaView>
  );
}

export function LoginScreen({ navigation }: any) {
  const signIn = useApp((a) => a.signIn);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/login', 'POST', { phone, pin, device: 'Mobile app' });
      await signIn(r.token, r.user);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
      setBusy(false);
    }
  };
  return (
    <Screen title="Sign in" footer={<Button title="Sign in" busy={busy} disabled={!phone || pin.length !== 6} onPress={submit} />}>
      <ErrorText text={error} />
      <Field label="Phone number" keyboardType="phone-pad" autoComplete="tel" placeholder="YOUR_PHONE_NUMBER" value={phone} onChangeText={setPhone} />
      <Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>PIN</Text>
      <PinInput value={pin} onChange={setPin} />
      <Pressable accessibilityRole="button" onPress={() => navigation.replace('Register')} style={{ alignItems: 'center', padding: 10 }}><Text style={{ color: colors.brand, fontWeight: '700' }}>New here? Create an account</Text></Pressable>
    </Screen>
  );
}

export function RegisterScreen() {
  const signIn = useApp((a) => a.signIn);
  const meta = useApp((a) => a.meta);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', referralCode: '' });
  const [currency, setCurrency] = useState('USD');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const submit = async () => {
    if (pin !== confirm) return setError('The two PINs do not match');
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/register', 'POST', { ...form, referralCode: form.referralCode || undefined, pin, currency, device: 'Mobile app' });
      await signIn(r.token, r.user);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const codes = meta?.currencies.map((c) => c.code) ?? ['USD'];
  return (
    <Screen title="Create your account" footer={<Button title="Create account" busy={busy} disabled={!form.firstName || !form.lastName || !form.phone || pin.length !== 6 || confirm.length !== 6} onPress={submit} />}>
      <ErrorText text={error} />
      <Field label="First name" autoCapitalize="words" value={form.firstName} onChangeText={set('firstName')} />
      <Field label="Last name" autoCapitalize="words" value={form.lastName} onChangeText={set('lastName')} />
      <Field label="Phone number" keyboardType="phone-pad" placeholder="YOUR_PHONE_NUMBER" value={form.phone} onChangeText={set('phone')} />
      <Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>Main currency</Text>
      <Chips options={codes} value={currency} onChange={setCurrency} />
      <Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>Choose a 6-digit PIN</Text>
      <PinInput value={pin} onChange={setPin} />
      <Text style={{ fontWeight: '600', fontSize: 13, color: colors.ink }}>Repeat your PIN</Text>
      <PinInput value={confirm} onChange={setConfirm} />
      <Field label="Invite code (optional)" autoCapitalize="characters" value={form.referralCode} onChangeText={set('referralCode')} />
      <Muted>No one at MyMoney will ever ask for your PIN.</Muted>
    </Screen>
  );
}

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const signOut = useApp((a) => a.signOut);
  const user = useApp((a) => a.user);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/verify-pin', 'POST', { pin });
      onUnlock();
    } catch (e) {
      setError((e as Error).message);
      setPin('');
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper, padding: 24, justifyContent: 'center', gap: 14 }}>
      <Ionicons name="lock-closed" size={36} color={colors.brand} style={{ alignSelf: 'center' }} />
      <Text style={{ textAlign: 'center', fontSize: 22, fontWeight: '800', color: colors.ink }}>Welcome back{user ? `, ${user.firstName}` : ''}</Text>
      <PinInput value={pin} onChange={setPin} autoFocus />
      <ErrorText text={error} />
      <Button title="Unlock" busy={busy} disabled={pin.length !== 6} onPress={submit} />
      <Button title="Sign out" kind="secondary" onPress={() => void signOut()} />
    </SafeAreaView>
  );
}
