import axios, { AxiosError } from 'axios';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const api = axios.create({ baseURL: '/api/v1' });

interface PlatformAuthState {
  user: { id: string; email: string; fullName: string | null; adminLevel: string } | null;
  accessToken: string | null;
  setSession: (data: {
    user: PlatformAuthState['user'];
    accessToken: string;
  }) => void;
  logout: () => void;
}

export const useAuth = create<PlatformAuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      setSession: (data) => set({ user: data.user, accessToken: data.accessToken }),
      logout: () => set({ user: null, accessToken: null }),
    }),
    { name: 'tailonix-platform-auth' },
  ),
);

api.interceptors.request.use((config) => {
  const { accessToken } = useAuth.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(undefined, (error: AxiosError) => {
  if (error.response?.status === 401) useAuth.getState().logout();
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
