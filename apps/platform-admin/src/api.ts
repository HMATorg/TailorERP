import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const api = axios.create({ baseURL: '/api/v1' });

interface PlatformAuthState {
  user: { id: string; email: string; fullName: string | null; adminLevel: string } | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (data: {
    user: PlatformAuthState['user'];
    accessToken: string;
    refreshToken: string;
  }) => void;
  logout: () => void;
  tryRefresh: () => Promise<boolean>;
}

export const useAuth = create<PlatformAuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setSession: (data) =>
        set({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken }),
      logout: () => set({ user: null, accessToken: null, refreshToken: null }),
      async tryRefresh() {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const { data } = await axios.post('/api/v1/auth/platform/refresh', { refreshToken });
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        } catch {
          return false;
        }
      },
    }),
    { name: 'tailonix-platform-auth' },
  ),
);

api.interceptors.request.use((config) => {
  const { accessToken } = useAuth.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<boolean> | null = null;

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retry) {
    original._retry = true;
    refreshing = refreshing ?? useAuth.getState().tryRefresh();
    const ok = await refreshing;
    refreshing = null;
    if (ok) return api(original);
    useAuth.getState().logout();
  }
  return Promise.reject(error);
});

export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('; ');
    if (data?.message) return data.message;
    return e.message;
  }
  return String(e);
}
