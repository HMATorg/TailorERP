/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the API in production (e.g. https://api.example.com). Falls back to a relative path for local dev, where Vite proxies /api. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
