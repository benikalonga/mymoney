import Constants from 'expo-constants';

function inferBase() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:4100/v1`;
}
export const API_URL = inferBase();

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

let token: string | null = null;
let onUnauthorized = () => {};
let onReachable: (reachable: boolean) => void = () => {};

export const setAuthToken = (value: string | null) => { token = value; };
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };
/** Connection status follows real API responses, not what the phone reports. */
export const setReachabilityHandler = (fn: (reachable: boolean) => void) => { onReachable = fn; };

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    onReachable(false);
    throw new ApiError(0, 'NETWORK', 'We could not reach MyMoney. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  onReachable(true);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && data?.error?.code === 'UNAUTHORIZED') onUnauthorized();
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong');
  }
  return data as T;
}
