import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const api = axios.create({ baseURL: '/api/v1' });

interface CustomerAuthState {
  customer: { id: string; fullName: string; language: string } | null;
  accessToken: string | null;
  refreshToken: string | null;
  setSession: (data: {
    customer: CustomerAuthState['customer'];
    accessToken: string;
    refreshToken: string;
  }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuth = create<CustomerAuthState>()(
  persist(
    (set) => ({
      customer: null,
      accessToken: null,
      refreshToken: null,
      setSession: (data) =>
        set({
          customer: data.customer,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      logout: () => set({ customer: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'tailonix-pwa-auth' },
  ),
);

api.interceptors.request.use((config) => {
  const { accessToken } = useAuth.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retry) {
    original._retry = true;
    const { refreshToken, setTokens, logout } = useAuth.getState();
    if (refreshToken) {
      try {
        const { data } = await axios.post('/api/v1/customer/auth/refresh', { refreshToken });
        setTokens(data.accessToken, data.refreshToken);
        return api(original);
      } catch {
        logout();
      }
    } else {
      logout();
    }
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
