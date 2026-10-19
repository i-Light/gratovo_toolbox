import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/sync/mirror_outbox.dart';
import 'package:gratovo_toolbox/core/sync/sync_engine.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/repositories/supabase/supabase_mapping.dart';
import 'package:gratovo_toolbox/data/repositories/template_repository.dart';

/// The email template library, local-first.
class MirrorTemplateRepository implements TemplateRepository {
  const MirrorTemplateRepository(this._db);

  final LocalSyncDb _db;

  @override
  Future<List<EmailTemplate>> getAll() async {
    final rows =
        await _db.getAll('SELECT * FROM email_templates ORDER BY name');
    return [
      for (final row in rows)
        EmailTemplate(
          id: row['id'] as String,
          name: parseString(row['name']) ?? '',
          subject: parseString(row['subject']) ?? '',
          body: parseString(row['body']) ?? '',
          kind: TemplateKind.fromWire(parseString(row['kind'])),
        ),
    ];
  }

  @override
  Future<void> upsert(EmailTemplate template) async {
    // Ids are minted here rather than by the server, so a template saved
    // offline has the same id everywhere once it lands.
    final id = template.id.isEmpty ? localUuid() : template.id;
    final now = DateTime.now().toUtc().toIso8601String();
    await _db.execute(
      'INSERT INTO email_templates (id, name, subject, body, kind, updated_at) '
      'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET '
      'name = excluded.name, subject = excluded.subject, '
      'body = excluded.body, kind = excluded.kind, '
      'updated_at = excluded.updated_at',
      [
        id,
        template.name,
        template.subject,
        template.body,
        template.kind.wire,
        now
      ],
    );
    await enqueueRowUpsert(
      _db,
      table: 'email_templates',
      id: id,
      row: {
        'id': id,
        'name': template.name,
        'subject': template.subject,
        'body': template.body,
        'kind': template.kind.wire,
      },
    );
  }

  @override
  Future<void> delete(String id) async {
    await _db.execute('DELETE FROM email_templates WHERE id = ?', [id]);
    await enqueueRowDelete(_db, table: 'email_templates', id: id);
  }
}
