// The 30-day report's columns (plan step 7) survive a write and a read, and
// travel to the team with the row.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_deliverable_repository.dart';

import 'memory_mirror.dart';

void main() {
  late MemoryMirror db;
  late MirrorDeliverableRepository repository;

  setUp(() {
    db = MemoryMirror();
    repository = MirrorDeliverableRepository(db);
  });

  test('the published date and the report numbers read back', () async {
    final now = DateTime.utc(2026, 10, 1);
    final created = await repository.create(Deliverable(
      id: '',
      dealId: 'deal_1',
      type: DeliverableType.integration,
      status: DeliverableStatus.published,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    ));
    final read = (await repository.getForDeal('deal_1')).single;
    expect(read.publishedAt, now);

    await repository.update(Deliverable(
      id: created.id,
      dealId: 'deal_1',
      type: DeliverableType.integration,
      status: DeliverableStatus.published,
      publishedAt: now,
      reportViews: 61000,
      reportViewsAt: DateTime.utc(2026, 10, 31),
      reportClicks: 420,
      createdAt: now,
      updatedAt: now,
    ));

    final after = (await repository.getForDeal('deal_1')).single;
    expect(after.reportViews, 61000);
    expect(after.reportViewsAt, DateTime.utc(2026, 10, 31));
    expect(after.reportClicks, 420);
    final queued = await db.getAll(
        "SELECT payload FROM _outbox WHERE kind = 'row.upsert' ORDER BY rowid");
    final row =
        (jsonDecode(queued.last['payload']! as String) as Map)['row'] as Map;
    expect(row['report_views'], 61000);
    expect(row['report_clicks'], 420);
    expect(row['published_at'], isNotNull);
  });
}
