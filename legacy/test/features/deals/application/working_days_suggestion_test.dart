import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/features/deals/application/working_days_suggestion.dart';

Deal _dealWith({
  DealStage stage = DealStage.signed,
  required DateTime createdAt,
  required DateTime updatedAt,
}) {
  return Deal(
    id: 'deal_x',
    brandId: 'brand_x',
    influencerId: 'inf_x',
    stage: stage,
    brandPrice: 1000,
    influencerPayout: 750,
    createdAt: createdAt,
    updatedAt: updatedAt,
  );
}

OutreachMessage _outbound(DateTime at) => OutreachMessage(
      id: 'msg_${at.millisecondsSinceEpoch}',
      threadId: 'thread_x',
      direction: MessageDirection.outbound,
      subject: 'Hi',
      body: 'body',
      at: at,
      method: ContactMethod.email,
    );

OutreachMessage _inbound(DateTime at) => OutreachMessage(
      id: 'msg_in_${at.millisecondsSinceEpoch}',
      threadId: 'thread_x',
      direction: MessageDirection.inbound,
      subject: 'Re: Hi',
      body: 'reply',
      at: at,
      method: ContactMethod.email,
    );

void main() {
  group('businessDaysBetween', () {
    test('same day is zero', () {
      final day = DateTime(2026, 9, 14); // a Monday
      expect(businessDaysBetween(day, day), 0);
    });

    test('end before start is zero', () {
      expect(
        businessDaysBetween(DateTime(2026, 9, 14), DateTime(2026, 9, 10)),
        0,
      );
    });

    test('counts a plain Mon-Fri span with no weekend in it', () {
      // Monday 14th -> Wednesday 16th: Tue, Wed = 2 working days.
      expect(
        businessDaysBetween(DateTime(2026, 9, 14), DateTime(2026, 9, 16)),
        2,
      );
    });

    test('skips a weekend that falls inside the span', () {
      // Friday 2026-09-18 -> Monday 2026-09-21: Sat/Sun are skipped, only
      // Monday counts.
      expect(
        businessDaysBetween(DateTime(2026, 9, 18), DateTime(2026, 9, 21)),
        1,
      );
    });

    test('a full Mon-Fri work week is 5 days', () {
      // Sunday 2026-09-13 -> Friday 2026-09-18 covers exactly Mon-Fri once.
      expect(
        businessDaysBetween(DateTime(2026, 9, 13), DateTime(2026, 9, 18)),
        5,
      );
    });

    test('two full weekends in a two-week span are both skipped', () {
      // Monday 2026-09-07 -> Friday 2026-09-18: 10 weekdays, two weekends
      // fall strictly inside (12-13 and, not included since the 18th is the
      // end, only one full weekend is skipped: 12-13).
      expect(
        businessDaysBetween(DateTime(2026, 9, 7), DateTime(2026, 9, 18)),
        9,
      );
    });

    test('ignores the time-of-day component, only the calendar date counts',
        () {
      final start = DateTime(2026, 9, 14, 23, 59);
      final end = DateTime(2026, 9, 15, 0, 1);
      expect(businessDaysBetween(start, end), 1);
    });
  });

  group('computeWorkingDaysSuggestion', () {
    test('no data yet: no outbound message shows nothing', () {
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
          stage: DealStage.signed,
          createdAt: DateTime(2026, 9, 1),
          updatedAt: DateTime(2026, 9, 10),
        ),
        messages: const [],
      );
      expect(result, isNull);
    });

    test('no data yet: only inbound messages (no outbound yet) shows nothing',
        () {
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
          stage: DealStage.signed,
          createdAt: DateTime(2026, 9, 1),
          updatedAt: DateTime(2026, 9, 10),
        ),
        messages: [_inbound(DateTime(2026, 9, 2))],
      );
      expect(result, isNull);
    });

    test('deal has not reached agreed yet shows nothing even with outreach',
        () {
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
          stage: DealStage.negotiating,
          createdAt: DateTime(2026, 9, 1),
          updatedAt: DateTime(2026, 9, 10),
        ),
        messages: [_outbound(DateTime(2026, 9, 1))],
      );
      expect(result, isNull);
    });

    test(
        'a deal lost out of negotiating shows nothing (never confirmed to '
        'have reached agreed)', () {
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
          stage: DealStage.lost,
          createdAt: DateTime(2026, 9, 1),
          updatedAt: DateTime(2026, 9, 10),
        ),
        messages: [_outbound(DateTime(2026, 9, 1))],
      );
      expect(result, isNull);
    });

    test('zero-day span (created and updated same day) shows nothing', () {
      final same = DateTime(2026, 9, 14);
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
            stage: DealStage.agreed, createdAt: same, updatedAt: same),
        messages: [_outbound(same)],
      );
      expect(result, isNull);
    });

    test(
        'agreed with outreach present computes a suggestion from '
        'created -> updated', () {
      final created = DateTime(2026, 9, 7); // Monday
      final updated = DateTime(2026, 9, 14); // next Monday
      final result = computeWorkingDaysSuggestion(
        deal: _dealWith(
          stage: DealStage.agreed,
          createdAt: created,
          updatedAt: updated,
        ),
        messages: [_outbound(created)],
      );
      expect(result, isNotNull);
      expect(result!.workingDays, 5);
      expect(result.from, created);
      expect(result.to, updated);
    });

    for (final stage in [
      DealStage.agreed,
      DealStage.contractSent,
      DealStage.signed,
      DealStage.live,
      DealStage.closed,
    ]) {
      test('computes for stage $stage (reached at least agreed)', () {
        final created = DateTime(2026, 9, 7);
        final updated = DateTime(2026, 9, 9);
        final result = computeWorkingDaysSuggestion(
          deal: _dealWith(stage: stage, createdAt: created, updatedAt: updated),
          messages: [_outbound(created)],
        );
        expect(result, isNotNull, reason: 'stage $stage should suggest');
      });
    }

    for (final stage in [
      DealStage.proposed,
      DealStage.negotiating,
    ]) {
      test('shows nothing for stage $stage (not yet at agreed)', () {
        final created = DateTime(2026, 9, 7);
        final updated = DateTime(2026, 9, 9);
        final result = computeWorkingDaysSuggestion(
          deal: _dealWith(stage: stage, createdAt: created, updatedAt: updated),
          messages: [_outbound(created)],
        );
        expect(result, isNull, reason: 'stage $stage should not suggest');
      });
    }
  });
}
