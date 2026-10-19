import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/repositories/agency_settings_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_mapping.dart';

/// The agency's facts, local-first: the one `agency_settings` row, read from
/// this machine's copy and written there first, then queued for the server.
class MirrorAgencySettingsRepository implements AgencySettingsRepository {
  const MirrorAgencySettingsRepository(this._db);

  final LocalSyncDb _db;

  /// The only id the server accepts (`check (id = 'agency')`).
  static const _id = 'agency';

  @override
  Future<AgencySettings> get() async {
    final rows = await _db
        .getAll('SELECT body FROM agency_settings WHERE id = ?', [_id]);
    if (rows.isEmpty) return const AgencySettings();
    final body = decodeJsonColumn(rows.single['body']);
    return body is Map
        ? AgencySettings.fromBody(body.cast<String, Object?>())
        : const AgencySettings();
  }

  @override
  Future<void> save(AgencySettings settings) async {
    final body = settings.toBody();
    await _db.execute(
      'INSERT INTO agency_settings (id, body, updated_at) VALUES (?, ?, ?) '
      'ON CONFLICT(id) DO UPDATE SET body = excluded.body, '
      'updated_at = excluded.updated_at',
      [_id, encodeJsonColumn(body), DateTime.now().toUtc().toIso8601String()],
    );
    await enqueueRowUpsert(
      _db,
      table: 'agency_settings',
      id: _id,
      row: {'id': _id, 'body': body},
    );
  }
}
