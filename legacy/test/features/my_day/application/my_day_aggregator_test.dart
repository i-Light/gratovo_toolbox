import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_aggregator.dart';
import 'package:gratovo_toolbox/features/my_day/application/my_day_models.dart';

void main() {
  final now = DateTime.utc(2026, 9, 19, 12);

  Deal deal({
    String id = 'deal_1',
    String influencerId = 'inf_1',
    String? ownerId,
    DateTime? creatorPayoutDueAt,
    DateTime? creatorPayoutPaidAt,
    DateTime? brandInvoiceSentAt,
    DateTime? brandInvoicePaidAt,
    DateTime? deadline,
  }) =>
      Deal(
        id: id,
        brandId: 'brand_1',
        influencerId: influencerId,
        stage: DealStage.signed,
        brandPrice: 1000,
        influencerPayout: 700,
        createdAt: now,
        updatedAt: now,
        ownerId: ownerId,
        deadline: deadline,
        creatorPayoutDueAt: creatorPayoutDueAt,
        creatorPayoutPaidAt: creatorPayoutPaidAt,
        brandInvoiceSentAt: brandInvoiceSentAt,
        brandInvoicePaidAt: brandInvoicePaidAt,
      );

  Deliverable deliverable({
    String id = 'deliverable_1',
    String dealId = 'deal_1',
    DeliverableStatus status = DeliverableStatus.pending,
    DateTime? publishedAt,
    DateTime? reportViewsAt,
  }) =>
      Deliverable(
        id: id,
        dealId: dealId,
        status: status,
        publishedAt: publishedAt,
        reportViews: reportViewsAt == null ? null : 1000,
        reportViewsAt: reportViewsAt,
        createdAt: now,
        updatedAt: now,
      );

  OutreachThread thread({
    String id = 'thread_1',
    String influencerId = 'inf_1',
    String? ownerId,
  }) =>
      OutreachThread(
        id: id,
        influencerId: influencerId,
        status: ThreadStatus.awaitingReply,
        updatedAt: now,
        ownerId: ownerId,
      );

  OutreachMessage message({
    required String id,
    required String threadId,
    required MessageDirection direction,
    required DateTime at,
  }) =>
      OutreachMessage(
        id: id,
        threadId: threadId,
        direction: direction,
        subject: 'subject',
        body: 'body',
        at: at,
      );

  FollowUpReminder reminder({
    String id = 'reminder_1',
    required DateTime dueAt,
    String? dealId,
    String? influencerId,
    bool isDone = false,
    ReminderKind kind = ReminderKind.followUp,
  }) =>
      FollowUpReminder(
        id: id,
        title: 'Chase them',
        dueAt: dueAt,
        kind: kind,
        dealId: dealId,
        influencerId: influencerId,
        isDone: isDone,
      );

  List<MyDayItem> run({
    String? currentUserId = 'me',
    List<Deal> deals = const [],
    List<Deliverable> deliverables = const [],
    List<OutreachThread> threads = const [],
    List<OutreachMessage> messages = const [],
    List<FollowUpReminder> reminders = const [],
  }) =>
      computeMyDayItems(
        currentUserId: currentUserId,
        deals: deals,
        deliverables: deliverables,
        threads: threads,
        messages: messages,
        reminders: reminders,
        now: now,
      );

  group('the 30-day report', () {
    Deliverable published(DateTime at, {DateTime? reportViewsAt}) =>
        deliverable(
          status: DeliverableStatus.published,
          publishedAt: at,
          reportViewsAt: reportViewsAt,
        );

    test('is asked for 30 days after the video went live', () {
      final items = run(
        deals: [deal(ownerId: 'me')],
        deliverables: [published(now.subtract(const Duration(days: 30)))],
      );

      final item = items.single;
      expect(item.type, MyDayItemType.reportDue);
      expect(item.urgency, MyDayUrgency.dueSoon);
      expect(item.anchorAt, now);
      expect(item.dealId, 'deal_1');
      expect(item.deliverableId, 'deliverable_1');
    });

    test('is not asked for before day 30', () {
      final items = run(
        deals: [deal(ownerId: 'me')],
        deliverables: [published(now.subtract(const Duration(days: 29)))],
      );

      expect(items, isEmpty);
    });

    test('is overdue a few days after it was due', () {
      final items = run(
        deals: [deal(ownerId: 'me')],
        deliverables: [published(now.subtract(const Duration(days: 34)))],
      );

      expect(items.single.urgency, MyDayUrgency.overdue);
    });

    test('is gone once the report is taken', () {
      final items = run(
        deals: [deal(ownerId: 'me')],
        deliverables: [
          published(now.subtract(const Duration(days: 40)),
              reportViewsAt: now.subtract(const Duration(days: 5))),
        ],
      );

      expect(items, isEmpty);
    });

    test('belongs to whoever owns the deal', () {
      final items = run(
        deals: [deal(ownerId: 'them')],
        deliverables: [published(now.subtract(const Duration(days: 31)))],
      );

      expect(items, isEmpty);
    });
  });

  group('payout due', () {
    test('surfaces an unpaid payout due within the soon window', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          creatorPayoutDueAt: now.add(const Duration(days: 1)),
        ),
      ]);
      expect(items, hasLength(1));
      expect(items.single.type, MyDayItemType.payoutDue);
      expect(items.single.urgency, MyDayUrgency.dueSoon);
    });

    test('marks a payout due in the past as overdue', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          creatorPayoutDueAt: now.subtract(const Duration(days: 2)),
        ),
      ]);
      expect(items.single.urgency, MyDayUrgency.overdue);
    });

    test('omits a payout already paid', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          creatorPayoutDueAt: now.subtract(const Duration(days: 2)),
          creatorPayoutPaidAt: now.subtract(const Duration(days: 1)),
        ),
      ]);
      expect(items, isEmpty);
    });

    test('omits a payout due well beyond the soon window', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          creatorPayoutDueAt: now.add(const Duration(days: 30)),
        ),
      ]);
      expect(items, isEmpty);
    });
  });

  group('invoice unpaid', () {
    test('is due-soon while recently sent', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          brandInvoiceSentAt: now.subtract(const Duration(days: 2)),
        ),
      ]);
      expect(items.single.type, MyDayItemType.invoiceUnpaid);
      expect(items.single.urgency, MyDayUrgency.dueSoon);
    });

    test('becomes overdue past the aging threshold', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          brandInvoiceSentAt: now.subtract(const Duration(days: 20)),
        ),
      ]);
      expect(items.single.urgency, MyDayUrgency.overdue);
    });

    test('omits an invoice already marked paid', () {
      final items = run(deals: [
        deal(
          ownerId: 'me',
          brandInvoiceSentAt: now.subtract(const Duration(days: 20)),
          brandInvoicePaidAt: now.subtract(const Duration(days: 1)),
        ),
      ]);
      expect(items, isEmpty);
    });
  });

  group('deliverable due', () {
    test('surfaces an unpublished deliverable on a deal deadline due soon', () {
      final items = run(
        deals: [
          deal(ownerId: 'me', deadline: now.add(const Duration(days: 1)))
        ],
        deliverables: [deliverable(status: DeliverableStatus.drafted)],
      );
      expect(items.single.type, MyDayItemType.deliverableDue);
      expect(items.single.urgency, MyDayUrgency.dueSoon);
    });

    test('omits a published deliverable', () {
      final items = run(
        deals: [
          deal(ownerId: 'me', deadline: now.subtract(const Duration(days: 1)))
        ],
        deliverables: [deliverable(status: DeliverableStatus.published)],
      );
      expect(items, isEmpty);
    });

    test('omits a deliverable whose deal has no deadline', () {
      final items = run(
        deals: [deal(ownerId: 'me')],
        deliverables: [deliverable()],
      );
      expect(items, isEmpty);
    });
  });

  group('outreach needs reply', () {
    test('surfaces a thread whose last message is inbound', () {
      final items = run(
        threads: [thread(ownerId: 'me')],
        messages: [
          message(
            id: 'm1',
            threadId: 'thread_1',
            direction: MessageDirection.outbound,
            at: now.subtract(const Duration(days: 3)),
          ),
          message(
            id: 'm2',
            threadId: 'thread_1',
            direction: MessageDirection.inbound,
            at: now.subtract(const Duration(hours: 1)),
          ),
        ],
      );
      expect(items.single.type, MyDayItemType.outreachNeedsReply);
      expect(items.single.urgency, MyDayUrgency.dueSoon);
    });

    test('is overdue once the reply window has elapsed', () {
      final items = run(
        threads: [thread(ownerId: 'me')],
        messages: [
          message(
            id: 'm1',
            threadId: 'thread_1',
            direction: MessageDirection.inbound,
            at: now.subtract(const Duration(days: 5)),
          ),
        ],
      );
      expect(items.single.urgency, MyDayUrgency.overdue);
    });

    test('omits a thread whose last message is outbound', () {
      final items = run(
        threads: [thread(ownerId: 'me')],
        messages: [
          message(
            id: 'm1',
            threadId: 'thread_1',
            direction: MessageDirection.inbound,
            at: now.subtract(const Duration(days: 2)),
          ),
          message(
            id: 'm2',
            threadId: 'thread_1',
            direction: MessageDirection.outbound,
            at: now.subtract(const Duration(days: 1)),
          ),
        ],
      );
      expect(items, isEmpty);
    });

    test('omits a thread with no messages at all', () {
      final items = run(threads: [thread(ownerId: 'me')]);
      expect(items, isEmpty);
    });
  });

  group('follow-up reminders', () {
    test('surfaces an open reminder due soon', () {
      final items = run(reminders: [
        reminder(dueAt: now.add(const Duration(hours: 6))),
      ]);
      expect(items.single.type, MyDayItemType.followUpDue);
      expect(items.single.urgency, MyDayUrgency.dueSoon);
      // No deal/influencer link -> unassigned -> visible to anyone.
      expect(items.single.ownerId, isNull);
    });

    test('omits a reminder already marked done', () {
      final items = run(reminders: [
        reminder(dueAt: now.subtract(const Duration(days: 1)), isDone: true),
      ]);
      expect(items, isEmpty);
    });

    test('resolves ownership through the linked deal when present', () {
      final items = run(
        deals: [deal(id: 'deal_9', ownerId: 'someone_else')],
        reminders: [
          reminder(dueAt: now.add(const Duration(hours: 1)), dealId: 'deal_9'),
        ],
      );
      // Owned by someone else via the deal -> not mine -> excluded.
      expect(items, isEmpty);
    });

    test('resolves ownership through the linked thread when no deal', () {
      final items = run(
        threads: [thread(id: 'thread_5', influencerId: 'inf_5', ownerId: 'me')],
        reminders: [
          reminder(
            dueAt: now.add(const Duration(hours: 1)),
            influencerId: 'inf_5',
          ),
        ],
      );
      expect(items, hasLength(1));
      expect(items.single.ownerId, 'me');
    });
  });

  group('ownership filtering', () {
    test('excludes an item owned by someone else', () {
      final items = run(deals: [
        deal(
          ownerId: 'someone_else',
          creatorPayoutDueAt: now.add(const Duration(hours: 1)),
        ),
      ]);
      expect(items, isEmpty);
    });

    test('includes an unassigned item regardless of current user', () {
      final items = run(deals: [
        deal(creatorPayoutDueAt: now.add(const Duration(hours: 1))),
      ]);
      expect(items, hasLength(1));
    });

    test('a signed-out session (null current user) sees only unassigned items',
        () {
      final items = run(
        currentUserId: null,
        deals: [
          deal(
            id: 'deal_mine',
            creatorPayoutDueAt: now.add(const Duration(hours: 1)),
          ),
          deal(
            id: 'deal_owned',
            ownerId: 'me',
            creatorPayoutDueAt: now.add(const Duration(hours: 1)),
          ),
        ],
      );
      expect(items, hasLength(1));
      expect(items.single.dealId, 'deal_mine');
    });
  });

  group('sort order', () {
    test('overdue items lead, each group soonest/most-overdue first', () {
      final items = run(deals: [
        deal(
          id: 'due_soon_later',
          ownerId: 'me',
          creatorPayoutDueAt: now.add(const Duration(days: 2)),
        ),
        deal(
          id: 'due_soon_sooner',
          ownerId: 'me',
          creatorPayoutDueAt: now.add(const Duration(hours: 1)),
        ),
        deal(
          id: 'overdue_recent',
          ownerId: 'me',
          creatorPayoutDueAt: now.subtract(const Duration(hours: 1)),
        ),
        deal(
          id: 'overdue_ancient',
          ownerId: 'me',
          creatorPayoutDueAt: now.subtract(const Duration(days: 5)),
        ),
      ]);

      expect(
        items.map((i) => i.dealId).toList(),
        [
          'overdue_ancient',
          'overdue_recent',
          'due_soon_sooner',
          'due_soon_later',
        ],
      );
    });
  });
}
