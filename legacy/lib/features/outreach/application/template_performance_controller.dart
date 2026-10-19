import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// How one [EmailTemplate] has actually performed across every thread it was
/// used in: how often it was sent, what share of those sends got a reply,
/// and how long a reply typically took.
///
/// A "reply" is any inbound message that lands in the same thread at a later
/// timestamp than the outbound message that used this template. That is
/// deliberately broader than "the very next message in the thread" — a
/// thread can carry more than one outbound send (this template or another)
/// before anyone replies, and crediting the template only when it happens to
/// be the last thing sent before the reply would undercount templates that
/// get reused inside a single conversation. [averageTimeToReply] measures
/// against the *first* qualifying inbound message after each send, so it
/// reads as "how long this template's sends typically sat before something
/// came back."
///
/// This is a pure rollup over [OutreachMessage] rows that already exist —
/// `direction`, `at` and `templateId` — nothing new is tracked to build it.
class TemplatePerformanceStats {
  const TemplatePerformanceStats({
    required this.templateId,
    required this.templateName,
    required this.timesUsed,
    required this.repliedCount,
    required this.averageTimeToReply,
  });

  final String templateId;
  final String templateName;

  /// How many outbound messages carried this template's [OutreachMessage.templateId].
  final int timesUsed;

  /// Of those, how many had at least one later inbound message on the same
  /// thread.
  final int repliedCount;

  /// The mean of (first qualifying inbound `at` − outbound `at`) across
  /// every send that got a reply. Null when [repliedCount] is 0 — there is
  /// nothing to average, and a `Duration.zero` would misreport "replies
  /// come back instantly."
  final Duration? averageTimeToReply;

  /// [repliedCount] over [timesUsed], or 0 for a template that has never
  /// been sent — an unused template has no rate to report, and 0 keeps the
  /// view from doing that division itself.
  double get replyRate => timesUsed == 0 ? 0 : repliedCount / timesUsed;
}

/// The pure aggregation: every [templates] entry against [messagesByThread]
/// — every thread's messages, keyed by thread id, exactly the shape
/// `OutreachRepository.getMessages` returns per thread (this looks at every
/// message pairwise within a thread, so the messages' own order does not
/// matter, only which thread they belong to).
///
/// Every template in [templates] appears in the result, including one that
/// has never been sent (`timesUsed: 0`) — the stats section is about the
/// whole library, not just the templates that happen to have history.
List<TemplatePerformanceStats> computeTemplatePerformance({
  required List<EmailTemplate> templates,
  required Map<String, List<OutreachMessage>> messagesByThread,
}) {
  return [
    for (final template in templates)
      _statsFor(template, messagesByThread.values),
  ];
}

TemplatePerformanceStats _statsFor(
  EmailTemplate template,
  Iterable<List<OutreachMessage>> threads,
) {
  var timesUsed = 0;
  var repliedCount = 0;
  var totalTimeToReply = Duration.zero;

  for (final messages in threads) {
    for (final sent in messages) {
      if (sent.direction != MessageDirection.outbound) continue;
      if (sent.templateId != template.id) continue;
      timesUsed++;

      OutreachMessage? firstReply;
      for (final candidate in messages) {
        if (candidate.direction != MessageDirection.inbound) continue;
        if (!candidate.at.isAfter(sent.at)) continue;
        if (firstReply == null || candidate.at.isBefore(firstReply.at)) {
          firstReply = candidate;
        }
      }
      if (firstReply != null) {
        repliedCount++;
        totalTimeToReply += firstReply.at.difference(sent.at);
      }
    }
  }

  return TemplatePerformanceStats(
    templateId: template.id,
    templateName: template.name,
    timesUsed: timesUsed,
    repliedCount: repliedCount,
    averageTimeToReply:
        repliedCount == 0 ? null : totalTimeToReply ~/ repliedCount,
  );
}

/// A rough single unit to show an [averageTimeToReply] in, picked by
/// magnitude: days once it's at least one full day, otherwise hours once
/// it's at least one full hour, otherwise minutes. One unit reads faster
/// than "1d 4h 12m" on a stats line, and the reply-rate figure next to it
/// already carries the precision that matters.
({String unit, int value}) templateReplyDurationBucket(Duration duration) {
  final days = duration.inDays;
  if (days >= 1) return (unit: 'days', value: days);
  final hours = duration.inHours;
  if (hours >= 1) return (unit: 'hours', value: hours);
  return (unit: 'minutes', value: duration.inMinutes);
}

/// Fetches every thread's messages and runs [computeTemplatePerformance]
/// against the current template library.
///
/// [OutreachRepository] has no "every message across every thread" query,
/// only a per-thread one, so this reads [allOutreachThreadsProvider] for the
/// thread ids and then asks the repository for each thread's messages — the
/// same round trip the thread list already makes, just for every thread
/// instead of one. It refreshes whenever [allTemplatesProvider] or
/// [allOutreachThreadsProvider] do, which covers a template edit and, via
/// the same `ref.invalidate(allOutreachThreadsProvider)` calls the compose
/// and thread-detail controllers already make on send/reply, a new message
/// too.
final templatePerformanceProvider =
    FutureProvider<List<TemplatePerformanceStats>>((ref) async {
  final templates = await ref.watch(allTemplatesProvider.future);
  final threads = await ref.watch(allOutreachThreadsProvider.future);
  final repo = ref.watch(outreachRepositoryProvider);

  final messagesByThread = <String, List<OutreachMessage>>{};
  for (final thread in threads) {
    messagesByThread[thread.id] = await repo.getMessages(thread.id);
  }

  return computeTemplatePerformance(
    templates: templates,
    messagesByThread: messagesByThread,
  );
});
