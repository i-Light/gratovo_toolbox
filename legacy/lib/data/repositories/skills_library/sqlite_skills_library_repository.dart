import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/data/models/skill_group.dart';
import 'package:gratovo_toolbox/data/models/skill_section.dart';
import 'package:gratovo_toolbox/data/repositories/skills_library_repository.dart';

/// The Skills page on top of a [LocalDb] — no `dart:io`, no `package:sqlite3`,
/// same reasoning as `SqliteEmailLibraryRepository`.
class SqliteSkillsLibraryRepository implements SkillsLibraryRepository {
  const SqliteSkillsLibraryRepository(this._db);

  final LocalDb _db;

  @override
  bool get isAvailable => true;

  @override
  Future<List<SkillGroup>> listGroups() async {
    final rows = _db.select('SELECT * FROM skill_groups ORDER BY name');
    return [for (final row in rows) _groupFromRow(row)];
  }

  @override
  Future<SkillGroup> createGroup(String name) async {
    final trimmed = name.trim();
    final now = DateTime.now().toUtc();
    final group = SkillGroup(
      id: localUuid(),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
    );
    _db.execute(
      'INSERT INTO skill_groups (id, name, created_at, updated_at) '
      'VALUES (?, ?, ?, ?)',
      [group.id, group.name, _stamp(now), _stamp(now)],
    );
    return group;
  }

  @override
  Future<void> renameGroup(String id, String name) async {
    final trimmed = name.trim();
    if (trimmed.isEmpty) return;
    _db.execute(
      'UPDATE skill_groups SET name = ?, updated_at = ? WHERE id = ?',
      [trimmed, _stamp(DateTime.now().toUtc()), id],
    );
  }

  @override
  Future<void> deleteGroup(String id) async {
    // Cards go with it through ON DELETE CASCADE — foreign keys are on, see
    // local_db_io.dart.
    _db.execute('DELETE FROM skill_groups WHERE id = ?', [id]);
  }

  @override
  Future<void> markGroupExported(String id, DateTime at) async {
    _db.execute(
      'UPDATE skill_groups SET exported_at = ? WHERE id = ?',
      [_stamp(at.toUtc()), id],
    );
  }

  @override
  Future<List<SkillSection>> listSections(String groupId) async {
    final rows = _db.select(
      'SELECT * FROM skill_sections WHERE group_id = ? ORDER BY position',
      [groupId],
    );
    return [for (final row in rows) _sectionFromRow(row)];
  }

  @override
  Future<void> saveSection(SkillSection section) async {
    _db.execute(
      'INSERT INTO skill_sections '
      '(id, group_id, heading, body, position, team_only, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?) '
      'ON CONFLICT (id) DO UPDATE SET '
      'heading    = excluded.heading, '
      'body       = excluded.body, '
      'position   = excluded.position, '
      'team_only  = excluded.team_only, '
      'updated_at = excluded.updated_at',
      [
        section.id,
        section.groupId,
        section.heading,
        section.body,
        section.position,
        section.teamOnly ? 1 : 0,
        _stamp(section.createdAt.toUtc()),
        _stamp(section.updatedAt.toUtc()),
      ],
    );
    _db.execute(
      'UPDATE skill_groups SET updated_at = ? WHERE id = ?',
      [_stamp(DateTime.now().toUtc()), section.groupId],
    );
  }

  @override
  Future<void> deleteSection(String id) async {
    _db.execute('DELETE FROM skill_sections WHERE id = ?', [id]);
  }

  @override
  Future<void> reorderSections(
    String groupId,
    List<String> orderedIds,
  ) async {
    _db.transaction(() {
      for (var i = 0; i < orderedIds.length; i++) {
        _db.execute(
          'UPDATE skill_sections SET position = ? '
          'WHERE id = ? AND group_id = ?',
          [i, orderedIds[i], groupId],
        );
      }
    });
  }

  @override
  Future<SkillGemSetup?> getGemSetup(String groupId) async {
    final rows = _db.select(
      'SELECT * FROM skill_gem_setup WHERE group_id = ?',
      [groupId],
    );
    if (rows.isEmpty) return null;
    final row = rows.single;
    // A retired role (the drafter and QA gems) or one from a newer build is
    // no setup this build can use, so it reads as none rather than as some
    // other gem.
    final role = SkillGemRole.fromName(row['role'] as String?);
    if (role == null) return null;
    return _gemSetupFromRow(row, role);
  }

  @override
  Future<void> saveGemSetup(SkillGemSetup setup) async {
    _db.execute(
      'INSERT INTO skill_gem_setup '
      '(group_id, role, gem_name, gem_description, gem_instructions, gem_url, '
      'synced_at, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) '
      'ON CONFLICT (group_id) DO UPDATE SET '
      'role             = excluded.role, '
      'gem_name         = excluded.gem_name, '
      'gem_description  = excluded.gem_description, '
      'gem_instructions = excluded.gem_instructions, '
      'gem_url          = excluded.gem_url, '
      'synced_at        = excluded.synced_at, '
      'updated_at       = excluded.updated_at',
      [
        setup.groupId,
        setup.role.storageName,
        setup.name,
        setup.description,
        setup.instructions,
        setup.url,
        setup.syncedAt == null ? null : _stamp(setup.syncedAt!.toUtc()),
        _stamp(setup.createdAt.toUtc()),
        _stamp(setup.updatedAt.toUtc()),
      ],
    );
  }

  SkillGemSetup _gemSetupFromRow(Map<String, Object?> row, SkillGemRole role) =>
      SkillGemSetup(
        groupId: row['group_id'] as String,
        role: role,
        name: (row['gem_name'] as String?) ?? '',
        description: (row['gem_description'] as String?) ?? '',
        instructions: (row['gem_instructions'] as String?) ?? '',
        url: (row['gem_url'] as String?) ?? '',
        syncedAt: _parseInstant(row['synced_at'] as String?),
        createdAt: DateTime.parse(row['created_at'] as String),
        updatedAt: DateTime.parse(row['updated_at'] as String),
      );

  SkillGroup _groupFromRow(Map<String, Object?> row) => SkillGroup(
        id: row['id'] as String,
        name: row['name'] as String,
        createdAt: DateTime.parse(row['created_at'] as String),
        updatedAt: DateTime.parse(row['updated_at'] as String),
        exportedAt: _parseInstant(row['exported_at'] as String?),
      );

  SkillSection _sectionFromRow(Map<String, Object?> row) => SkillSection(
        id: row['id'] as String,
        groupId: row['group_id'] as String,
        heading: (row['heading'] as String?) ?? '',
        body: (row['body'] as String?) ?? '',
        position: (row['position'] as int?) ?? 0,
        teamOnly: ((row['team_only'] as int?) ?? 0) != 0,
        createdAt: DateTime.parse(row['created_at'] as String),
        updatedAt: DateTime.parse(row['updated_at'] as String),
      );

  static String _stamp(DateTime at) => at.toIso8601String();

  static DateTime? _parseInstant(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    return DateTime.tryParse(value.trim())?.toUtc();
  }
}
