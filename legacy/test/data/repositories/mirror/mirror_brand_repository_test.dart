// Brands with several contacts, a country, a category, a currency and where
// they came from (fix #5, HC-25), created and edited locally and queued for
// the team.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_brand_repository.dart';

import 'memory_mirror.dart';

void main() {
  late MemoryMirror db;
  late MirrorBrandRepository repository;

  setUp(() {
    db = MemoryMirror();
    repository = MirrorBrandRepository(db);
  });
  tearDown(() => db.close());

  Brand draft() => Brand(
        id: '',
        name: 'Runway',
        createdAt: DateTime.utc(2026, 10, 18),
        website: 'https://runwayml.com',
        category: 'AI video',
        country: 'US',
        budget: 9000,
        budgetCurrency: 'USD',
        source: BrandSource.seenSponsoring,
        contacts: const [
          BrandContact(
              name: 'Jack', email: 'jack@runway.ml', role: 'Partnerships'),
          BrandContact(name: 'Mia', email: 'mia@runway.ml', isPrimary: true),
        ],
      );

  test('a new brand gets an id, reads back whole, and is queued', () async {
    final created = await repository.create(draft());

    expect(created.id, isNotEmpty);
    final read = (await repository.getById(created.id))!;
    expect(read.name, 'Runway');
    expect(read.country, 'US');
    expect(read.category, 'AI video');
    expect(read.source, BrandSource.seenSponsoring);
    expect(
        read.contacts.map((c) => c.email), ['jack@runway.ml', 'mia@runway.ml']);
    // The primary contact also fills the old single-contact columns, which
    // older screens and older clients still read.
    expect(read.contactName, 'Mia');
    expect(read.contactEmail, 'mia@runway.ml');

    final queued = await db
        .getAll("SELECT payload FROM _outbox WHERE kind = 'row.upsert'");
    final row =
        (jsonDecode(queued.single['payload']! as String) as Map)['row'] as Map;
    // jsonb on the server: lists travel as lists, never as JSON text.
    expect(row['contacts'], isA<List<dynamic>>());
    expect((row['contacts'] as List).first,
        containsPair('email', 'jack@runway.ml'));
    expect(row['preferred_criteria'], isA<List<dynamic>>());
    expect(row['budget_currency'], 'USD');
    expect(row['source'], 'seenSponsoring');
  });

  test('an edit replaces the brand and is queued again', () async {
    final created = await repository.create(draft());

    await repository.update(created.copyWith(
      country: 'GB',
      contacts: const [BrandContact(name: 'Sam', email: 'sam@runway.ml')],
    ));

    final read = (await repository.getById(created.id))!;
    expect(read.country, 'GB');
    expect(read.contacts.single.email, 'sam@runway.ml');
    expect(read.contactEmail, 'sam@runway.ml');
    final queued =
        await db.getAll("SELECT kind FROM _outbox WHERE kind = 'row.upsert'");
    expect(queued, hasLength(2));
  });

  test('a brand saved before 1.4 shows its one contact as a contact', () async {
    await db.execute(
      'INSERT INTO brands (id, name, contact_name, contact_email, created_at) '
      "VALUES ('old', 'Old Co', 'Ann', 'ann@old.co', '2026-01-01T00:00:00Z')",
    );

    final read = (await repository.getById('old'))!;
    expect(read.contacts, isEmpty);
    expect(read.allContacts.single.email, 'ann@old.co');
    expect(read.budgetCurrency, 'USD');
    expect(read.source, BrandSource.manual);
  });

  test('notes still save without touching the rest', () async {
    final created = await repository.create(draft());

    await repository.updateNotes(created.id, 'Met at the AI summit.');

    final read = (await repository.getById(created.id))!;
    expect(read.notes, 'Met at the AI summit.');
    expect(read.contacts, hasLength(2));
  });
}
