import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/influencers/application/channel_arrivals_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One line above the list saying that it just grew, and what put the rows
/// there.
///
/// The complaint it answers is short: channels keep appearing while the app is
/// open and nothing anywhere says what is adding them. Three mechanisms can do
/// it and not one of them is something a person pressed — the mirror's regular
/// pull, the catch-up pull a teammate's push asks for, and a search this app
/// resumed by itself at launch after a session that was killed mid-run. See
/// `ChannelArrivalsNotifier` for how the source is decided, and why only two
/// answers are offered rather than a guess at a third.
///
/// Renders nothing almost all of the time, and clears itself after
/// `_noticeLifetime` — this is an explanation, not an inbox.
class ChannelArrivalsNotice extends ConsumerWidget {
  const ChannelArrivalsNotice({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final arrivals = ref.watch(channelArrivalsProvider);
    if (arrivals == null) return const SizedBox.shrink();

    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final message = switch (arrivals.source) {
      ChannelArrivalSource.localRun =>
        l10n.channelArrivalsFromSearch(arrivals.count),
      ChannelArrivalSource.teamSync =>
        l10n.channelArrivalsFromTeam(arrivals.count),
    };

    return Material(
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        child: Row(
          children: [
            Icon(
              arrivals.source == ChannelArrivalSource.localRun
                  ? Icons.travel_explore
                  : Icons.cloud_download_outlined,
              size: 16,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            TextButton(
              onPressed: () =>
                  ref.read(channelArrivalsProvider.notifier).dismiss(),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(l10n.channelArrivalsDismiss),
            ),
          ],
        ),
      ),
    );
  }
}
