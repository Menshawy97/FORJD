/// Wire models for `/api/v1/auth/*` and `/api/v1/users/me`.
///
/// These mirror the Zod schemas in `packages/contracts/src/index.ts` by hand. Nothing
/// enforces that they stay in step, so treat the contract as the source of truth and change
/// it first — generating these from the schemas is an open follow-up in the roadmap.
library;

import 'package:forjd/core/network/session_ports.dart';

/// Mirrors `sessionResponseSchema`.
class SessionDto {
  const SessionDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;

  factory SessionDto.fromJson(Map<String, dynamic> json) => SessionDto(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresAt: DateTime.parse(json['expiresAt'] as String),
  );

  AuthTokens toTokens() => AuthTokens(
    accessToken: accessToken,
    refreshToken: refreshToken,
    expiresAt: expiresAt,
  );
}

/// Mirrors `registerResponseSchema`.
///
/// [session] is nullable by contract, not by accident: when the project requires email
/// confirmation the account exists but cannot be used until the link is clicked. Callers
/// must handle that as a state, not as a failure.
class RegisterResultDto {
  const RegisterResultDto({
    required this.userId,
    required this.email,
    required this.emailVerified,
    required this.session,
  });

  final String userId;
  final String email;
  final bool emailVerified;
  final SessionDto? session;

  factory RegisterResultDto.fromJson(Map<String, dynamic> json) {
    final session = json['session'];

    return RegisterResultDto(
      userId: json['userId'] as String,
      email: json['email'] as String,
      emailVerified: json['emailVerified'] as bool,
      session: session == null
          ? null
          : SessionDto.fromJson(session as Map<String, dynamic>),
    );
  }
}

/// Mirrors `profileResponseSchema`.
class ProfileDto {
  const ProfileDto({
    required this.userId,
    this.displayName,
    this.dateOfBirth,
    this.sex,
    this.heightCm,
    this.unitSystem = UnitSystem.metric,
    this.avatarUrl,
  });

  final String userId;
  final String? displayName;

  /// `YYYY-MM-DD`, kept as a string because that is exactly what the API accepts back on
  /// PATCH. Parsing to a DateTime here would invite a timezone shift on the round trip and
  /// move somebody's birthday by a day.
  final String? dateOfBirth;
  final Sex? sex;
  final double? heightCm;
  final UnitSystem unitSystem;
  final String? avatarUrl;

  factory ProfileDto.fromJson(Map<String, dynamic> json) => ProfileDto(
    userId: json['userId'] as String,
    displayName: json['displayName'] as String?,
    dateOfBirth: json['dateOfBirth'] as String?,
    sex: Sex.fromWire(json['sex'] as String?),
    heightCm: (json['heightCm'] as num?)?.toDouble(),
    unitSystem: UnitSystem.fromWire(json['unitSystem'] as String?),
    avatarUrl: json['avatarUrl'] as String?,
  );
}

/// Mirrors `meResponseSchema`.
class MeDto {
  const MeDto({required this.id, required this.email, this.profile});

  final String id;
  final String email;
  final ProfileDto? profile;

  factory MeDto.fromJson(Map<String, dynamic> json) {
    final profile = json['profile'];

    return MeDto(
      id: json['id'] as String,
      email: json['email'] as String,
      profile: profile == null
          ? null
          : ProfileDto.fromJson(profile as Map<String, dynamic>),
    );
  }
}

/// Mirrors `sexSchema`.
///
/// All four values are represented. The design's picker offers three, but a value the API
/// accepts and the UI cannot display would render blank for anyone who set it elsewhere.
enum Sex {
  male('male', 'Male'),
  female('female', 'Female'),
  other('other', 'Other'),
  preferNotToSay('prefer_not_to_say', 'Rather not say');

  const Sex(this.wire, this.label);

  final String wire;
  final String label;

  static Sex? fromWire(String? value) {
    for (final sex in Sex.values) {
      if (sex.wire == value) {
        return sex;
      }
    }

    return null;
  }
}

/// Mirrors `unitSystemSchema`.
enum UnitSystem {
  metric('metric'),
  imperial('imperial');

  const UnitSystem(this.wire);

  final String wire;

  /// Falls back to metric, matching the column default, so an unrecognised value degrades
  /// to the documented default rather than throwing on a screen that only wanted a name.
  static UnitSystem fromWire(String? value) =>
      value == 'imperial' ? UnitSystem.imperial : UnitSystem.metric;
}
