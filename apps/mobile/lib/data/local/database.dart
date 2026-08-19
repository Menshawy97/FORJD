import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'database.g.dart';

/// The offline-first local store. Phase 1 needs only a cached profile, but the database
/// and the repository pattern around it are established now because every repository
/// written between here and Phase 3 is shaped by them.
class CachedProfiles extends Table {
  TextColumn get userId => text()();
  TextColumn get displayName => text().nullable()();
  DateTimeColumn get cachedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {userId};
}

@DriftDatabase(tables: [CachedProfiles])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor]) : super(executor ?? _openConnection());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return LazyDatabase(() async {
      final dir = await getApplicationDocumentsDirectory();
      return NativeDatabase(File(p.join(dir.path, 'forjd.sqlite')));
    });
  }
}
