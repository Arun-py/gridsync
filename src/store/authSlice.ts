/**
 * Auth state.
 *
 * `permissions` mirrors the server's matrix and drives which controls render.
 * It is a UX convenience ONLY — the server re-checks every privileged call, so
 * a tampered client gains nothing.
 */

import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { User } from '@shared/types';
import { authApi, errorMessage, getToken, setToken } from '../lib/api';

export interface AuthState {
  user: User | null;
  permissions: string[];
  status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;
  googleEnabled: boolean;
}

const initialState: AuthState = {
  user: null,
  permissions: [],
  // Start as loading when a token exists, so protected routes wait for the
  // session check instead of bouncing to /login and back.
  status: getToken() ? 'loading' : 'unauthenticated',
  error: null,
  googleEnabled: false,
};

export const restoreSession = createAsyncThunk('auth/restore', async (_, { rejectWithValue }) => {
  if (!getToken()) return rejectWithValue('No session');
  try {
    return await authApi.me();
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const login = createAsyncThunk(
  'auth/login',
  async (payload: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const data = await authApi.login(payload.email, payload.password);
      setToken(data.token);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

export const signup = createAsyncThunk(
  'auth/signup',
  async (payload: { name: string; email: string; password: string }, { rejectWithValue }) => {
    try {
      const data = await authApi.signup(payload.name, payload.email, payload.password);
      setToken(data.token);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

export const googleLogin = createAsyncThunk(
  'auth/google',
  async (payload: { credential?: string; code?: string }, { rejectWithValue }) => {
    try {
      const data = await authApi.google(payload);
      setToken(data.token);
      return data;
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  },
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout(state) {
      setToken(null);
      state.user = null;
      state.permissions = [];
      state.status = 'unauthenticated';
      state.error = null;
    },
    clearError(state) {
      state.error = null;
    },
    setGoogleEnabled(state, action: PayloadAction<boolean>) {
      state.googleEnabled = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(restoreSession.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.permissions = action.payload.permissions;
        state.googleEnabled = action.payload.googleEnabled;
        state.status = 'authenticated';
      })
      .addCase(restoreSession.rejected, (state) => {
        state.user = null;
        state.permissions = [];
        state.status = 'unauthenticated';
      });

    for (const thunk of [login, signup, googleLogin]) {
      builder
        .addCase(thunk.pending, (state) => {
          state.status = 'loading';
          state.error = null;
        })
        .addCase(thunk.fulfilled, (state, action) => {
          const payload = action.payload as { user: User; permissions: string[] };
          state.user = payload.user;
          state.permissions = payload.permissions;
          state.status = 'authenticated';
          state.error = null;
        })
        .addCase(thunk.rejected, (state, action) => {
          state.status = 'unauthenticated';
          state.error = (action.payload as string) ?? 'Sign-in failed.';
        });
    }
  },
});

export const { logout, clearError, setGoogleEnabled } = authSlice.actions;
export default authSlice.reducer;
