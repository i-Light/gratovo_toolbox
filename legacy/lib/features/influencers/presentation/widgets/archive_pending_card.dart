import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The warning that this channel is about to be deleted.
///
/// The 7 days between tagging a channel rejected and archiving it exist as a
/// grace period for a mis-tag — tagging is one right-click, and what it causes
/// is permanent and cascades through every video, note and contact on the row.
/// A grace period nobody can see is not a grace period, so this card says the
/// date out loud, names what will be lost, and puts the way out ("keep this
/// channel") beside the way forward rather than only in a menu.
///
/// Renders nothing at all when the channel is not on that path, so the profile
/// page can include it unconditionally.
class ArchivePendingCard extends ConsumerWidget {
  const ArchivePendingCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final due = influencer.archiveDueAt;
    if (due == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final scheme = theme.colorScheme;

    // Whichever rejecting tag is on it, strongest first. Falls back to
    // `irrelevant` only if the date is somehow set with no tag, which the
    // trigger should prevent.
    final label = ChannelTag.archiveLabelFor(influencer.channelTags) ??
        ChannelTag.irrelevant;

    return Card(
      // Error-colored rather than a neutral card. This is the only surface in
      // the app that announces an imminent, unrecoverable delete, and it should
      // not read like an ordinary section heading.
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.schedule_outlined,
                    size: 20, color: scheme.onErrorContainer),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.influencerArchivePendingTitle,
                    style: theme.textTheme.titleSmall
                        ?.copyWith(color: scheme.onErrorContainer),
                  ),
                ),
                Text(
                  l10n.influencerArchivesIn(influencer.daysUntilArchive ?? 0),
                  style: theme.textTheme.labelLarge
                      ?.copyWith(color: scheme.onErrorContainer),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              l10n.influencerArchivePendingBody(
                label.label(l10n),
                fmt.date(due),
              ),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: scheme.onErrorContainer),
            ),
            const SizedBox(height: 12),
            // A Wrap: two buttons and their labels do not reliably fit a phone
            // width side by side, and a Row would overflow rather than reflow.
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.tonalIcon(
                  onPressed: () => _keep(context, ref),
                  icon: const Icon(Icons.undo, size: 18),
                  label: Text(l10n.influencerArchiveKeep),
                ),
                TextButton.icon(
                  onPressed: () => _archiveNow(context, ref),
                  icon: const Icon(Icons.delete_forever_outlined, size: 18),
                  label: Text(l10n.influencerArchiveNow),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Keeping the channel is removing the rejecting tags, not clearing the date.
  ///
  /// The database recomputes the date from the tags on every write, so clearing
  /// the date alone would simply re-arm a fresh 7 days. More to the point, a
  /// channel still tagged `irrelevant` has not been reprieved — it has been
  /// postponed, and saying otherwise on screen would be a lie the next sweep
  /// exposes.
  Future<void> _keep(BuildContext context, WidgetRef ref) async {
    final kept = [
      for (final tag in influencer.channelTags)
        if (!tag.isRejecting) tag,
    ];
    await guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () => ref
          .read(influencerRepositoryProvider)
          .updateChannelTags(influencer.id, kept, base: influencer.channelTags),
      log: (logger) => logger.channelTagsChanged(
        influencer,
        before: influencer.channelTags,
        after: kept,
      ),
      patchList: (current) =>
          current.copyWith(channelTags: kept, clearArchiveDueAt: true),
      successMessage: l10n.influencerArchiveKept,
    );
  }

  Future<void> _archiveNow(BuildContext context, WidgetRef ref) async {
    // Confirmed, and the dialog spells out what goes rather than asking "are
    // you sure?" about an unnamed thing. This is the one control in the app
    // that shortens the only safety margin the archive has.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.influencerArchiveNowConfirmTitle),
        content: Text(l10n.influencerArchiveNowConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.commonCancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.influencerArchiveNowConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    final now = DateTime.now().toUtc();
    await guardInfluencerMutation(
      context,
      ref,
      influencer,
      // Not a compare-and-set edit, so there is no base and nothing that can
      // conflict: this moves the due date forward rather than changing a field
      // somebody else might have been looking at. Bringing the date forward
      // twice is idempotent.
      action: () async {
        await ref.read(influencerRepositoryProvider).archiveNow(influencer.id);
        return EditOutcome.applied;
      },
      // The row is on its way out, not merely re-dated — but it is the server
      // that decides that, and the tombstone reaches this machine by the same
      // sync every other deletion does. Until it lands the honest thing to show
      // is a channel due now, which is what this is.
      patchList: (current) => current.copyWith(archiveDueAt: now),
      successMessage: l10n.influencerArchiveScheduled,
    );
    // A channel just entered the archive. The guard announces `channels` and
    // `activity`; the Archive page reads neither, and it is the one screen
    // where this action's result actually shows up.
    ref.bumpData(const {DataDomain.archive});
  }
}
