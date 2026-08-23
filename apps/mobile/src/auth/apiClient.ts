// Three axios instances (+ a fourth, interceptor-free replay client) porting ADR-011's
// Dio-client design to RN/axios:
//   - publicClient: register, login, forgot-password — no interceptors.
//   - refreshClient: POST /auth/refresh only — no interceptors, so a 401 there can never
//     re-enter the authenticated interceptor (recursion is structurally impossible, not
//     just avoided by convention).
//   - apiClient: everything authenticated — signs every request, and on a 401 refreshes
//     once (deduped across concurrent 401s via a shared in-flight promise) and replays.
//   - replayClient: interceptor-free, used solely to replay a retried request. Replaying
//     through apiClient itself would queue the retry behind the still-resolving response
//     interceptor that is awaiting it (the exact deadlock ADR-011's Dio version found via a
//     test, not by reasoning) — so the replay carries its own Authorization header on a
//     client that has nothing to serialize behind.
import axios, {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import Constants from 'expo-constants';
import type {
  LoginRequest,
  MeResponse,
  PrivacySettingsResponse,
  ProfileResponse,
  RegisterRequest,
  RegisterResponse,
  SessionResponse,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from '@forjd/contracts';

import { clearSession, getAccessToken, getRefreshToken, saveSession } from './secureStorage';

const apiBaseUrl = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:3000';
const baseURL = `${apiBaseUrl}/api/v1`;

export const publicClient = axios.create({ baseURL });
export const refreshClient = axios.create({ baseURL });
export const apiClient = axios.create({ baseURL });
const replayClient = axios.create({ baseURL });

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean;
}

// `??=` must remain the only assignment site: every concurrent 401 awaits this same
// promise, so N simultaneous failures produce exactly one network refresh call. A second
// assignment site would let two refreshes race and one rotate a token the other is about
// to use.
let inFlightRefresh: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response = await refreshClient.post<SessionResponse>('/auth/refresh', { refreshToken });
  await saveSession(response.data);
  return response.data.accessToken;
}

apiClient.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    // A plain-object merge (not `config.headers.set(...)`) so this stays testable with a
    // plain `{ headers: {} }` fixture rather than requiring a real AxiosHeaders instance —
    // axios accepts either shape on the wire.
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    } as InternalAxiosRequestConfig['headers'];
  }
  return config;
});

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableConfig | undefined;

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retried) {
      return Promise.reject(error);
    }

    originalRequest._retried = true;

    // Two separate failure modes, deliberately not sharing a catch. Only the *refresh*
    // failing means the credentials are gone; a replay that fails afterwards fails for its
    // own reasons (offline, 500, timeout) while the session it would have used is valid and
    // freshly rotated. Wrapping both in one try/catch signed users out over a dropped
    // packet — the session survived the 401 that started all this, then got wiped by the
    // retry that was supposed to rescue it.
    let newToken: string;
    try {
      inFlightRefresh ??= refreshAccessToken().finally(() => {
        inFlightRefresh = null;
      });
      newToken = await inFlightRefresh;
    } catch {
      // ADR-011: a failed refresh clears the store and propagates the *original* error.
      // The caller asked for a profile; "your profile request failed" is true, "your
      // refresh failed" is an implementation detail they did not ask about — so `error`
      // propagates, not the refresh error.
      await clearSession();
      return Promise.reject(error);
    }

    // Outside the catch on purpose: this rejection propagates as itself, and destroys
    // nothing. The caller sees the real reason the retry failed.
    return replayClient.request({
      ...originalRequest,
      headers: {
        ...originalRequest.headers,
        Authorization: `Bearer ${newToken}`,
      } as AxiosRequestConfig['headers'],
    });
  },
);

export async function signup(input: RegisterRequest): Promise<RegisterResponse> {
  const response = await publicClient.post<RegisterResponse>('/auth/register', input);
  return response.data;
}

export async function login(input: LoginRequest): Promise<SessionResponse> {
  const response = await publicClient.post<SessionResponse>('/auth/login', input);
  return response.data;
}

export async function getMe(): Promise<MeResponse> {
  const response = await apiClient.get<MeResponse>('/users/me');
  return response.data;
}

export async function updateProfile(patch: UpdateProfileRequest): Promise<ProfileResponse> {
  const response = await apiClient.patch<ProfileResponse>('/users/me/profile', patch);
  return response.data;
}

export async function updatePrivacy(
  patch: UpdatePrivacyRequest,
): Promise<PrivacySettingsResponse> {
  const response = await apiClient.patch<PrivacySettingsResponse>('/users/me/privacy', patch);
  return response.data;
}
