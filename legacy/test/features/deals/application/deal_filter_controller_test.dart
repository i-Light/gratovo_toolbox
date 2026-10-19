import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_filter_controller.dart';

Deal _dealWith({
  required String id,
  required DealStage stage,
  required DateTime updatedAt,
}) {
  return Deal(
    id: id,
    brandId: 'brand_x',
    influencerId: 'inf_x',
    stage: stage,
    brandPrice: 1000,
    influencerPayout: 750,
    createdAt: updatedAt,
    updatedAt: updatedAt,
  );
}

void main() {
  group('applyDealFilter', () {
    final deals = [
      _dealWith(
        id: 'a',
        stage: DealStage.proposed,
        updatedAt: DateTime(2026, 1, 1),
      ),
      _dealWith(
        id: 'b',
        stage: DealStage.negotiating,
        updatedAt: DateTime(2026, 1, 10),
      ),
      _dealWith(
        id: 'c',
        stage: DealStage.negotiating,
        updatedAt: DateTime(2026, 1, 5),
      ),
    ];

    test('a null stage keeps every deal', () {
      final result = applyDealFilter(deals, null);
      expect(result.map((d) => d.id), containsAll(['a', 'b', 'c']));
      expect(result.length, 3);
    });

    test('a set stage keeps only matching deals', () {
      final result = applyDealFilter(deals, DealStage.negotiating);
      expect(result.map((d) => d.id).toSet(), {'b', 'c'});
    });

    test('sorts most-recently-updated first regardless of filter', () {
      final result = applyDealFilter(deals, null);
      expect(result.map((d) => d.id).toList(), ['b', 'c', 'a']);
    });

    test('sorting is preserved when also filtering by stage', () {
      final result = applyDealFilter(deals, DealStage.negotiating);
      expect(result.map((d) => d.id).toList(), ['b', 'c']);
    });

    test('does not mutate the original list', () {
      final originalOrder = deals.map((d) => d.id).toList();
      applyDealFilter(deals, null);
      expect(deals.map((d) => d.id).toList(), originalOrder);
    });
  });
}
