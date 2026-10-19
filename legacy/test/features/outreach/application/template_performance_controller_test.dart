import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_outreach_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_template_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/template_performance_controller.dart';

EmailTemplate _template(String id, {String name = 'A template'}) {
  return EmailTemplate(id: id, name: name, subject: 'Subject', body: 'Body');
}

OutreachMessage _message(
  String id, {
  required String threadId,
  required MessageDirection direction,
  required DateTime at,
  String? templateId,
}) {
  return OutreachMessage(
    id: id,
    threadId: threadId,
    direction: direction,
    subject: 'Subject',
    body: 'Body',
    at: at,
    templateId: templateId,
  );
}

final _t0 = DateTime.utc(2026, 1, 1);

void main() {
  group('computeTemplatePerformance', () {
    test('an unused template reports zero usage and no rate', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a')],
        messagesByThread: const {},
      );

      expect(stats, hasLength(1));
      expect(stats.single.timesUsed, 0);
      expect(stats.single.repliedCount, 0);
      expect(stats.single.replyRate, 0);
      expect(stats.single.averageTimeToReply, isNull);
    });

    test('a send with no later inbound message counts as not replied', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a')],
        messagesByThread: {
          'thread_1': [
            _message(
              'm1',
              threadId: 'thread_1',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_a',
            ),
          ],
        },
      );

      final stat = stats.single;
      expect(stat.timesUsed, 1);
      expect(stat.repliedCount, 0);
      expect(stat.replyRate, 0);
      expect(stat.averageTimeToReply, isNull);
    });

    test('an inbound message later in the same thread counts as a reply', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a')],
        messagesByThread: {
          'thread_1': [
            _message(
              'm1',
              threadId: 'thread_1',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_a',
            ),
            _message(
              'm2',
              threadId: 'thread_1',
              direction: MessageDirection.inbound,
              at: _t0.add(const Duration(hours: 6)),
            ),
          ],
        },
      );

      final stat = stats.single;
      expect(stat.timesUsed, 1);
      expect(stat.repliedCount, 1);
      expect(stat.replyRate, 1);
      expect(stat.averageTimeToReply, const Duration(hours: 6));
    });

    test('an earlier inbound message does not count as a reply', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a')],
        messagesByThread: {
          'thread_1': [
            _message(
              'm0',
              threadId: 'thread_1',
              direction: MessageDirection.inbound,
              at: _t0.subtract(const Duration(days: 1)),
            ),
            _message(
              'm1',
              threadId: 'thread_1',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_a',
            ),
          ],
        },
      );

      final stat = stats.single;
      expect(stat.timesUsed, 1);
      expect(stat.repliedCount, 0);
      expect(stat.averageTimeToReply, isNull);
    });

    test(
      'time-to-reply is measured against the first qualifying inbound '
      'message, not the last',
      () {
        final stats = computeTemplatePerformance(
          templates: [_template('tmpl_a')],
          messagesByThread: {
            'thread_1': [
              _message(
                'm1',
                threadId: 'thread_1',
                direction: MessageDirection.outbound,
                at: _t0,
                templateId: 'tmpl_a',
              ),
              _message(
                'm2',
                threadId: 'thread_1',
                direction: MessageDirection.inbound,
                at: _t0.add(const Duration(days: 1)),
              ),
              _message(
                'm3',
                threadId: 'thread_1',
                direction: MessageDirection.inbound,
                at: _t0.add(const Duration(days: 5)),
              ),
            ],
          },
        );

        expect(stats.single.averageTimeToReply, const Duration(days: 1));
      },
    );

    test(
      'two sends of the same template sharing one later reply both count',
      () {
        // A thread can carry more than one send before anyone answers.
        // "At least one later inbound message on the same thread" credits
        // both sends, even though only one inbound message exists.
        final stats = computeTemplatePerformance(
          templates: [_template('tmpl_a')],
          messagesByThread: {
            'thread_1': [
              _message(
                'm1',
                threadId: 'thread_1',
                direction: MessageDirection.outbound,
                at: _t0,
                templateId: 'tmpl_a',
              ),
              _message(
                'm2',
                threadId: 'thread_1',
                direction: MessageDirection.outbound,
                at: _t0.add(const Duration(hours: 1)),
                templateId: 'tmpl_a',
              ),
              _message(
                'm3',
                threadId: 'thread_1',
                direction: MessageDirection.inbound,
                at: _t0.add(const Duration(hours: 3)),
              ),
            ],
          },
        );

        final stat = stats.single;
        expect(stat.timesUsed, 2);
        expect(stat.repliedCount, 2);
        expect(stat.replyRate, 1);
        // (2h + 3h) / 2h... precisely: m1 waits 3h, m2 waits 2h -> avg 2h30m
        expect(stat.averageTimeToReply, const Duration(hours: 2, minutes: 30));
      },
    );

    test('reply rate is computed per template across every thread', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a'), _template('tmpl_b')],
        messagesByThread: {
          'thread_1': [
            _message(
              'm1',
              threadId: 'thread_1',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_a',
            ),
            _message(
              'm2',
              threadId: 'thread_1',
              direction: MessageDirection.inbound,
              at: _t0.add(const Duration(days: 2)),
            ),
          ],
          'thread_2': [
            _message(
              'm3',
              threadId: 'thread_2',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_a',
            ),
            // No reply in this thread.
          ],
          'thread_3': [
            _message(
              'm4',
              threadId: 'thread_3',
              direction: MessageDirection.outbound,
              at: _t0,
              templateId: 'tmpl_b',
            ),
          ],
        },
      );

      final a = stats.firstWhere((s) => s.templateId == 'tmpl_a');
      final b = stats.firstWhere((s) => s.templateId == 'tmpl_b');

      expect(a.timesUsed, 2);
      expect(a.repliedCount, 1);
      expect(a.replyRate, 0.5);
      expect(a.averageTimeToReply, const Duration(days: 2));

      expect(b.timesUsed, 1);
      expect(b.repliedCount, 0);
      expect(b.replyRate, 0);
    });

    test(
        'an outbound message with no template does not count for any '
        'template', () {
      final stats = computeTemplatePerformance(
        templates: [_template('tmpl_a')],
        messagesByThread: {
          'thread_1': [
            _message(
              'm1',
              threadId: 'thread_1',
              direction: MessageDirection.outbound,
              at: _t0,
            ),
          ],
        },
      );

      expect(stats.single.timesUsed, 0);
    });
  });

  group('templateReplyDurationBucket', () {
    test('picks days once at least one full day has passed', () {
      final bucket = templateReplyDurationBucket(const Duration(days: 3));
      expect(bucket.unit, 'days');
      expect(bucket.value, 3);
    });

    test('picks hours below a day but at least one full hour', () {
      final bucket = templateReplyDurationBucket(
        const Duration(hours: 5, minutes: 30),
      );
      expect(bucket.unit, 'hours');
      expect(bucket.value, 5);
    });

    test('picks minutes below an hour', () {
      final bucket = templateReplyDurationBucket(const Duration(minutes: 45));
      expect(bucket.unit, 'minutes');
      expect(bucket.value, 45);
    });
  });

  group('templatePerformanceProvider', () {
    test(
        'wires templates and every thread\'s messages through the '
        'repositories', () async {
      // MockTemplateRepository seeds a handful of starter templates of its
      // own; this only asserts on the one this test adds and cares about.
      final templateRepo = MockTemplateRepository();
      await templateRepo.upsert(_template('tmpl_only', name: 'Only one'));

      final outreachRepo = MockOutreachRepository();
      final thread = await outreachRepo.getOrCreateThreadForInfluencer(
        'inf_stats',
      );
      await outreachRepo.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.outbound,
        subject: 'Hi',
        body: 'Hi',
        method: ContactMethod.email,
        at: _t0,
        templateId: 'tmpl_only',
      );
      await outreachRepo.recordMessage(
        threadId: thread.id,
        direction: MessageDirection.inbound,
        subject: 'Re: Hi',
        body: 'Sure',
        method: ContactMethod.email,
        at: _t0.add(const Duration(hours: 4)),
      );

      final container = ProviderContainer(
        overrides: [
          templateRepositoryProvider.overrideWithValue(templateRepo),
          outreachRepositoryProvider.overrideWithValue(outreachRepo),
        ],
      );
      addTearDown(container.dispose);

      final stats = await container.read(templatePerformanceProvider.future);

      final stat = stats.firstWhere((s) => s.templateId == 'tmpl_only');
      expect(stat.templateName, 'Only one');
      expect(stat.timesUsed, 1);
      expect(stat.repliedCount, 1);
      expect(stat.averageTimeToReply, const Duration(hours: 4));
    });
  });
}
