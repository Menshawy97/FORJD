import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/core/network/api_failure.dart';
import 'package:forjd/core/network/dio_client.dart';
import 'package:forjd/core/network/session_ports.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';

/// Exchanges a refresh token for a new session, and nothing else.
///
/// Deliberately not a method on [AuthRepository]: the interceptor inside `apiDio` needs a
/// [TokenRefresher], and a repository that also holds `apiDio` would close the loop
/// apiDio -> tokenRefresher -> repository -> apiDio, which Riverpod rejects as a circular
/// dependency. Keeping the refresher dependent only on the interceptor-free refresh client
/// keeps the graph acyclic and matches what it actually needs.
class SessionRefresher implements TokenRefresher {
  const SessionRefresher(this._refreshClient);

  final Dio _refreshClient;

  @override
  Future<AuthTokens> refresh(String refreshToken) => _guard(() async {
    final response = await _refreshClient.post<dynamic>(
      '/auth/refresh',
      data: {'refreshToken': refreshToken},
    );

    return SessionDto.fromJson(response.data as Map<String, dynamic>)
        .toTokens();
  });
}

/// The auth and profile endpoints, and the boundary where Dio stops.
///
/// Every method throws [ApiFailure] and never a [DioException], so nothing above this layer
/// has to know the app uses Dio at all.
class AuthRepository {
  const AuthRepository({required Dio publicClient, required Dio apiClient})
    : _public = publicClient,
      _api = apiClient;

  final Dio _public;
  final Dio _api;

  Future<RegisterResultDto> register({
    required String email,
    required String password,
    String? displayName,
  }) => _guard(() async {
    final response = await _public.post<dynamic>(
      '/auth/register',
      data: {
        'email': email,
        'password': password,
        // Omitted rather than sent as null: the contract makes it optional, and an explicit
        // null is a different thing to validate.
        if (displayName != null && displayName.isNotEmpty)
          'displayName': displayName,
      },
    );

    return RegisterResultDto.fromJson(response.data as Map<String, dynamic>);
  });

  Future<SessionDto> login({required String email, required String password}) =>
      _guard(() async {
        final response = await _public.post<dynamic>(
          '/auth/login',
          data: {'email': email, 'password': password},
        );

        return SessionDto.fromJson(response.data as Map<String, dynamic>);
      });

  /// Revokes the refresh token server-side, so a stolen token cannot be renewed.
  Future<void> logout() => _guard(() => _api.post<dynamic>('/auth/logout'));

  /// The API answers identically whether or not the address has an account, by design, so
  /// there is nothing here for a caller to branch on.
  Future<void> requestPasswordReset(String email) => _guard(
    () =>
        _public.post<dynamic>('/auth/forgot-password', data: {'email': email}),
  );

  Future<MeDto> fetchMe() => _guard(() async {
    final response = await _api.get<dynamic>('/users/me');

    return MeDto.fromJson(response.data as Map<String, dynamic>);
  });

  Future<ProfileDto> updateProfile(Map<String, dynamic> patch) =>
      _guard(() async {
        final response = await _api.patch<dynamic>(
          '/users/me/profile',
          data: patch,
        );

        return ProfileDto.fromJson(response.data as Map<String, dynamic>);
      });
}

Future<T> _guard<T>(Future<T> Function() call) async {
  try {
    return await call();
  } on DioException catch (error) {
    throw ApiFailure.from(error);
  }
}

final sessionRefresherProvider = Provider<SessionRefresher>(
  (ref) => SessionRefresher(ref.watch(refreshDioProvider)),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(
    publicClient: ref.watch(publicDioProvider),
    apiClient: ref.watch(apiDioProvider),
  ),
);
