import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/core/network/dio_client.dart';
import 'package:forjd/data/local/database.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';
import 'package:forjd/features/profile/application/profile_controller.dart';

import '../../core/network/fakes.dart';

Map<String, dynamic> _me({String? displayName, String unitSystem = 'metric'}) =>
    {
      'id': 'user-1',
      'email': 'ada@example.com',
      'profile': {
        'userId': 'user-1',
        'displayName': displayName,
        'dateOfBirth': null,
        'sex': null,
        'heightCm': null,
        'unitSystem': unitSystem,
        'avatarUrl': null,
      },
    };

void main() {
  late AppDatabase database;

  // A fresh in-memory database per test, so cache assertions cannot leak between them.
  setUp(() => database = AppDatabase(NativeDatabase.memory()));

  tearDown(() => database.close());

  /// A container wired to an in-memory database and an API that answers from [onApi].
  ProviderContainer harness(
    ResponseBody Function(RequestOptions options, int attempt) onApi,
  ) {
    final container = ProviderContainer(
      overrides: [
        appDatabaseProvider.overrideWithValue(database),
        publicDioProvider.overrideWith(
          (ref) => Dio(BaseOptions(baseUrl: 'https://example.test/api/v1')),
        ),
        apiDioProvider.overrideWith(
          (ref) =>
              Dio(BaseOptions(baseUrl: 'https://example.test/api/v1'))
                ..httpClientAdapter = FakeHttpAdapter(onApi),
        ),
      ],
    );
    addTearDown(container.dispose);

    return container;
  }

  Future<String?> cachedNameFor(String userId) async {
    final row = await (database.select(
      database.cachedProfiles,
    )..where((row) => row.userId.equals(userId))).getSingleOrNull();

    return row?.displayName;
  }

  test(
    'loads the profile and caches the display name for offline use',
    () async {
      final container = harness(
        (_, _) => jsonBody(200, _me(displayName: 'Ada')),
      );

      final me = await container.read(profileControllerProvider.future);

      expect(me.email, 'ada@example.com');
      expect(me.profile?.displayName, 'Ada');
      expect(
        await cachedNameFor('user-1'),
        'Ada',
        reason: 'the name must survive for the next cold start',
      );
    },
  );

  test(
    'caches the timestamp in UTC, so it cannot shift across timezones',
    () async {
      final container = harness(
        (_, _) => jsonBody(200, _me(displayName: 'Ada')),
      );
      await container.read(profileControllerProvider.future);

      final row = await database.select(database.cachedProfiles).getSingle();

      expect(row.cachedAt.isUtc, isTrue);
    },
  );

  test(
    'surfaces a load failure as an error state rather than throwing',
    () async {
      final container = harness((_, _) => jsonBody(500, {}));

      await expectLater(
        container.read(profileControllerProvider.future),
        throwsA(isA<Object>()),
      );
      expect(container.read(profileControllerProvider).hasError, isTrue);
    },
  );

  test('save sends the patch, adopts the response, and re-caches', () async {
    final sentBodies = <Object?>[];
    final container = harness((options, _) {
      if (options.method == 'PATCH') {
        sentBodies.add(options.data);

        return jsonBody(200, {
          'userId': 'user-1',
          'displayName': 'Grace',
          'dateOfBirth': '1906-12-09',
          'sex': 'female',
          'heightCm': null,
          'unitSystem': 'metric',
          'avatarUrl': null,
        });
      }

      return jsonBody(200, _me(displayName: 'Ada'));
    });

    await container.read(profileControllerProvider.future);

    final failure = await container
        .read(profileControllerProvider.notifier)
        .save({'displayName': 'Grace', 'sex': 'female'});

    expect(failure, isNull);

    final decoded = jsonDecode(jsonEncode(sentBodies.single)) as Map;
    expect(decoded, {'displayName': 'Grace', 'sex': 'female'});

    final state = container.read(profileControllerProvider).requireValue;
    expect(state.profile?.displayName, 'Grace');
    expect(state.profile?.sex, Sex.female);
    expect(
      state.email,
      'ada@example.com',
      reason: 'PATCH returns only the profile, so identity must be preserved',
    );
    expect(await cachedNameFor('user-1'), 'Grace');
  });

  test(
    'save returns the failure instead of throwing, so the form survives',
    () async {
      final container = harness((options, _) {
        if (options.method == 'PATCH') {
          return jsonBody(400, {
            'message': 'Validation failed',
            'errors': {
              'displayName': ['String must contain at most 80 character(s)'],
            },
          });
        }

        return jsonBody(200, _me(displayName: 'Ada'));
      });

      await container.read(profileControllerProvider.future);

      final failure = await container
          .read(profileControllerProvider.notifier)
          .save({'displayName': 'x' * 81});

      expect(failure, isNotNull);
      expect(failure!.forField('displayName'), contains('80'));
      expect(
        container
            .read(profileControllerProvider)
            .requireValue
            .profile
            ?.displayName,
        'Ada',
        reason: 'a rejected save must not corrupt the shown profile',
      );
    },
  );

  test('cachedDisplayNameProvider returns null for an unknown user', () async {
    final container = harness((_, _) => jsonBody(200, _me()));

    expect(
      await container.read(cachedDisplayNameProvider('nobody').future),
      isNull,
    );
  });
}
