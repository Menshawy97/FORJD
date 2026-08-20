import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'package:forjd/core/network/session_ports.dart';

/// The identity of the signed-in user, cached alongside the tokens so a warm start can
/// render a name without waiting on the network.
class StoredIdentity {
  const StoredIdentity({required this.userId, required this.email});

  final String userId;
  final String email;
}

/// Session tokens in the platform keystore — Keychain on iOS, EncryptedSharedPreferences
/// on Android. Never SharedPreferences, never the Drift database.
class SecureTokenStore implements TokenStore {
  SecureTokenStore(this._storage);

  final FlutterSecureStorage _storage;

  static const _prefix = 'forjd.';
  static const _kAccess = '${_prefix}access_token';
  static const _kRefresh = '${_prefix}refresh_token';
  static const _kExpiresAt = '${_prefix}expires_at';
  static const _kUserId = '${_prefix}user_id';
  static const _kEmail = '${_prefix}email';

  static const _ownKeys = [_kAccess, _kRefresh, _kExpiresAt, _kUserId, _kEmail];

  /// A keystore round trip on every outgoing request is a real cost on Android, and the
  /// interceptor reads on each one. Written through on every mutation, so this can never
  /// serve a token the store no longer holds.
  AuthTokens? _cached;
  bool _loaded = false;

  @override
  Future<AuthTokens?> read() async {
    if (_loaded) {
      return _cached;
    }

    final access = await _storage.read(key: _kAccess);
    final refresh = await _storage.read(key: _kRefresh);
    final expiresAt = await _storage.read(key: _kExpiresAt);

    _loaded = true;

    // A half-written session is not a session. Treating it as signed-out is safe; treating
    // it as signed-in would send requests that can never succeed.
    if (access == null || refresh == null || expiresAt == null) {
      return _cached = null;
    }

    final parsed = DateTime.tryParse(expiresAt);

    if (parsed == null) {
      return _cached = null;
    }

    return _cached = AuthTokens(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: parsed,
    );
  }

  @override
  Future<void> write(AuthTokens tokens) async {
    _cached = tokens;
    _loaded = true;

    await _storage.write(key: _kAccess, value: tokens.accessToken);
    await _storage.write(key: _kRefresh, value: tokens.refreshToken);
    await _storage.write(
      key: _kExpiresAt,
      value: tokens.expiresAt.toIso8601String(),
    );
  }

  @override
  Future<void> clear() async {
    _cached = null;
    _loaded = true;

    // Only FORJD's own keys. `deleteAll` would take any other plugin's data with it.
    for (final key in _ownKeys) {
      await _storage.delete(key: key);
    }
  }

  Future<StoredIdentity?> readIdentity() async {
    final userId = await _storage.read(key: _kUserId);
    final email = await _storage.read(key: _kEmail);

    if (userId == null || email == null) {
      return null;
    }

    return StoredIdentity(userId: userId, email: email);
  }

  Future<void> writeIdentity(StoredIdentity identity) async {
    await _storage.write(key: _kUserId, value: identity.userId);
    await _storage.write(key: _kEmail, value: identity.email);
  }
}

final secureTokenStoreProvider = Provider<SecureTokenStore>(
  (ref) => SecureTokenStore(ref.watch(secureStorageProvider)),
);

final secureStorageProvider = Provider<FlutterSecureStorage>(
  (ref) => const FlutterSecureStorage(
    // The v9 default is a hand-rolled AES scheme over plain SharedPreferences; this opts
    // into the AndroidX Security Crypto implementation instead. Requires API 23, which
    // android/app/build.gradle.kts pins as a floor.
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    // `first_unlock`, not `unlocked`, so a background refresh can still read the token on
    // a locked device.
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  ),
);
