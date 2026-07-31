import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { garmentFamily } from '@tailonix/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export { garmentFamily };

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const api = axios.create({ baseURL: `${API_BASE}/api/v1` });

export interface StoreSummary {
  id: string;
  name: string;
  isHeadquarters?: boolean;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  vatNumber: string | null;
  taxId: string | null;
}

interface AuthState {
  user: { id: string; fullName: string | null; orgRole: string | null } | null;
  organization: OrganizationSummary | null;
  stores: StoreSummary[];
  activeStoreId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setStore: (id: string) => void;
  tryRefresh: () => Promise<boolean>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      organization: null,
      stores: [],
      activeStoreId: null,
      accessToken: null,
      refreshToken: null,
      async login(email, password) {
        const { data } = await axios.post(`${API_BASE}/api/v1/auth/login`, { email, password });
        // A counter tablet lives in one branch, so default to a real store
        // rather than the HQ "all stores" view, which cannot take an order.
        const store = data.stores.find((s: StoreSummary) => !s.isHeadquarters) ?? data.stores[0];
        set({
          user: data.user,
          organization: data.user.organization,
          stores: data.stores,
          activeStoreId: store?.id ?? null,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
        });
      },
      logout: () =>
        set({
          user: null,
          organization: null,
          stores: [],
          activeStoreId: null,
          accessToken: null,
          refreshToken: null,
        }),
      setStore: (id) => set({ activeStoreId: id }),
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
    }),
    { name: 'tailonix-pos-auth' },
  ),
);

api.interceptors.request.use((config) => {
  const { accessToken, activeStoreId } = useAuth.getState();
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (activeStoreId) config.headers['X-Store-Id'] = activeStoreId;
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
    const d = e.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(d?.message)) return d.message.join('; ');
    if (d?.message) return d.message;
    return e.message;
  }
  return String(e);
}

/** Design options — labels mirror the blueprint's Saudi thobe terminology. */
export const COLLAR_OPTIONS = [
  { value: 'qallabi_1_button', en: 'Qallabi 1-Button', ar: 'قلابي زر واحد' },
  { value: 'qallabi_2_button', en: 'Qallabi 2-Button', ar: 'قلابي زرين' },
  { value: 'rounded_sada', en: 'Rounded Sada', ar: 'مدور سادة' },
  { value: 'open_v_neck', en: 'Open V-Neck', ar: 'فتحة V' },
] as const;

export const CUFF_OPTIONS = [
  { value: 'formal_kabak', en: 'Formal Kabak (cufflinks)', ar: 'كبك رسمي' },
  { value: 'buttoned_sada', en: 'Buttoned Sada', ar: 'سادة بأزرار' },
] as const;

export const POCKET_OPTIONS = [
  { value: 'upper_left_patch', en: 'Upper Left Patch', ar: 'جيب علوي أيسر' },
  { value: 'hidden_side', en: 'Sleek Hidden Side', ar: 'جانبي مخفي' },
  { value: 'mobile_slot', en: 'Reinforced Mobile Slot', ar: 'جيب جوال مقوى' },
] as const;

export const STITCHING_OPTIONS = [
  { value: 'hidden_plain', en: 'Hidden Plain', ar: 'خياطة مخفية' },
  { value: 'visible_dual_sawai', en: 'Visible Dual Sawai', ar: 'سواي مزدوج ظاهر' },
  { value: 'embroidered_zari', en: 'Embroidered Zari', ar: 'تطريز زري' },
] as const;

/** Regional cut (D-055) — read off a real tailor shop's own order form. */
export const CUT_STYLE_OPTIONS = [
  { value: 'saudi', en: 'Saudi', ar: 'سعودي' },
  { value: 'kuwaiti', en: 'Kuwaiti', ar: 'كويتي' },
  { value: 'qatari', en: 'Qatari', ar: 'قطري' },
  { value: 'other', en: 'Other', ar: 'أخرى' },
] as const;

/**
 * M1–M8 plus M9–M13 (D-055, added against a real tailor shop's own paper
 * order form). Thobe/Bisht/Shirt — the "robe" family. m5HipWidth is labeled
 * "Hip" now that m9Waist exists as the dedicated waist point.
 */
export const MEASUREMENT_POINTS = [
  { key: 'm1TotalLength', code: 'M1', en: 'Total Length', ar: 'الطول' },
  { key: 'm2ShoulderWidth', code: 'M2', en: 'Shoulder Width', ar: 'الكتف' },
  { key: 'm3SleeveLength', code: 'M3', en: 'Sleeve Length', ar: 'الكم' },
  { key: 'm4ChestCirc', code: 'M4', en: 'Chest', ar: 'الصدر' },
  { key: 'm5HipWidth', code: 'M5', en: 'Hip', ar: 'الورك' },
  { key: 'm6NeckDiameter', code: 'M6', en: 'Neck', ar: 'الرقبة' },
  { key: 'm7WristOpening', code: 'M7', en: 'Wrist Opening', ar: 'الوسع' },
  { key: 'm8SkirtPerimeter', code: 'M8', en: 'Hem (Ghera)', ar: 'الذيل' },
  { key: 'm9Waist', code: 'M9', en: 'Waist', ar: 'الوسط' },
  { key: 'm10RoundShoulder', code: 'M10', en: 'Round Shoulder', ar: 'الكتف المدور' },
  { key: 'm11MidHand', code: 'M11', en: 'Mid of Hand', ar: 'منتصف اليد' },
  { key: 'm12PlateLength', code: 'M12', en: 'Plate Length', ar: 'طول اللوح' },
  { key: 'm13HalfChest', code: 'M13', en: 'Half Chest', ar: 'نصف الصدر' },
] as const;

/** T1–T7 — Trousers' own points (D-054). No sleeve/neck/hem in the M1-M8 sense. */
export const TROUSER_MEASUREMENT_POINTS = [
  { key: 't1Waist', code: 'T1', en: 'Waist', ar: 'الخصر' },
  { key: 't2Hip', code: 'T2', en: 'Hip', ar: 'الورك' },
  { key: 't3Inseam', code: 'T3', en: 'Inseam', ar: 'الداخلي' },
  { key: 't4Outseam', code: 'T4', en: 'Outseam / Total Length', ar: 'الطول الكلي' },
  { key: 't5Thigh', code: 'T5', en: 'Thigh', ar: 'الفخذ' },
  { key: 't6Knee', code: 'T6', en: 'Knee', ar: 'الركبة' },
  { key: 't7AnkleOpening', code: 'T7', en: 'Ankle Opening', ar: 'فتحة الأسفل' },
] as const;

export type RobeMeasurementKey = (typeof MEASUREMENT_POINTS)[number]['key'];
export type TrouserMeasurementKey = (typeof TROUSER_MEASUREMENT_POINTS)[number]['key'];
export type MeasurementKey = RobeMeasurementKey | TrouserMeasurementKey;

/** Which point set + required fields apply to a garment's family. */
export function measurementPointsFor(garmentType: string) {
  return garmentFamily(garmentType) === 'trousers' ? TROUSER_MEASUREMENT_POINTS : MEASUREMENT_POINTS;
}

/** The minimum fields the yield formula needs for this family (D-054). */
export function requiredMeasurementKeysFor(garmentType: string): MeasurementKey[] {
  return garmentFamily(garmentType) === 'trousers' ? ['t4Outseam'] : ['m1TotalLength', 'm3SleeveLength'];
}
