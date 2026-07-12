export type ThemeId = "light" | "midnight" | "saddle";
export type ThemeIcon = "sun" | "moon" | "circle";
export type ThemeOption = {
  id: ThemeId;
  label: string;
  icon: ThemeIcon;
  ariaLabel: string;
};

export const DEFAULT_THEME: ThemeId = "light";
export const THEME_STORAGE_KEY = "gigab2b-theme";

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "light", label: "Default Light", icon: "sun", ariaLabel: "Switch to default light theme" },
  { id: "midnight", label: "Midnight", icon: "moon", ariaLabel: "Switch to midnight theme" },
  { id: "saddle", label: "Saddle Leather", icon: "circle", ariaLabel: "Switch to saddle leather theme" },
];

type ThemeTokens = Record<string, string>;

const LIGHT_TOKENS: ThemeTokens = {
  "--theme-page-bg": "#ffffff",
  "--theme-surface": "#ffffff",
  "--theme-surface-soft": "#fafafa",
  "--theme-surface-muted": "#f5f5f5",
  "--theme-border": "#e0e0e0",
  "--theme-border-soft": "#f0f0f0",
  "--theme-text-primary": "#333333",
  "--theme-text-secondary": "#666666",
  "--theme-text-muted": "#999999",
  "--theme-action-bg": "#000000",
  "--theme-action-hover": "#333333",
  "--theme-action-fg": "#ffffff",
  "--theme-link": "#1565c0",
  "--theme-focus": "#1565c0",
  "--theme-overlay": "rgba(0,0,0,0.45)",
  "--theme-info-bg": "#f0f7ff",
  "--theme-info-border": "#cfe2ff",
  "--theme-info-text": "#1565c0",
  "--theme-danger-bg": "#ffebee",
  "--theme-danger-border": "#ffcdd2",
  "--theme-danger-text": "#c62828",
  "--theme-warning-bg": "#fff8e1",
  "--theme-warning-border": "#ffe0b2",
  "--theme-warning-text": "#e65100",
  "--theme-success-bg": "#f1f8e9",
  "--theme-success-border": "#c5e1a5",
  "--theme-success-text": "#33691e",
};

const MIDNIGHT_TOKENS: ThemeTokens = {
  "--theme-page-bg": "#0f141a",
  "--theme-surface": "#121a23",
  "--theme-surface-soft": "#18222d",
  "--theme-surface-muted": "#1d2a37",
  "--theme-border": "#2d3b4a",
  "--theme-border-soft": "#24313e",
  "--theme-text-primary": "#f4f7fb",
  "--theme-text-secondary": "#c2cedb",
  "--theme-text-muted": "#8ea0b3",
  "--theme-action-bg": "#2563eb",
  "--theme-action-hover": "#1d4ed8",
  "--theme-action-fg": "#ffffff",
  "--theme-link": "#60a5fa",
  "--theme-focus": "#60a5fa",
  "--theme-overlay": "rgba(0,0,0,0.7)",
  "--theme-info-bg": "#172a46",
  "--theme-info-border": "#2b5f9e",
  "--theme-info-text": "#93c5fd",
  "--theme-danger-bg": "#3b1f27",
  "--theme-danger-border": "#7f3345",
  "--theme-danger-text": "#fda4af",
  "--theme-warning-bg": "#3f321a",
  "--theme-warning-border": "#806226",
  "--theme-warning-text": "#fcd34d",
  "--theme-success-bg": "#1c3523",
  "--theme-success-border": "#3c7548",
  "--theme-success-text": "#86efac",
};

const SADDLE_TOKENS: ThemeTokens = {
  "--theme-page-bg": "#f5eadb",
  "--theme-surface": "#fffaf2",
  "--theme-surface-soft": "#f7ecdc",
  "--theme-surface-muted": "#eee0cd",
  "--theme-border": "#d6b98d",
  "--theme-border-soft": "#e6d2b5",
  "--theme-text-primary": "#3a2618",
  "--theme-text-secondary": "#704f33",
  "--theme-text-muted": "#9a7756",
  "--theme-action-bg": "#b88a52",
  "--theme-action-hover": "#9f713d",
  "--theme-action-fg": "#ffffff",
  "--theme-link": "#8c5a2b",
  "--theme-focus": "#b88a52",
  "--theme-overlay": "rgba(45,28,15,0.48)",
  "--theme-info-bg": "#f2e4d0",
  "--theme-info-border": "#d6b98d",
  "--theme-info-text": "#805729",
  "--theme-danger-bg": "#f9e5e0",
  "--theme-danger-border": "#dfaa9b",
  "--theme-danger-text": "#a33d2f",
  "--theme-warning-bg": "#faeed5",
  "--theme-warning-border": "#e4c582",
  "--theme-warning-text": "#9a631e",
  "--theme-success-bg": "#e8f0df",
  "--theme-success-border": "#b6ce99",
  "--theme-success-text": "#4f7135",
};

export const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  light: LIGHT_TOKENS,
  midnight: MIDNIGHT_TOKENS,
  saddle: SADDLE_TOKENS,
};

export const THEME_PICKER_OPTIONS: ThemeOption[] = [
  THEME_OPTIONS[2],
  THEME_OPTIONS[0],
  THEME_OPTIONS[1],
];

const THEME_IDS = new Set<ThemeId>(THEME_OPTIONS.map(option => option.id));

export function normalizeTheme(value: string | null | undefined): ThemeId {
  return value && THEME_IDS.has(value as ThemeId) ? value as ThemeId : DEFAULT_THEME;
}

export function readStoredTheme(storage?: Pick<Storage, "getItem">): ThemeId {
  try {
    const source = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    return normalizeTheme(source?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(theme: ThemeId, storage?: Pick<Storage, "setItem">): void {
  try {
    const target = storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
    target?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing or disabled storage should not block theme switching.
  }
}
