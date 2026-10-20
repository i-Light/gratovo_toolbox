/**
 * The only build values the main process receives (electron.vite.config.ts allows no other
 * prefix). Empty or missing means the app runs unconfigured.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_SUPABASE_URL?: string;
  readonly MAIN_VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
