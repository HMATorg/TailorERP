import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/auth';

export const api = axios.create({ baseURL: '/api/v1' });

api.interceptors.request.use((config) => {
  const { accessToken, activeStoreId } = useAuthStore.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (activeStoreId && activeStoreId !== 'all') config.headers['X-Store-Id'] = activeStoreId;
  return config;
});

let refreshing: Promise<boolean> | null = null;

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retry) {
    original._retry = true;
    refreshing = refreshing ?? useAuthStore.getState().tryRefresh();
    const ok = await refreshing;
    refreshing = null;
    if (ok) return api(original);
    useAuthStore.getState().logout();
  }
  return Promise.reject(error);
});

/** Extracts a human-readable message from an API error. */
export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('; ');
    if (data?.message) return data.message;
    return e.message;
  }
  return String(e);
}
