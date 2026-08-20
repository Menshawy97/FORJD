import 'package:drift/drift.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:forjd/core/network/api_failure.dart';
import 'package:forjd/data/local/database.dart';
import 'package:forjd/features/auth/data/auth_repository.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';

/// The signed-in user's profile, with the last known name cached on device.
///
/// The cache exists so the profile screen has something true to show before the network
/// answers, and something to show at all when it does not. It holds only the display name —
/// enough for the header, not a second copy of the profile that could drift.
class ProfileController extends AsyncNotifier<MeDto> {
  @override
  Future<MeDto> build() => _load();

  Future<MeDto> _load() async {
    final me = await ref.read(authRepositoryProvider).fetchMe();
    await _cache(me);

    return me;
  }

  Future<void> _cache(MeDto me) async {
    final database = ref.read(appDatabaseProvider);

    await database
        .into(database.cachedProfiles)
        .insertOnConflictUpdate(
          CachedProfilesCompanion.insert(
            userId: me.id,
            displayName: Value(me.profile?.displayName),
            // UTC deliberately: the column stores ISO-8601 text, and a local timestamp
            // would silently shift for anyone who crosses a timezone.
            cachedAt: DateTime.now().toUtc(),
          ),
        );
  }

  /// Re-fetches, keeping the previous value visible while it does — a refresh that blanks
  /// the screen it is refreshing is worse than one that does not.
  Future<void> refresh() async {
    state = await AsyncValue.guard(_load);
  }

  /// Sends a partial update and adopts the server's answer as the new truth.
  ///
  /// Named [save] rather than `update`: AsyncNotifier already defines an `update` with a
  /// different signature, and overriding it by accident is a compile error at best.
  ///
  /// Returns the failure rather than throwing so the edit screen can show it inline instead
  /// of tearing down the form the user is standing in.
  Future<ApiFailure?> save(Map<String, dynamic> patch) async {
    try {
      final profile = await ref
          .read(authRepositoryProvider)
          .updateProfile(patch);
      final current = state.valueOrNull;

      if (current != null) {
        final updated = MeDto(
          id: current.id,
          email: current.email,
          profile: profile,
        );
        await _cache(updated);
        state = AsyncData(updated);
      }

      return null;
    } on ApiFailure catch (failure) {
      return failure;
    }
  }
}

final profileControllerProvider =
    AsyncNotifierProvider<ProfileController, MeDto>(ProfileController.new);

/// The name last seen for [userId], or null — the placeholder while the profile request is
/// still in flight.
final cachedDisplayNameProvider = FutureProvider.family<String?, String>((
  ref,
  userId,
) async {
  final database = ref.read(appDatabaseProvider);
  final row = await (database.select(
    database.cachedProfiles,
  )..where((row) => row.userId.equals(userId))).getSingleOrNull();

  return row?.displayName;
});
