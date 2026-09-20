/**
 * Redux store — low-frequency state only.
 *
 * Live telemetry deliberately lives outside Redux (see
 * src/lib/telemetry/TelemetryContext.tsx) because dispatching 1 Hz frames
 * through the store would re-run every selector in the app every second.
 */

import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';

import authReducer from './authSlice';
import uiReducer from './uiSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** Permission check for conditional rendering. The server enforces regardless. */
export function usePermission(permission: string): boolean {
  return useAppSelector((s) => s.auth.permissions.includes(permission));
}

export function useCurrentUser() {
  return useAppSelector((s) => s.auth.user);
}

export function useTheme() {
  return useAppSelector((s) => s.ui.theme);
}
