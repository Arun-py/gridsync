/**
 * UI preferences and transient notifications.
 *
 * Preferences persist to localStorage so language and layout survive a reload.
 * Every access is wrapped: localStorage throws in some private-browsing modes,
 * and a preference is never worth crashing the app for.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { Severity } from '@shared/types';

export type Language = 'en' | 'ta';
export type Theme = 'dark' | 'light';

export interface Toast {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  /** Alert id, when this toast was raised by a CRITICAL alert. */
  alertId?: string;
  createdAt: number;
}

export interface UiState {
  sidebarCollapsed: boolean;
  language: Language;
  theme: Theme;
  toasts: Toast[];
  /** Alert ids already surfaced, so one alert cannot pop repeatedly. */
  notifiedAlertIds: string[];
}

const PREFS_KEY = 'gridsync.prefs';

function loadPrefs(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}

function savePrefs(state: UiState): void {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        sidebarCollapsed: state.sidebarCollapsed,
        language: state.language,
        theme: state.theme,
      }),
    );
  } catch {
    /* preferences simply will not persist */
  }
}

/** No saved preference yet: honour the OS/browser setting rather than forcing dark. */
function preferredTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const prefs = loadPrefs();

const initialState: UiState = {
  sidebarCollapsed: prefs.sidebarCollapsed ?? false,
  language: prefs.language ?? 'en',
  theme: prefs.theme ?? preferredTheme(),
  toasts: [],
  notifiedAlertIds: [],
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      savePrefs(state);
    },
    setLanguage(state, action: PayloadAction<Language>) {
      state.language = action.payload;
      savePrefs(state);
    },
    setTheme(state, action: PayloadAction<Theme>) {
      state.theme = action.payload;
      savePrefs(state);
    },
    toggleTheme(state) {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      savePrefs(state);
    },
    pushToast: {
      reducer(state, action: PayloadAction<Toast>) {
        // Cap the stack: a scenario that raises many alerts at once must not
        // bury the screen in notifications.
        state.toasts = [action.payload, ...state.toasts].slice(0, 4);
        if (action.payload.alertId) {
          state.notifiedAlertIds = [action.payload.alertId, ...state.notifiedAlertIds].slice(0, 200);
        }
      },
      prepare(toast: Omit<Toast, 'id' | 'createdAt'>) {
        return {
          payload: {
            ...toast,
            id: `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            createdAt: Date.now(),
          },
        };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    clearToasts(state) {
      state.toasts = [];
    },
  },
});

export const { toggleSidebar, setLanguage, setTheme, toggleTheme, pushToast, dismissToast, clearToasts } =
  uiSlice.actions;
export default uiSlice.reducer;
