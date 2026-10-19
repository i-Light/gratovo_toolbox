import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_agency_settings_repository.dart';

import 'memory_mirror.dart';

void main() {
  late MemoryMirror db;
  late MirrorAgencySettingsRepository repository;

  setUp(() {
    db = MemoryMirror();
    repository = MirrorAgencySettingsRepository(db);
  });

  test('before anyone has saved, the facts are the house defaults', () async {
    expect(await repository.get(), const AgencySettings());
  });

  test('a saved row reads back, and is queued for the team', () async {
    const settings = AgencySettings(
      name: 'Gratovo',
      sender: 'Moustafa',
      trueClaims: ['We are a small agency.'],
      boycottBrands: ['Wix'],
    );

    await repository.save(settings);

    expect(await repository.get(), settings);
    final queued = await db.getAll('SELECT kind, payload FROM _outbox');
    expect(queued, hasLength(1));
    expect(queued.single['kind'], 'row.upsert');
    final payload = jsonDecode(queued.single['payload']! as String) as Map;
    expect(payload['table'], 'agency_settings');
    expect(payload['id'], 'agency');
    // jsonb on the server: the body travels as an object, not as JSON text.
    expect(payload['row'], {'id': 'agency', 'body': settings.toBody()});
  });

  test('a row pulled from a teammate is read like a local one', () async {
    await db.execute(
      "INSERT INTO agency_settings (id, body, updated_at) VALUES ('agency', ?, 'T')",
      [jsonEncode(const AgencySettings(name: 'Theirs').toBody())],
    );

    expect((await repository.get()).name, 'Theirs');
  });

  test('saving twice keeps one row', () async {
    await repository.save(const AgencySettings(name: 'A'));
    await repository.save(const AgencySettings(name: 'B'));

    final rows = await db.getAll('SELECT id FROM agency_settings');
    expect(rows, hasLength(1));
    expect((await repository.get()).name, 'B');
  });
}
