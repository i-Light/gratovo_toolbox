import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';

Deal _dealWith(DealStage stage) {
  final now = DateTime(2026, 1, 1);
  return Deal(
    id: 'deal_x',
    brandId: 'brand_x',
    influencerId: 'inf_x',
    stage: stage,
    brandPrice: 1000,
    influencerPayout: 750,
    createdAt: now,
    updatedAt: now,
  );
}

void main() {
  group('Deal', () {
    test('margin is brandPrice minus influencerPayout', () {
      expect(_dealWith(DealStage.negotiating).margin, 250);
    });

    test('isActive is true for every non-terminal stage', () {
      for (final stage in [
        DealStage.proposed,
        DealStage.negotiating,
        DealStage.agreed,
        DealStage.contractSent,
        DealStage.signed,
        DealStage.live,
      ]) {
        expect(_dealWith(stage).isActive, isTrue,
            reason: '$stage should be active');
      }
    });

    test('isActive is false once closed or lost', () {
      expect(_dealWith(DealStage.closed).isActive, isFalse);
      expect(_dealWith(DealStage.lost).isActive, isFalse);
    });

    test('isWon is true only when closed', () {
      expect(_dealWith(DealStage.closed).isWon, isTrue);
      expect(_dealWith(DealStage.lost).isWon, isFalse);
      expect(_dealWith(DealStage.negotiating).isWon, isFalse);
    });

    group('copyWith', () {
      test('changes only the fields passed, leaving the rest untouched', () {
        final original = _dealWith(DealStage.proposed);
        final updated = original.copyWith(stage: DealStage.negotiating);

        expect(updated.stage, DealStage.negotiating);
        expect(updated.id, original.id);
        expect(updated.brandPrice, original.brandPrice);
        expect(updated.influencerPayout, original.influencerPayout);
        expect(updated.notes, original.notes);
      });

      test('bumps updatedAt to now when no explicit value is passed', () {
        final original = _dealWith(DealStage.proposed);
        final before = DateTime.now();
        final updated = original.copyWith(notes: 'countered at \$2,800');
        final after = DateTime.now();

        expect(
          updated.updatedAt.isAfter(before) ||
              updated.updatedAt.isAtSameMomentAs(before),
          isTrue,
        );
        expect(
          updated.updatedAt.isBefore(after) ||
              updated.updatedAt.isAtSameMomentAs(after),
          isTrue,
        );
      });

      test('an explicit updatedAt overrides the default-to-now behavior', () {
        final original = _dealWith(DealStage.proposed);
        final explicit = DateTime(2030, 5, 1);
        final updated = original.copyWith(updatedAt: explicit);

        expect(updated.updatedAt, explicit);
      });
    });
  });
}
