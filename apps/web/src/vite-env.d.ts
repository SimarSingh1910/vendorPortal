/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NODE_ENV: 'dev' | 'staging' | 'prod';
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
