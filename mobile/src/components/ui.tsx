import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { titleCase } from '../lib/format';
import { useApp } from '../store/app';
import { colors, radius, space } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function TopBar({ title, right }: { title: string; right?: ReactNode }) {
  const nav = useNavigation<any>();
  return (
    <View style={s.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => nav.goBack()}><Ionicons name="chevron-back" size={26} color={colors.ink} /></Pressable>
      <Text style={s.topTitle} numberOfLines={1}>{title}</Text>
      <View style={{ minWidth: 26, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

export function Screen({ title, children, onRefresh, right, footer }: { title?: string; children: ReactNode; onRefresh?: () => Promise<unknown>; right?: ReactNode; footer?: ReactNode }) {
  const [refreshing, setRefreshing] = useState(false);
  const pull = onRefresh ? async () => { setRefreshing(true); await onRefresh().catch(() => {}); setRefreshing(false); } : undefined;
  return (
    <SafeAreaView style={s.screen} edges={title ? ['top', 'bottom'] : ['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {title ? <TopBar title={title} right={right} /> : null}
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" refreshControl={pull ? <RefreshControl refreshing={refreshing} onRefresh={pull} /> : undefined}>{children}</ScrollView>
        {footer ? <View style={s.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: object }) => <View style={[s.card, style]}>{children}</View>;
export const SectionTitle = ({ children }: { children: ReactNode }) => <Text style={s.section}>{children}</Text>;
export const Muted = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[{ color: colors.muted, fontSize: 13 }, style]}>{children}</Text>;

export function Button({ title, onPress, kind = 'primary', busy, disabled, icon }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean; icon?: IconName }) {
  const off = disabled || busy;
  const fg = kind === 'primary' ? colors.white : kind === 'danger' ? colors.bad : colors.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off }} disabled={off} onPress={onPress}
      style={({ pressed }) => [s.btn, kind === 'primary' ? { backgroundColor: colors.brand } : s.btnOutline, kind === 'danger' && { borderColor: colors.bad }, off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <>{icon ? <Ionicons name={icon} size={18} color={fg} /> : null}<Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text></>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.faint} style={[s.input, !!error && { borderColor: colors.bad }]} {...props} />
      {error ? <Text style={{ color: colors.bad, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

export function Chips<T extends string>({ options, value, onChange, label }: { options: readonly T[]; value: T | null; onChange: (v: T) => void; label?: (v: T) => string }) {
  // The initial choice goes first so it is visible, without reordering on every tap.
  const first = useRef(value).current;
  const ordered = useMemo(() => (first !== null && options.includes(first) ? [first, ...options.filter((o) => o !== first)] : [...options]), [options.join('|'), first]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
      {ordered.map((o) => (
        <Pressable key={o} accessibilityRole="button" accessibilityState={{ selected: o === value }} onPress={() => onChange(o)} style={[s.chip, o === value && s.chipOn]}>
          <Text style={{ color: o === value ? colors.white : colors.ink, fontWeight: '600', fontSize: 13 }}>{label ? label(o) : o}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const TONES: Record<string, [string, string]> = {
  completed: [colors.okSoft, colors.ok], paid: [colors.okSoft, colors.ok], approved: [colors.okSoft, colors.ok], active: [colors.okSoft, colors.ok],
  pending: [colors.infoSoft, colors.info], processing: [colors.infoSoft, colors.info], review: [colors.warnSoft, colors.warn], paused: [colors.warnSoft, colors.warn],
  failed: [colors.badSoft, colors.bad], reversed: [colors.badSoft, colors.bad], declined: [colors.badSoft, colors.bad], rejected: [colors.badSoft, colors.bad],
};
export function Badge({ value }: { value: string }) {
  const [bg, fg] = TONES[value] ?? [colors.line, colors.muted];
  const text = value === 'review' ? 'Under review' : titleCase(value);
  return <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, alignSelf: 'flex-start' }}><Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{text}</Text></View>;
}

export function Row({ icon, title, sub, right, onPress, tint }: { icon?: IconName; title: string; sub?: string | null; right?: ReactNode; onPress?: () => void; tint?: string }) {
  const body = (
    <View style={s.row}>
      {icon ? <View style={[s.iconWrap, tint ? { backgroundColor: tint } : null]}><Ionicons name={icon} size={19} color={colors.forest} /></View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '600', color: colors.ink, fontSize: 15 }} numberOfLines={1}>{title}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      {right ? <View>{right}</View> : null}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && { opacity: 0.6 }}>{body}</Pressable> : body;
}

export const Empty = ({ icon, text }: { icon: IconName; text: string }) => <View style={{ alignItems: 'center', padding: 32, gap: 8 }}><Ionicons name={icon} size={36} color={colors.faint} /><Muted style={{ textAlign: 'center' }}>{text}</Muted></View>;
export const ErrorText = ({ text }: { text?: string | null }) => (text ? <View style={s.errorBox} accessibilityRole="alert"><Text style={{ color: colors.bad }}>{text}</Text></View> : null);
export const Line = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => <View style={s.line}><Muted style={{ fontSize: 14 }}>{label}</Muted><Text style={{ color: colors.ink, fontWeight: strong ? '800' : '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text></View>;
export const Spinner = () => <View style={{ padding: 32 }}><ActivityIndicator color={colors.brand} /></View>;

export function Toast() {
  const toast = useApp((a) => a.toast);
  if (!toast) return null;
  return <SafeAreaView edges={['bottom']} pointerEvents="none" style={s.toastWrap}><View style={[s.toast, toast.tone === 'bad' && { backgroundColor: colors.bad }]} accessibilityLiveRegion="polite"><Text style={{ color: colors.white, fontWeight: '600' }}>{toast.text}</Text></View></SafeAreaView>;
}

export function OfflineBar() {
  const online = useApp((a) => a.online);
  if (online) return null;
  return <SafeAreaView edges={['top']} style={{ backgroundColor: colors.warnSoft }}><Text style={{ textAlign: 'center', color: colors.warn, fontWeight: '600', paddingVertical: 5, fontSize: 13 }}>Offline. Showing your last saved balances.</Text></SafeAreaView>;
}

export function PinInput({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return <TextInput accessibilityLabel="PIN" value={value} onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry autoFocus={autoFocus} maxLength={6} textContentType="none" autoComplete="off" style={s.pin} placeholder="••••••" placeholderTextColor={colors.faint} />;
}

/** Asks for the PIN, then runs an action. The sheet stays open to show errors. */
export function PinSheet({ visible, title, onClose, onSubmit, children }: { visible: boolean; title: string; onClose: () => void; onSubmit: (pin: string) => Promise<void>; children?: ReactNode }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) { setPin(''); setError(null); } }, [visible]);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(pin);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    }
    setBusy(false);
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetBack}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{title}</Text>
          {children}
          <Muted>Enter your 6-digit PIN to confirm.</Muted>
          <PinInput value={pin} onChange={setPin} autoFocus />
          <ErrorText text={error} />
          <Button title="Confirm" busy={busy} disabled={pin.length !== 6} onPress={submit} />
          <Button title="Cancel" kind="secondary" disabled={busy} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 32 },
  footer: { padding: space.lg, paddingTop: space.sm, gap: space.sm },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.md, paddingVertical: 8 },
  topTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.lg, gap: space.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  section: { fontWeight: '700', fontSize: 15, color: colors.ink, marginTop: 6 },
  btn: { minHeight: 50, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  btnOutline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  label: { fontWeight: '600', color: colors.ink, fontSize: 13 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingHorizontal: 14, height: 48, color: colors.ink, fontSize: 16, letterSpacing: 0 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.forest, borderColor: colors.forest },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  iconWrap: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  errorBox: { backgroundColor: colors.badSoft, padding: 12, borderRadius: radius.sm },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 3 },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 90, alignItems: 'center' },
  toast: { backgroundColor: colors.forest, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 99, maxWidth: '90%' },
  pin: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, height: 56, textAlign: 'center', fontSize: 24, letterSpacing: 10, color: colors.ink },
  sheetBack: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' },
  sheet: { backgroundColor: colors.paper, padding: space.xl, gap: space.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
});
