import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';

/// Which classification the conversation list is narrowed to, or null for
/// "every thread".
///
/// Session-only, same reasoning as the toggles in outreach_layout_controller
/// — a filter picked while triaging today's replies is not a preference
/// worth remembering across launches.
class OutreachClassificationFilterNotifier
    extends Notifier<MessageClassification?> {
  @override
  MessageClassification? build() => null;

  void set(MessageClassification? value) => state = value;
}

final outreachClassificationFilterProvider = NotifierProvider<
    OutreachClassificationFilterNotifier, MessageClassification?>(
  OutreachClassificationFilterNotifier.new,
);

/// The classification of the most recent classified message on [threadId] —
/// what the filter above matches against. Null when nothing on the thread
/// has been classified yet.
final threadLatestClassificationProvider =
    FutureProvider.family<MessageClassification?, String>(
        (ref, threadId) async {
  final messages = await ref.watch(messagesByThreadProvider(threadId).future);
  for (final message in messages.reversed) {
    final classification = message.classification;
    if (classification != null) return classification;
  }
  return null;
});

/// Every thread whose latest classification is [classification] — the
/// thread list's filtered view. One query per thread, which is fine at this
/// app's scale (a team's own outreach, not a mail provider's).
final threadsByClassificationProvider =
    FutureProvider.family<Set<String>, MessageClassification>(
        (ref, classification) async {
  final threads = await ref.watch(allOutreachThreadsProvider.future);
  final matches = await Future.wait(threads.map((OutreachThread thread) async {
    final latest =
        await ref.watch(threadLatestClassificationProvider(thread.id).future);
    return latest == classification ? thread.id : null;
  }));
  return matches.whereType<String>().toSet();
});
