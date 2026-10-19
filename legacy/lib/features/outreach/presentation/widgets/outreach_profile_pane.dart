import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_profile_body.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// The channel's full profile page, docked beside the composer on the widest
/// Outreach layout — the recent-upload times, the CRM numbers, the notes, all
/// of it, right where the message is being written.
///
/// Takes the thread id and resolves the influencer from it, so the screen
/// never has to unwrap an async provider to place this pane.
///
/// Passes `withEditingScope: false` to [InfluencerProfileBody]: the standalone
/// [InfluencerProfileScreen] may still be alive in its own nav branch, and two
/// live `EditingScope`s claiming the same `('channel', id)` would double-count
/// presence. Not kept alive on thread switch — it re-mounts, so its many
/// provider subscriptions don't pile up.
class OutreachProfilePane extends ConsumerWidget {
  const OutreachProfilePane({super.key, required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final threadAsync = ref.watch(threadByIdProvider(threadId));
    final influencerId = threadAsync.asData?.value?.influencerId;

    if (influencerId == null) {
      return const Card(
        clipBehavior: Clip.antiAlias,
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final influencerAsync = ref.watch(influencerByIdProvider(influencerId));

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    influencerAsync.maybeWhen(
                      data: (influencer) =>
                          influencer?.displayName ?? l10n.navInfluencers,
                      orElse: () => l10n.navInfluencers,
                    ),
                    style: theme.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                EntityPresenceAvatars(type: 'channel', id: influencerId),
                IconButton(
                  tooltip: l10n.outreachOpenFullProfile,
                  icon: const Icon(Icons.open_in_full),
                  onPressed: () =>
                      context.go(AppRoutes.influencerDetail(influencerId)),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: InfluencerProfileBody(
              influencerId: influencerId,
              withEditingScope: false,
              padding: const EdgeInsets.all(16),
            ),
          ),
        ],
      ),
    );
  }
}
