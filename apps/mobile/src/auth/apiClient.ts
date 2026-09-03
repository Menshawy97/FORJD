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
  AvatarUploadResponse,
  CreateCustomFoodRequest,
  CreateExerciseRequest,
  CreateSavedMealRequest,
  ExerciseCatalogueResponse,
  ExerciseResponse,
  FoodListResponse,
  FoodResponse,
  LoginRequest,
  LogFoodRequest,
  LogSavedMealRequest,
  MacroGoalsResponse,
  MeResponse,
  NutritionLogEntryResponse,
  NutritionLogListResponse,
  PrivacySettingsResponse,
  ProfileResponse,
  PublicProfileResponse,
  RegisterRequest,
  RegisterResponse,
  SavedMealListResponse,
  SavedMealResponse,
  SessionResponse,
  SetMacroGoalsRequest,
  UpdateExerciseRequest,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
  CreateWorkoutTemplateRequest,
  WorkoutTemplateListResponse,
  WorkoutSessionListResponse,
  WorkoutSessionResponse,
  WorkoutSessionUploadRequest,
  WorkoutTemplateResponse,
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
      // propagates, not the refresh error. `{ expired: true }` is the one bit that tells
      // welcome.tsx (via consumeSessionExpired) this was a forced sign-out, not the user
      // tapping Log out, so it can show "Your session expired" instead of nothing.
      await clearSession({ expired: true });
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

/**
 * ADR-019: avatar upload goes through the backend's `StorageProvider`, never a Supabase SDK
 * call from the client (CLAUDE.md rule 11) — this is a plain authenticated multipart POST.
 *
 * Route, field name and response shape match `UsersController.uploadAvatar`
 * (`apps/api/src/users/users.controller.ts`) exactly: `POST /users/me/avatar`, a
 * `FileInterceptor('file')` multer field, answering `AvatarUploadResponse` (`{ avatarUrl:
 * string }`) from `avatarUploadResponseSchema` in `@forjd/contracts`.
 */
export async function uploadAvatar(imageUri: string): Promise<AvatarUploadResponse> {
  const filename = imageUri.split('/').pop() ?? 'avatar.jpg';
  const extensionMatch = /\.(\w+)$/.exec(filename);
  const mimeType = extensionMatch ? `image/${extensionMatch[1].toLowerCase()}` : 'image/jpeg';

  const formData = new FormData();
  // React Native's FormData accepts this `{ uri, name, type }` shape for a file field — it is
  // not a real `Blob`, hence the cast; this is the standard RN idiom for a multipart upload.
  formData.append('file', { uri: imageUri, name: filename, type: mimeType } as unknown as Blob);

  const response = await apiClient.post<AvatarUploadResponse>('/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function updatePrivacy(
  patch: UpdatePrivacyRequest,
): Promise<PrivacySettingsResponse> {
  const response = await apiClient.patch<PrivacySettingsResponse>('/users/me/privacy', patch);
  return response.data;
}

export async function getAthlete(userId: string): Promise<PublicProfileResponse> {
  const response = await apiClient.get<PublicProfileResponse>(`/athletes/${userId}`);
  return response.data;
}

export async function getExerciseCatalogue(): Promise<ExerciseCatalogueResponse> {
  const response = await apiClient.get<ExerciseCatalogueResponse>('/exercises/catalogue');
  return response.data;
}

export async function createExercise(body: CreateExerciseRequest): Promise<ExerciseResponse> {
  const response = await apiClient.post<ExerciseResponse>('/exercises', body);
  return response.data;
}

export async function updateExercise(
  id: string,
  body: UpdateExerciseRequest,
): Promise<ExerciseResponse> {
  const response = await apiClient.patch<ExerciseResponse>(`/exercises/${id}`, body);
  return response.data;
}

/** `PUT`/`DELETE .../favourite` both answer `204 No Content` — see exercises.controller.ts. */
export async function setExerciseFavourite(id: string, favourite: boolean): Promise<void> {
  await apiClient.request({
    method: favourite ? 'put' : 'delete',
    url: `/exercises/${id}/favourite`,
  });
}

/** `DELETE /exercises/:id` answers `204 No Content` — a soft delete on the server. */
export async function deleteExercise(id: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/exercises/${id}` });
}

// ---------------------------------------------------------------------------------------------
// Nutrition (Phase 2.5, ADR-023)
// ---------------------------------------------------------------------------------------------

export async function searchFoods(q: string, category?: string): Promise<FoodListResponse> {
  const response = await apiClient.get<FoodListResponse>('/nutrition/foods', { params: { q, category } });
  return response.data;
}

export async function getFood(id: string): Promise<FoodResponse> {
  const response = await apiClient.get<FoodResponse>(`/nutrition/foods/${id}`);
  return response.data;
}

export async function createCustomFood(body: CreateCustomFoodRequest): Promise<FoodResponse> {
  const response = await apiClient.post<FoodResponse>('/nutrition/foods', body);
  return response.data;
}

/** `204 No Content` — a soft delete on the server. */
export async function deleteCustomFood(id: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/nutrition/foods/${id}` });
}

/** Rejects with a 404 `AxiosError` before any goals have ever been saved -- the caller shows an honest "set your goals" prompt rather than treating a caught error as a network failure. */
export async function getMacroGoals(): Promise<MacroGoalsResponse> {
  const response = await apiClient.get<MacroGoalsResponse>('/nutrition/macro-goals');
  return response.data;
}

export async function setMacroGoals(body: SetMacroGoalsRequest): Promise<MacroGoalsResponse> {
  const response = await apiClient.put<MacroGoalsResponse>('/nutrition/macro-goals', body);
  return response.data;
}

export async function listSavedMeals(): Promise<SavedMealListResponse> {
  const response = await apiClient.get<SavedMealListResponse>('/nutrition/meals');
  return response.data;
}

export async function createSavedMeal(body: CreateSavedMealRequest): Promise<SavedMealResponse> {
  const response = await apiClient.post<SavedMealResponse>('/nutrition/meals', body);
  return response.data;
}

export async function deleteSavedMeal(id: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/nutrition/meals/${id}` });
}

export async function listNutritionLog(date: string): Promise<NutritionLogListResponse> {
  const response = await apiClient.get<NutritionLogListResponse>('/nutrition/log', { params: { date } });
  return response.data;
}

export async function logFood(body: LogFoodRequest): Promise<NutritionLogEntryResponse> {
  const response = await apiClient.post<NutritionLogEntryResponse>('/nutrition/log', body);
  return response.data;
}

export async function logSavedMeal(body: LogSavedMealRequest): Promise<NutritionLogListResponse> {
  const response = await apiClient.post<NutritionLogListResponse>('/nutrition/log/meal', body);
  return response.data;
}

export async function deleteLogEntry(id: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/nutrition/log/${id}` });
}

export async function deleteLogGroup(groupId: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/nutrition/log/group/${groupId}` });
}

// ---------------------------------------------------------------------------------------------
// Workouts -- templates (Phase 3G), plus the session upload (Phase 3I) and the two session
// reads (Phase 3J) that let a finished workout be shown back to the user.
// ---------------------------------------------------------------------------------------------

export async function listWorkoutTemplates(): Promise<WorkoutTemplateListResponse> {
  const response = await apiClient.get<WorkoutTemplateListResponse>('/workouts/templates');
  return response.data;
}

export async function getWorkoutTemplate(id: string): Promise<WorkoutTemplateResponse> {
  const response = await apiClient.get<WorkoutTemplateResponse>(`/workouts/templates/${id}`);
  return response.data;
}

export async function createWorkoutTemplate(
  body: CreateWorkoutTemplateRequest,
): Promise<WorkoutTemplateResponse> {
  const response = await apiClient.post<WorkoutTemplateResponse>('/workouts/templates', body);
  return response.data;
}

/** `DELETE /workouts/templates/:id` answers `204 No Content` -- a soft delete on the server. */
export async function deleteWorkoutTemplate(id: string): Promise<void> {
  await apiClient.request({ method: 'delete', url: `/workouts/templates/${id}` });
}

/**
 * `POST /workouts/sessions` -- the sync call that happens *after* a workout, never during one
 * (CLAUDE.md rule 6). Only `store/workout-session.ts`'s queue drain calls this; the live screen
 * itself must never reach the network.
 *
 * The body carries a client-generated `id` which is the **idempotency key**: a retry after a
 * dropped response is a second POST with the same id, and the service answers with the existing
 * session rather than creating a second one. That is what makes retrying safe.
 */
export async function uploadWorkoutSession(body: WorkoutSessionUploadRequest): Promise<void> {
  await apiClient.post('/workouts/sessions', body);
}

/**
 * Query for `GET /workouts/sessions`. Spelled out here rather than reusing
 * `WorkoutSessionListQuery` from the contracts, because that type is the schema's *output* --
 * where `limit` has already been defaulted and is therefore required. What a caller sends is
 * the input side, where both fields are optional; omitting `limit` is how the client asks the
 * server for its own default rather than guessing at one.
 */
export interface WorkoutSessionListQueryInput {
  cursor?: string;
  limit?: number;
}

/**
 * `GET /workouts/sessions` -- the workout history list, newest first.
 *
 * The counterpart read to `uploadWorkoutSession`. Callers that want only the most recent
 * session (Train's "Previous Workout" card) pass `{ limit: 1 }` rather than fetching the
 * default page and discarding all but one row of it.
 */
export async function listWorkoutSessions(
  query: WorkoutSessionListQueryInput = {},
): Promise<WorkoutSessionListResponse> {
  const response = await apiClient.get<WorkoutSessionListResponse>('/workouts/sessions', {
    params: query,
  });
  return response.data;
}

/**
 * `GET /workouts/sessions/:id` -- one session in full, with every exercise and set.
 *
 * The list response is a summary and carries no exercises, so anything that needs what was
 * actually performed -- the finished-workout summary screen, repeating a previous workout --
 * reads the session through here.
 */
export async function getWorkoutSession(id: string): Promise<WorkoutSessionResponse> {
  const response = await apiClient.get<WorkoutSessionResponse>(`/workouts/sessions/${id}`);
  return response.data;
}
