import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api, setAuthToken, setReachabilityHandler, setUnauthorizedHandler } from '../lib/api';
import type { Meta, MoneyRequest, Recipient, Transaction, User, WalletSummary } from '../lib/types';

const TOKEN_KEY = 'mymoney.token';
const EMPTY_SUMMARY: WalletSummary = { wallets: [], held: [], totalUsd: 0, totalInDefault: 0, defaultCurrency: 'USD' };

interface AppState {
  ready: boolean; signedIn: boolean; online: boolean; user: User | null; summary: WalletSummary; recent: Transaction[]; recipients: Recipient[];
  incoming: MoneyRequest[]; unread: number; meta: Meta | null; toast: { text: string; tone: 'ok' | 'bad' } | null;
  boot: () => Promise<void>; signIn: (token: string, user: User) => Promise<void>; signOut: (callServer?: boolean) => Promise<void>; refresh: () => Promise<void>;
  setUser: (user: User) => void; setRecipients: (recipients: Recipient[]) => void; showToast: (text: string, tone?: 'ok' | 'bad') => void;
}

let refreshing: Promise<void> | null = null;

export const useApp = create<AppState>()(persist((set, get) => ({
  ready: false, signedIn: false, online: true, user: null, summary: EMPTY_SUMMARY, recent: [], recipients: [], incoming: [], unread: 0, meta: null, toast: null,

  boot: async () => {
    setUnauthorizedHandler(() => void get().signOut(false));
    setReachabilityHandler((online) => {
      if (online === get().online) return;
      set({ online });
      if (online && get().signedIn) void get().refresh();
    });
    api<Meta>('/meta').then((meta) => set({ meta }), () => {});
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      setAuthToken(token);
      set({ signedIn: true, ready: true });
      void get().refresh();
    } else {
      set({ signedIn: false, ready: true });
    }
  },

  signIn: async (token, user) => {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setAuthToken(token);
    set({ signedIn: true, user });
    await get().refresh().catch(() => {});
  },

  signOut: async (callServer = true) => {
    if (callServer) await api('/auth/logout', 'POST', {}).catch(() => {});
    setAuthToken(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ signedIn: false, user: null, summary: EMPTY_SUMMARY, recent: [], recipients: [], incoming: [], unread: 0 });
  },

  refresh: () => {
    if (!refreshing) {
      refreshing = (async () => {
        const [user, summary, recent, recipients, incoming, notes] = await Promise.all([
          api<User>('/me'), api<WalletSummary>('/wallets'), api<{ items: Transaction[] }>('/transactions?limit=8'), api<Recipient[]>('/recipients'),
          api<MoneyRequest[]>('/requests?box=incoming'), api<{ unread: number }>('/notifications'),
        ]);
        if (!get().signedIn) return;
        set({ user, summary, recent: recent.items, recipients, incoming: incoming.filter((r) => r.status === 'pending'), unread: notes.unread });
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  },

  setUser: (user) => set({ user }),
  setRecipients: (recipients) => set({ recipients }),
  showToast: (text, tone = 'ok') => {
    set({ toast: { text, tone } });
    setTimeout(() => set({ toast: null }), 3200);
  },
}), {
  name: 'mymoney.cache',
  storage: createJSONStorage(() => AsyncStorage),
  // Cached so balances show instantly and offline. The session token stays in the secure store.
  partialize: (s) => ({ user: s.user, summary: s.summary, recent: s.recent, recipients: s.recipients, meta: s.meta }),
}));
