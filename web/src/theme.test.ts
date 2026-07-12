import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_OPTIONS,
  THEME_PICKER_OPTIONS,
  THEME_STORAGE_KEY,
  THEME_TOKENS,
  normalizeTheme,
  readStoredTheme,
} from "./theme";

describe("theme preferences", () => {
  it("offers the default, midnight, and saddle leather themes", () => {
    expect(THEME_OPTIONS.map(option => option.id)).toEqual([
      "light",
      "midnight",
      "saddle",
    ]);
    expect(THEME_OPTIONS.map(option => option.label)).toEqual([
      "Default Light",
      "Midnight",
      "Saddle Leather",
    ]);
    expect(THEME_OPTIONS.map(option => option.icon)).toEqual([
      "sun",
      "moon",
      "circle",
    ]);
    expect(THEME_OPTIONS.map(option => option.ariaLabel)).toEqual([
      "Switch to default light theme",
      "Switch to midnight theme",
      "Switch to saddle leather theme",
    ]);
    expect(THEME_PICKER_OPTIONS.map(option => option.id)).toEqual([
      "saddle",
      "light",
      "midnight",
    ]);
  });

  it("normalizes unknown stored values to the default light theme", () => {
    expect(normalizeTheme("midnight")).toBe("midnight");
    expect(normalizeTheme("saddle")).toBe("saddle");
    expect(normalizeTheme("unknown")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
  });

  it("reads only a supported theme from storage", () => {
    const storage = {
      getItem: (key: string) => key === THEME_STORAGE_KEY ? "saddle" : null,
    };
    expect(readStoredTheme(storage)).toBe("saddle");
    expect(THEME_TOKENS.midnight["--theme-action-bg"]).toBe("#2563eb");
    expect(THEME_TOKENS.saddle["--theme-action-bg"]).toBe("#b88a52");
  });
});
