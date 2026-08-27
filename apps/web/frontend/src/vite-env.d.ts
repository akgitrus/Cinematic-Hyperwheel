/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_URL?: string;
  readonly VITE_AUTHOR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Minimal ambient typing for the View Transitions API (used by
// useHeaderMode.ts) - not yet part of this project's pinned TypeScript
// version's bundled DOM lib, despite being Baseline-supported across
// browsers as of 2026. Only the members actually used are declared;
// this block to be removed once the project's TS version ships its own types
interface ViewTransition {
  readonly finished: Promise<void>;
  readonly ready: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition;
}