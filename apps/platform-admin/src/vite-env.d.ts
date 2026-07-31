/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of apps/admin — the impersonation handoff link points here (D-060). */
  readonly VITE_ADMIN_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
