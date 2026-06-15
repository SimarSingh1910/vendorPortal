/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NODE_ENV: 'dev' | 'staging' | 'prod';
  readonly VITE_API_BASE_URL: string;
  /** Optional override for the idle auto-logout (ms). Defaults to 30 min. */
  readonly VITE_IDLE_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
