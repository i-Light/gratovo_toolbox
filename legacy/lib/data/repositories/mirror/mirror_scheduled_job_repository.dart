import 'dart:convert';

import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/scheduled_job.dart';
import 'package:gratovo_toolbox/data/repositories/scheduled_job_repository.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';

/// Scheduled jobs, read from and written to the local `scheduled_jobs`
/// table only. Unlike every other repository in `mirror/`, nothing here is
/// ever queued to the outbox: the table is per-machine state (see
/// `ScheduledJob`'s and `mirror_schema.dart`'s doc comments), so a write is
/// just a local SQL statement, full stop.
class MirrorScheduledJobRepository implements ScheduledJobRepository {
  const MirrorScheduledJobRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<ScheduledJob>> getAll() async {
    final rows = await _db.getAll('SELECT * FROM scheduled_jobs ORDER BY kind');
    return [for (final row in rows) _toJob(row)];
  }

  @override
  Future<ScheduledJob?> getById(String id) async {
    final rows =
        await _db.getAll('SELECT * FROM scheduled_jobs WHERE id = ?', [id]);
    return rows.isEmpty ? null : _toJob(rows.first);
  }

  @override
  Future<List<ScheduledJob>> getDue() async {
    final now = toIso(DateTime.now());
    final rows = await _db.getAll(
      'SELECT * FROM scheduled_jobs WHERE enabled = 1 AND next_run_at IS NOT '
      'NULL AND next_run_at <= ? ORDER BY next_run_at',
      [now],
    );
    return [for (final row in rows) _toJob(row)];
  }

  @override
  Future<ScheduledJob> upsert(ScheduledJob job) async {
    final id = job.id.isEmpty ? localUuid() : job.id;
    final now = DateTime.now().toUtc();
    final created = job.id.isEmpty ? now : (await _createdAt(id)) ?? now;
    await _db.execute(
      'INSERT INTO scheduled_jobs (id, kind, cadence, last_run_at, '
      'next_run_at, enabled, config, created_at, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
      'kind = excluded.kind, cadence = excluded.cadence, '
      'last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at, '
      'enabled = excluded.enabled, config = excluded.config, '
      'updated_at = excluded.updated_at',
      [
        id,
        job.kind,
        job.cadence,
        _isoOrNull(job.lastRunAt),
        _isoOrNull(job.nextRunAt),
        job.enabled ? 1 : 0,
        job.config == null ? null : jsonEncode(job.config),
        toIso(created),
        toIso(now),
      ],
    );
    return ScheduledJob(
      id: id,
      kind: job.kind,
      cadence: job.cadence,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
      enabled: job.enabled,
      config: job.config,
      createdAt: created,
      updatedAt: now,
    );
  }

  @override
  Future<void> delete(String id) async {
    await _db.execute('DELETE FROM scheduled_jobs WHERE id = ?', [id]);
  }

  @override
  Future<void> recordRun(
    String id, {
    required DateTime ranAt,
    DateTime? nextRunAt,
  }) async {
    await _db.execute(
      'UPDATE scheduled_jobs SET last_run_at = ?, next_run_at = ?, '
      'updated_at = ? WHERE id = ?',
      [toIso(ranAt), _isoOrNull(nextRunAt), toIso(DateTime.now()), id],
    );
  }

  Future<DateTime?> _createdAt(String id) async {
    final rows = await _db
        .getAll('SELECT created_at FROM scheduled_jobs WHERE id = ?', [id]);
    return rows.isEmpty ? null : parseDate(rows.first['created_at']);
  }

  static String? _isoOrNull(DateTime? value) =>
      value == null ? null : toIso(value);

  static ScheduledJob _toJob(Map<String, Object?> row) {
    final now = DateTime.now();
    final rawConfig = row['config'];
    Map<String, dynamic>? config;
    if (rawConfig is String && rawConfig.trim().isNotEmpty) {
      try {
        final decoded = jsonDecode(rawConfig);
        if (decoded is Map) config = Map<String, dynamic>.from(decoded);
      } on FormatException {
        config = null;
      }
    }
    return ScheduledJob(
      id: row['id'] as String,
      kind: parseString(row['kind']) ?? '',
      cadence: parseString(row['cadence']) ?? '',
      lastRunAt: parseDate(row['last_run_at']),
      nextRunAt: parseDate(row['next_run_at']),
      enabled: parseBool(row['enabled']),
      config: config,
      createdAt: parseDate(row['created_at']) ?? now,
      updatedAt: parseDate(row['updated_at']) ?? now,
    );
  }
}
