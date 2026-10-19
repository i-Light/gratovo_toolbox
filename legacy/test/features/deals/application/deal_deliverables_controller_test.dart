import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deliverable_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_deliverables_controller.dart';

/// Uses a deal id the mock repository has no seed rows for, so every test
/// starts from an empty list rather than depending on
/// `MockDeliverableRepository`'s own seed data.
const _dealId = 'deal_controller_test';

void main() {
  late MockDeliverableRepository repository;
  late ProviderContainer container;

  setUp(() {
    repository = MockDeliverableRepository();
    container = ProviderContainer(
      overrides: [
        deliverableRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
  });

  DealDeliverablesController controller() =>
      container.read(dealDeliverablesProvider(_dealId).notifier);

  Future<List<Deliverable>> read() =>
      container.read(dealDeliverablesProvider(_dealId).future);

  test('starts empty for a deal with no seeded deliverables', () async {
    expect(await read(), isEmpty);
  });

  test('addDeliverable creates a pending row and appends it at the end',
      () async {
    await controller().addDeliverable(DeliverableType.integration);
    await controller().addDeliverable(DeliverableType.communityPost);

    final list = await read();
    expect(list.length, 2);
    expect(list[0].type, DeliverableType.integration);
    expect(list[0].status, DeliverableStatus.pending);
    expect(list[0].sortOrder, 0);
    expect(list[1].type, DeliverableType.communityPost);
    expect(list[1].sortOrder, 1);
  });

  test('updateStatus changes only the targeted row', () async {
    await controller().addDeliverable(DeliverableType.integration);
    await controller().addDeliverable(DeliverableType.short);
    final list = await read();

    await controller().updateStatus(list[0].id, DeliverableStatus.approved);

    final updated = await read();
    expect(updated[0].status, DeliverableStatus.approved);
    expect(updated[1].status, DeliverableStatus.pending);
  });

  test('setDate writes only the requested field and leaves the others null',
      () async {
    await controller().addDeliverable(DeliverableType.integration);
    final id = (await read()).single.id;
    final agreed = DateTime(2026, 9, 1);

    await controller().setDate(id, DeliverableDateField.agreed, agreed);

    final row = (await read()).single;
    expect(row.agreedDate, agreed);
    expect(row.draftReceivedDate, isNull);
    expect(row.approvedDate, isNull);
  });

  test('setDate can clear a date that was previously set', () async {
    await controller().addDeliverable(DeliverableType.integration);
    final id = (await read()).single.id;
    await controller()
        .setDate(id, DeliverableDateField.approved, DateTime(2026, 9, 1));
    expect((await read()).single.approvedDate, isNotNull);

    await controller().setDate(id, DeliverableDateField.approved, null);

    expect((await read()).single.approvedDate, isNull);
  });

  test('updatePublishedUrl stores a link and an empty string clears it',
      () async {
    await controller().addDeliverable(DeliverableType.integration);
    final id = (await read()).single.id;

    await controller().updatePublishedUrl(id, 'https://example.com/post');
    expect((await read()).single.publishedUrl, 'https://example.com/post');

    await controller().updatePublishedUrl(id, '');
    expect((await read()).single.publishedUrl, isNull);
  });

  test('updateNotes stores text and an empty string clears it', () async {
    await controller().addDeliverable(DeliverableType.integration);
    final id = (await read()).single.id;

    await controller().updateNotes(id, 'needs a second draft');
    expect((await read()).single.notes, 'needs a second draft');

    await controller().updateNotes(id, '');
    expect((await read()).single.notes, isNull);
  });

  test('delete removes the row', () async {
    await controller().addDeliverable(DeliverableType.integration);
    await controller().addDeliverable(DeliverableType.short);
    final list = await read();

    await controller().delete(list[0].id);

    final remaining = await read();
    expect(remaining.length, 1);
    expect(remaining.single.type, DeliverableType.short);
  });

  group('the 30-day report', () {
    test('marking published records the date, and walking back clears it',
        () async {
      await controller().addDeliverable(DeliverableType.integration);
      final id = (await read()).single.id;
      final before = DateTime.now();

      await controller().updateStatus(id, DeliverableStatus.published);
      final published = (await read()).single;
      expect(published.publishedAt, isNotNull);
      expect(published.publishedAt!.isBefore(before), isFalse);

      await controller().updateStatus(id, DeliverableStatus.approved);
      expect((await read()).single.publishedAt, isNull);
    });

    test('setting published again keeps the first date', () async {
      await controller().addDeliverable(DeliverableType.integration);
      final id = (await read()).single.id;
      await controller().updateStatus(id, DeliverableStatus.published);
      final first = (await read()).single.publishedAt;

      await controller().updateStatus(id, DeliverableStatus.published);

      expect((await read()).single.publishedAt, first);
    });

    test('the views snapshot is kept once taken; clicks can be added',
        () async {
      await controller().addDeliverable(DeliverableType.integration);
      final id = (await read()).single.id;
      final taken = DateTime.utc(2026, 11, 20);

      await controller().recordReport(id, views: 61000, at: taken);
      await controller().recordReport(id,
          views: 99000, at: DateTime.utc(2026, 12), clicks: 420);
      await controller().updateNotes(id, 'went well');

      final row = (await read()).single;
      expect(row.reportViews, 61000);
      expect(row.reportViewsAt, taken);
      expect(row.reportClicks, 420);
      expect(row.notes, 'went well');
    });
  });

  group('reorder', () {
    test('moveDown swaps sortOrder with the row below and re-sorts', () async {
      await controller().addDeliverable(DeliverableType.integration);
      await controller().addDeliverable(DeliverableType.dedicated);
      await controller().addDeliverable(DeliverableType.short);
      final list = await read();
      final firstId = list[0].id;

      await controller().moveDown(firstId);

      final reordered = await read();
      expect(reordered.map((d) => d.type).toList(), [
        DeliverableType.dedicated,
        DeliverableType.integration,
        DeliverableType.short,
      ]);
    });

    test('moveUp swaps sortOrder with the row above and re-sorts', () async {
      await controller().addDeliverable(DeliverableType.integration);
      await controller().addDeliverable(DeliverableType.dedicated);
      final list = await read();
      final secondId = list[1].id;

      await controller().moveUp(secondId);

      final reordered = await read();
      expect(reordered.map((d) => d.type).toList(), [
        DeliverableType.dedicated,
        DeliverableType.integration,
      ]);
    });

    test('moveUp on the first row is a no-op', () async {
      await controller().addDeliverable(DeliverableType.integration);
      await controller().addDeliverable(DeliverableType.dedicated);
      final firstId = (await read())[0].id;

      await controller().moveUp(firstId);

      final unchanged = await read();
      expect(unchanged.map((d) => d.type).toList(), [
        DeliverableType.integration,
        DeliverableType.dedicated,
      ]);
    });

    test('moveDown on the last row is a no-op', () async {
      await controller().addDeliverable(DeliverableType.integration);
      await controller().addDeliverable(DeliverableType.dedicated);
      final lastId = (await read())[1].id;

      await controller().moveDown(lastId);

      final unchanged = await read();
      expect(unchanged.map((d) => d.type).toList(), [
        DeliverableType.integration,
        DeliverableType.dedicated,
      ]);
    });
  });
}
