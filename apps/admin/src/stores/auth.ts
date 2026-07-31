import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

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
  /** Set only via startImpersonatedSession — drives the "you are impersonating" banner. */
  isImpersonating: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  tryRefresh: () => Promise<boolean>;
  setActiveStore: (id: string) => void;
  /** Impersonation handoff (D-060) — populates the session from a platform-admin-issued token instead of a password login. */
  startImpersonatedSession: (accessToken: string, user: AuthUser, stores: StoreSummary[]) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      stores: [],
      accessToken: null,
      refreshToken: null,
      activeStoreId: null,
      isImpersonating: false,

      async login(email, password) {
        const { data } = await axios.post(`${API_BASE}/api/v1/auth/login`, { email, password });
        const isHq = data.user.orgRole === 'hq_admin';
        set({
          user: data.user,
          stores: data.stores,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          activeStoreId: isHq ? 'all' : (data.stores[0]?.id ?? null),
          isImpersonating: false,
        });
      },

      logout() {
        const { refreshToken } = get();
        if (refreshToken) {
          void axios.post(`${API_BASE}/api/v1/auth/logout`, { refreshToken }).catch(() => undefined);
        }
        set({
          user: null,
          stores: [],
          accessToken: null,
          refreshToken: null,
          activeStoreId: null,
          isImpersonating: false,
        });
      },

      startImpersonatedSession(accessToken, user, stores) {
        const isHq = user.orgRole === 'hq_admin';
        // No refresh token: impersonation tokens are deliberately short-lived
        // and non-renewable (see PlatformService.impersonate's 30-minute
        // cap, D-060) — the session ends by expiring, not by logout alone.
        set({
          user,
          stores,
          accessToken,
          refreshToken: null,
          activeStoreId: isHq ? 'all' : (stores[0]?.id ?? null),
          isImpersonating: true,
        });
      },

      async tryRefresh() {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const { data } = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken });
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
