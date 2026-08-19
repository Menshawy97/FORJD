import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:forjd/data/local/database.dart';

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase(NativeDatabase.memory()));
  tearDown(() => db.close());

  test('stores and reads back a cached profile', () async {
    final cachedAt = DateTime.utc(2026, 8, 19);

    await db
        .into(db.cachedProfiles)
        .insert(
          CachedProfilesCompanion.insert(
            userId: 'user-1',
            displayName: const Value('Test User'),
            cachedAt: cachedAt,
          ),
        );

    final rows = await db.select(db.cachedProfiles).get();

    expect(rows, hasLength(1));
    expect(rows.single.userId, 'user-1');
    expect(rows.single.displayName, 'Test User');
    expect(rows.single.cachedAt, cachedAt);
  });

  test(
    'userId is the primary key, so re-caching replaces rather than duplicates',
    () async {
      final companion = CachedProfilesCompanion.insert(
        userId: 'user-1',
        displayName: const Value('First'),
        cachedAt: DateTime.utc(2026, 8, 19),
      );

      await db.into(db.cachedProfiles).insert(companion);
      await db
          .into(db.cachedProfiles)
          .insertOnConflictUpdate(
            companion.copyWith(displayName: const Value('Second')),
          );

      final rows = await db.select(db.cachedProfiles).get();

      expect(rows, hasLength(1));
      expect(rows.single.displayName, 'Second');
    },
  );
}
