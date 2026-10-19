import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/features/conflicts/application/conflict_controller.dart';
import 'package:gratovo_toolbox/features/conflicts/presentation/conflict_field_label.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// "An edit to this channel needs a decision."
///
/// The conflicts page can be reached from the shell strip, but a conflict is
/// about *this* channel's notes or tags, and the page where somebody is about
/// to edit those is the page where they need to know. Without this, the second
/// person would open the profile, see the field holding the winning value with
/// nothing to say a rejected version exists, and edit straight over the
/// disagreement.
///
/// Sits beside the presence borders in `core/presence/`, which warn that
/// somebody *has* a field open. This is the same warning after the fact: the
/// two edits already diverged. Deliberately the same shape of message.
///
/// Renders nothing while the list is loading, empty, or failed. A banner that
/// flickered in on every page load would train people to ignore it, and a
/// failure to count conflicts is not itself news about this channel.
class ConflictBannerCard extends ConsumerWidget {
  const ConflictBannerCard({
    super.key,
    required this.influencerId,
    required this.l10n,
  });

  final String influencerId;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conflicts =
        ref.watch(conflictsForChannelProvider(influencerId)).value ?? const [];
    if (conflicts.isEmpty) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Padding(
      // Its own leading gap rather than the caller's, so the profile does not
      // have to hold a SizedBox that only sometimes belongs to something.
      padding: const EdgeInsets.only(top: 16),
      child: Card(
        margin: EdgeInsets.zero,
        color: scheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
          child: Row(
            children: [
              Icon(Icons.call_split, color: scheme.onErrorContainer),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.conflictProfileBannerTitle(conflicts.length),
                      style: theme.textTheme.titleSmall
                          ?.copyWith(color: scheme.onErrorContainer),
                    ),
                    const SizedBox(height: 4),
                    // Names the fields, so somebody about to edit Notes can tell
                    // at a glance whether this concerns them.
                    Text(
                      conflicts
                          .map((c) => conflictFieldLabel(l10n, c.field))
                          .toSet()
                          .join(' · '),
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: scheme.onErrorContainer),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              TextButton(
                onPressed: () =>
                    context.push(AppRoutes.conflictsForChannel(influencerId)),
                style: TextButton.styleFrom(
                  foregroundColor: scheme.onErrorContainer,
                ),
                child: Text(l10n.conflictProfileBannerAction),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
