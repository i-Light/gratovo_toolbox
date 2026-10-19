import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/capability_gate.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/channel_run.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Reaches further back than the ~15 recent uploads discovery stores.
///
/// This is NOT the Refresh button on the videos card. Refresh re-reads the same
/// recent window and can never surface an older upload; this runs
/// `tools/enrich.py --only backfill`, which scrapes the channel's upload list
/// (free) and then fetches metadata only for the videos not already stored.
/// The distinction matters because the CRM calculator's whole weakness is a
/// thin basis, and only this widens it.
///
/// A section rather than a card: it now lives INSIDE the CRM calculator, which
/// is the one place its purpose is obvious. As its own card above the
/// calculator it was the fix for a problem stated one card lower down, and you
/// had to already know that to find it.
///
/// Desktop-only, like every other action that launches the local pipeline —
/// [DesktopOnly] renders the explanation elsewhere rather than a dead button.
class PullMoreVideosSection extends ConsumerStatefulWidget {
  const PullMoreVideosSection({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  ConsumerState<PullMoreVideosSection> createState() =>
      _PullMoreVideosSectionState();
}

class _PullMoreVideosSectionState extends ConsumerState<PullMoreVideosSection> {
  int _months = 3;

  /// Launches the backfill and returns as soon as it starts — matching
  /// `ScraperProcess.startSearch`'s contract, not the old "wait for the whole
  /// thing" one. Progress from here on is watched from `backfillRunControllerProvider`
  /// (this widget and the Search page's `ChannelRunProgressPanel` both read it),
  /// not from this method: the run is global precisely so it survives leaving
  /// this page. See `BackfillRunNotifier`'s doc comment.
  Future<void> _pull() async {
    final l10n = widget.l10n;
    final notifier = ref.read(backfillRunControllerProvider.notifier);
    if (notifier.isRunning) {
      AppToast.warning(context, l10n.influencerProfilePullAlreadyRunning);
      return;
    }
    // A live search owns the pipeline's database until it ends; the two
    // cannot write it at once. Said plainly here rather than surfacing the
    // generic failure below, since "wait for the search" is actionable and
    // "couldn't start" is not.
    if (ref.read(activeSearchRunControllerProvider.notifier).isRunning) {
      AppToast.warning(context, l10n.influencerProfilePullSearchRunning);
      return;
    }
    try {
      await notifier.runBackfill(
          influencer: widget.influencer, months: _months);
      if (!mounted) return;
      AppToast.success(context, l10n.influencerProfilePullStarted);
    } catch (_) {
      if (!mounted) return;
      AppToast.error(context, l10n.influencerProfilePullFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    // Global, not scoped to this influencer: enrich.py shares one SQLite file
    // and one API-call budget, so only one backfill can usefully run at a
    // time regardless of which profile started it — see [notifier.isRunning].
    final running = ref.watch(backfillRunControllerProvider)?.status ==
        ChannelRunStatus.running;

    return DesktopOnly(
      // A Wrap, not a Row: the label, the dropdown and the button do not fit
      // side by side at phone width, and a Row with a Spacer cannot shrink —
      // it overflows instead. This reflows onto a second line rather than
      // clipping the button.
      child: Wrap(
        spacing: 12,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(l10n.influencerProfilePullMonths),
          DropdownButton<int>(
            value: _months,
            items: [
              for (final months in const [2, 3, 4, 6, 12])
                DropdownMenuItem(value: months, child: Text('$months')),
            ],
            onChanged: running
                ? null
                : (value) {
                    if (value != null) setState(() => _months = value);
                  },
          ),
          if (running)
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            FilledButton.icon(
              onPressed: _pull,
              icon: const Icon(Icons.history),
              label: Text(l10n.influencerProfilePullMore),
            ),
        ],
      ),
    );
  }
}
