import { create } from "zustand";
import type { Attribution } from "../types";

export type Theme = "system" | "light" | "dark";

/** localStorage wrapped in try/catch: private windows and blocked storage must not break the app. */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable - setting lives for this session only */
    }
  },
};

function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

interface UiState {
  selectedId: string | null;
  hoveredId: string | null;
  attribution: Attribution;
  theme: Theme;
  settingsOpen: boolean;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setAttribution: (a: Attribution) => void;
  setTheme: (t: Theme) => void;
  setSettingsOpen: (o: boolean) => void;
}

const savedTheme = (storage.get("atlas.theme") as Theme | null) ?? "system";
const savedAttr = (storage.get("atlas.attribution") as Attribution | null) ?? "primary";

export const useUi = create<UiState>((set) => ({
  selectedId: null,
  hoveredId: null,
  attribution: savedAttr === "segment" ? "segment" : "primary",
  theme: savedTheme,
  settingsOpen: false,
  select: (id) => set({ selectedId: id }),
  hover: (id) => set({ hoveredId: id }),
  setAttribution: (attribution) => {
    storage.set("atlas.attribution", attribution);
    set({ attribution });
  },
  setTheme: (theme) => {
    storage.set("atlas.theme", theme === "system" ? null : theme);
    applyTheme(theme);
    set({ theme });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
