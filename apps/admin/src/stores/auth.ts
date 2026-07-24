import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

export interface StoreSummary {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'closed';
  isHeadquarters?: boolean;
  role?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  orgRole: 'hq_admin' | null;
  organization: { id: string; name: string };
  storeRoles: { storeId: string; role: string }[];
}

interface AuthState {
  user: AuthUser | null;
  stores: StoreSummary[];
  accessToken: string | null;
  refreshToken: string | null;
  /** 'all' = HQ overview (aggregated), otherwise a store id */
  activeStoreId: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  tryRefresh: () => Promise<boolean>;
  setActiveStore: (id: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      stores: [],
      accessToken: null,
      refreshToken: null,
      activeStoreId: null,

      async login(email, password) {
        const { data } = await axios.post('/api/v1/auth/login', { email, password });
        const isHq = data.user.orgRole === 'hq_admin';
        set({
          user: data.user,
          stores: data.stores,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          activeStoreId: isHq ? 'all' : (data.stores[0]?.id ?? null),
        });
      },

      logout() {
        const { refreshToken } = get();
        if (refreshToken) {
          void axios.post('/api/v1/auth/logout', { refreshToken }).catch(() => undefined);
        }
        set({ user: null, stores: [], accessToken: null, refreshToken: null, activeStoreId: null });
      },

      async tryRefresh() {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken });
          set({ accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        } catch {
          return false;
        }
      },

      setActiveStore(id) {
        set({ activeStoreId: id });
      },
    }),
    { name: 'tailonix-admin-auth' },
  ),
);
