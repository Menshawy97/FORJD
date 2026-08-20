import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forjd/core/network/session_ports.dart';
import 'package:forjd/features/auth/domain/auth_models.dart';

/// Parses the fixtures generated from the Zod contracts through the real DTOs.
///
/// The DTOs mirror `packages/contracts/src/index.ts` by hand, and until now nothing checked
/// that the two agreed. A renamed field would have compiled, passed every other test, and
/// arrived as null on a device — the failure mode the roadmap recorded as "they can drift
/// silently".
///
/// The fixtures are generated, not captured: each one is validated by its own Zod schema
/// before being written, so it cannot describe a shape the API is unable to send.
void main() {
  final fixturesDir = Directory('../../packages/contracts/fixtures');

  /// Every fixture file must appear here, and every name here must have a file. That is what
  /// keeps this from rotting: a response schema added without Dart coverage fails rather
  /// than passing quietly.
  final parsers = <String, void Function(Map<String, dynamic>)>{
    'session-response': (json) {
      final dto = SessionDto.fromJson(json);

      expect(dto.accessToken, 'fixture-access-token');
      expect(dto.refreshToken, 'fixture-refresh-token');
      expect(dto.expiresAt, DateTime.utc(2026, 1, 1, 1));
      expect(dto.toTokens(), isA<AuthTokens>());
    },
    'register-response': (json) {
      final dto = RegisterResultDto.fromJson(json);

      expect(dto.userId, '11111111-1111-4111-8111-111111111111');
      expect(dto.email, 'ada@example.com');
      expect(dto.emailVerified, isTrue);
      expect(dto.session?.accessToken, 'fixture-access-token');
    },
    'register-response-awaiting-confirmation': (json) {
      final dto = RegisterResultDto.fromJson(json);

      // The whole reason this fixture exists: a null session is a state, not a failure.
      expect(dto.session, isNull);
      expect(dto.emailVerified, isFalse);
    },
    'profile-response': (json) {
      final dto = ProfileDto.fromJson(json);

      expect(dto.displayName, 'Ada Lovelace');
      // Kept as a string on purpose — parsing to DateTime would shift a birthday across a
      // timezone on the round trip.
      expect(dto.dateOfBirth, '1990-07-04');
      expect(dto.sex, Sex.female);
      expect(dto.heightCm, 172.5);
      expect(dto.unitSystem, UnitSystem.metric);
      expect(dto.avatarUrl, 'https://example.com/avatar.png');
    },
    'profile-response-empty': (json) {
      final dto = ProfileDto.fromJson(json);

      expect(dto.displayName, isNull);
      expect(dto.dateOfBirth, isNull);
      expect(dto.sex, isNull);
      expect(dto.heightCm, isNull);
      expect(dto.avatarUrl, isNull);
      // Not nullable in the contract, and the column has a default.
      expect(dto.unitSystem, UnitSystem.metric);
    },
    'me-response': (json) {
      final dto = MeDto.fromJson(json);

      expect(dto.id, '11111111-1111-4111-8111-111111111111');
      expect(dto.email, 'ada@example.com');
      expect(dto.profile?.displayName, 'Ada Lovelace');
    },
    'me-response-no-profile': (json) {
      final dto = MeDto.fromJson(json);

      expect(dto.profile, isNull);
    },
  };

  test('the generated fixtures directory exists', () {
    expect(
      fixturesDir.existsSync(),
      isTrue,
      reason:
          'Run: pnpm --filter @forjd/contracts fixtures. Without the files this whole suite '
          'would pass by having nothing to check.',
    );
  });

  test('every fixture has a parser and every parser has a fixture', () {
    final onDisk = fixturesDir
        .listSync()
        .whereType<File>()
        .where((file) => file.path.endsWith('.json'))
        .map((file) => file.uri.pathSegments.last.replaceAll('.json', ''))
        .toSet();

    expect(
      onDisk,
      parsers.keys.toSet(),
      reason:
          'A response shape gained or lost a fixture without this test following. Adding a '
          'contract without Dart coverage is exactly the drift this file exists to stop.',
    );
  });

  for (final entry in parsers.entries) {
    test('${entry.key} parses into its DTO', () {
      final file = File('${fixturesDir.path}/${entry.key}.json');
      final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;

      entry.value(json);
    });
  }
}
