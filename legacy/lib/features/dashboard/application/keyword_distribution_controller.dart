import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/dashboard/presentation/widgets/keyword_distribution_view.dart';

/// Whether the Dashboard shows the keyword-evaluation card.
///
/// Any authorized account — `full` or `basic`. This is deliberately a wider gate
/// than [canSeeChannelAnalyticsProvider], which is `full` only: that section is
/// an aggregate over subscriber counts and reach, the numbers `basic` exists to
/// withhold. This one is a read on which *search terms* are pulling their
/// weight, which is sourcing hygiene rather than sensitive roster data — a
/// `basic` account that runs searches has a reason to see it. `unauthorized`
/// reads nothing anywhere, so it is still out.
final canSeeKeywordDistributionProvider = Provider<bool>((ref) {
  return ref.watch(accessLevelProvider).isAuthorized;
});

/// The chosen sort — view state, so flipping it re-orders the loaded list
/// without re-reading anything. [KeywordSortBy] and the ranking it implies live
/// in `keyword_distribution_view.dart`, next to the model they order.
class KeywordSortNotifier extends Notifier<KeywordSortBy> {
  @override
  KeywordSortBy build() => KeywordSortBy.tierWeightedScore;

  void set(KeywordSortBy value) => state = value;
}

final keywordSortProvider =
    NotifierProvider<KeywordSortNotifier, KeywordSortBy>(
        KeywordSortNotifier.new);

/// The roster grouped by the keyword each channel was found under, with every
/// channel's trailing-30-day median view count as its tier value.
///
/// One [InfluencerRepository.keywordViewSamples] plus one
/// [ArchiveRepository.keywordViewSamples] and a fold in Dart. Those are
/// two-column reads joined in the database; this used to be `getAll()` on
/// both, which decoded the whole roster into objects to use two numbers from
/// each — and re-ran on every channel edit while the Dashboard was open. It
/// still re-reads whenever channel *or* archive data moves, like every other
/// derived provider; the reads are just cheap enough now for that to be fine.
///
/// The archived side is what turns this from "which terms bring in watched
/// channels" into "which terms bring in watched channels *and* how much of what
/// they bring in we end up rejecting" — a keyword that keeps sourcing channels
/// the team archives is one to reconsider, and that is invisible if the archive
/// is left out. Each archived channel is folded in under every keyword in its
/// `found_via`, kept separate from the live count so the card's Live /
/// Archive due / Archived toggles can show any mix of the three.
///
/// The live population is itself split on [Influencer.isPendingArchive]: a
/// channel already counting down to archival is a preview of what the
/// archived side is about to grow by, so it gets its own bucket instead of
/// silently padding out "Live".
///
/// A channel with no measured median views counts as zero under each of its
/// keywords — the same rule the analytics view-tier chart follows, and for the
/// same reason: with the auto-clean rule on, "no median" almost always means
/// "archived or tagged before its videos were fetched, for being too small",
/// which is exactly what a keyword should be marked down for. See
/// [KeywordViewSample].
final keywordDistributionProvider =
    FutureProvider<List<KeywordViewData>>((ref) async {
  if (!ref.watch(canSeeKeywordDistributionProvider)) return const [];
  ref.watch(dataRevisionProvider(DataDomain.channels));
  ref.watch(dataRevisionProvider(DataDomain.archive));

  final live =
      await ref.watch(influencerRepositoryProvider).keywordViewSamples();
  final archived =
      await ref.watch(archiveRepositoryProvider).keywordViewSamples();

  final liveByKeyword = <String, List<int>>{};
  final archiveDueByKeyword = <String, List<int>>{};
  for (final sample in live) {
    final key = sample.keyword.trim();
    if (key.isEmpty) continue;
    final byKeyword =
        sample.pendingArchive ? archiveDueByKeyword : liveByKeyword;
    byKeyword.putIfAbsent(key, () => <int>[]).add(sample.medianViews);
  }

  final archivedByKeyword = <String, List<int>>{};
  for (final sample in archived) {
    final key = sample.keyword.trim();
    if (key.isEmpty) continue;
    archivedByKeyword.putIfAbsent(key, () => <int>[]).add(sample.medianViews);
  }

  final keys = {
    ...liveByKeyword.keys,
    ...archiveDueByKeyword.keys,
    ...archivedByKeyword.keys,
  };
  return [
    for (final key in keys)
      KeywordViewData(
        keyword: key,
        channelViews: liveByKeyword[key] ?? const [],
        archiveDueChannelViews: archiveDueByKeyword[key] ?? const [],
        archivedChannelViews: archivedByKeyword[key] ?? const [],
      ),
  ];
});
