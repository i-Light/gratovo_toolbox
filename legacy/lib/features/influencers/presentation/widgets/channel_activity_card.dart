import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/logs/presentation/logs_screen.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What has been done to this one channel, newest first.
///
/// The same rows the Logs page shows, narrowed to this record. Worth having in
/// both places: the Logs page answers "what has the team been doing", and this
/// answers "why does this channel look like this", which is the question you
/// actually have while standing on its profile — particularly when the answer
/// is that a colleague already rejected it and you are about to reach out.
///
/// Capped at a dozen entries rather than paged. A card on a profile is a
/// summary; anyone who needs the whole history has the Logs page, and the link
/// to it is right here.
class ChannelActivityCard extends ConsumerWidget {
  const ChannelActivityCard({
    super.key,
    required this.influencerId,
    required this.l10n,
  });

  final String influencerId;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final entriesAsync = ref.watch(
      activityForEntityProvider((type: 'channel', id: influencerId)),
    );
    final fmt = ref.watch(instantFormatterProvider);

    return CollapsibleCard(
      title: l10n.logsActivityTitle,
      initiallyExpanded: false,
      collapsedSummary: entriesAsync.maybeWhen(
        data: (entries) => Text(
          entries.isEmpty
              ? l10n.logsActivityEmpty
              : l10n.logsShowingCount(entries.length),
        ),
        orElse: () => null,
      ),
      headerTrailing: TextButton(
        onPressed: () => LogsScreen.showAsDialog(context),
        child: Text(l10n.logsActivitySeeAll),
      ),
      child: entriesAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (entries) {
          if (entries.isEmpty) {
            return Text(
              l10n.logsActivityEmpty,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            );
          }
          return Column(
            children: [
              for (final entry in entries)
                _ActivityRow(
                  entry: entry,
                  l10n: l10n,
                  timestamp: fmt.dateTime(entry.at),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    required this.entry,
    required this.l10n,
    required this.timestamp,
  });

  final ActivityLogEntry entry;
  final AppLocalizations l10n;
  final String timestamp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(
              entry.action.icon,
              size: 18,
              color: entry.action.color(context),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: entry.actorName,
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      // The account being gone is worth saying even in the
                      // compact card: it is the difference between someone you
                      // can go and ask and someone you cannot.
                      if (entry.actorIsGone)
                        TextSpan(
                          text: ' (${l10n.logsDeletedAccount})',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.error,
                          ),
                        ),
                      const TextSpan(text: '  '),
                      TextSpan(
                        text: entry.action.label(l10n),
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
                if (_change(l10n) case final change?)
                  Text(
                    change,
                    style: theme.textTheme.bodySmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                Text(
                  timestamp,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Notes are the deliberate exception — recorded by length, never content.
  /// See [ActivityLogger.channelNotesChanged].
  String? _change(AppLocalizations l10n) {
    if (entry.action == ActivityAction.notesChanged) {
      final before = entry.detail?['lengthBefore'];
      final after = entry.detail?['lengthAfter'];
      if (before is int && after is int) {
        return l10n.logsNotesLengthChange(before, after);
      }
      return null;
    }
    final from = entry.oldValue;
    final to = entry.newValue;
    if (from != null && to != null) return l10n.logsValueChange(from, to);
    return to;
  }
}
