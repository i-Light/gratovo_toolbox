import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/data/models/channel_stats.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Whether the Dashboard shows its analytics section at all.
///
/// Full authority only. The two RPCs behind it refuse anyone else in their own
/// first statement, which is what actually enforces this — but a section that
/// renders as an error for half the team is worse than a section that is not
/// there, and an aggregate over every channel the agency has found is exactly
/// the kind of answer the `basic` level exists to withhold: it describes the
/// roster completely without handing over one row of it.
final canSeeChannelAnalyticsProvider = Provider<bool>((ref) {
  return ref.watch(accessLevelProvider).seesSensitiveData;
});

/// What the analytics section is narrowed to.
///
/// One notifier holding the whole query, rather than a provider per dropdown.
/// The charts all describe the same population, so a half-applied filter — four
/// controls that update independently and a request fired between two of them —
/// would draw a page whose parts answer different questions.
class ChannelStatsFilterNotifier extends Notifier<ChannelStatsQuery> {
  @override
  ChannelStatsQuery build() => const ChannelStatsQuery();

  void setQuery(ChannelStatsQuery query) => state = query;

  void clear() => state = const ChannelStatsQuery();
}

final channelStatsFilterProvider =
    NotifierProvider<ChannelStatsFilterNotifier, ChannelStatsQuery>(
  ChannelStatsFilterNotifier.new,
);

/// Which of the three series — live, archive-due and archived — the analytics
/// charts draw.
///
/// [archiveDue] is a subset of the live population (a channel counting down to
/// archival has not left `channels` yet), while the archive is a genuinely
/// separate one stacked on top. All three are shown by default; the legend
/// beside the figures is a trio of checkboxes that drop any series from the
/// view without touching the filter, for reading the truly-live shape on its
/// own or for seeing how much of a tier is about to be lost. View state only —
/// it never reaches the query, so nothing is re-fetched when it flips.
class ChannelStatsSeriesNotifier
    extends Notifier<({bool live, bool archiveDue, bool archived})> {
  @override
  ({bool live, bool archiveDue, bool archived}) build() =>
      (live: true, archiveDue: true, archived: true);

  void setLive(bool value) => state =
      (live: value, archiveDue: state.archiveDue, archived: state.archived);

  void setArchiveDue(bool value) =>
      state = (live: state.live, archiveDue: value, archived: state.archived);

  void setArchived(bool value) =>
      state = (live: state.live, archiveDue: state.archiveDue, archived: value);
}

final channelStatsSeriesProvider = NotifierProvider<ChannelStatsSeriesNotifier,
    ({bool live, bool archiveDue, bool archived})>(
  ChannelStatsSeriesNotifier.new,
);

/// The numbers, for one filter.
///
/// A family keyed on the query rather than a notifier that refetches: two
/// filters a person is flipping between are then two cached answers, and
/// [ChannelStatsQuery] has value equality precisely so this works — without it
/// every rebuild would hand over an identical-but-new key and re-run an
/// aggregate over the whole channel table.
final channelStatsProvider =
    FutureProvider.family<ChannelStats, ChannelStatsQuery>((ref, query) {
  return ref.watch(channelStatsRepositoryProvider).load(query);
});

/// What the filter dropdowns offer.
///
/// Not keyed on the query: these are the options, and narrowing them by the
/// current filter would make the dropdown you just used drop the value you
/// chose, leaving no way back.
final channelStatsFacetsProvider = FutureProvider<ChannelStatsFacets>((ref) {
  return ref.watch(channelStatsRepositoryProvider).facets();
});

/// Backs the checkbox next to each label on a tier distribution chart — see
/// [ColumnChart.independentKeys] — with one persisted set of bucket keys per
/// chart, so a per-tier choice survives a restart instead of resetting to the
/// default every time the Dashboard is opened.
class _IndependentKeysNotifier extends Notifier<Set<String>> {
  _IndependentKeysNotifier({required this.prefKey, required this.defaults});

  final String prefKey;
  final Set<String> defaults;

  @override
  Set<String> build() {
    unawaited(_loadPersisted());
    return defaults;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getStringList(prefKey);
      if (saved == null) return;
      state = saved.toSet();
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load a chart independent-scale preference; keeping the default.',
        name: 'gratovo.dashboard',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> set(Set<String> keys) async {
    state = keys;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setStringList(prefKey, keys.toList());
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist a chart independent-scale preference.',
        name: 'gratovo.dashboard',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

/// `<10K` starts on for both tier charts: it is usually most of the channels,
/// and left off it sets the peak and squashes every other tier down to a
/// sliver.
const _defaultIndependentKeys = {'<10K'};

final tiersIndependentKeysProvider =
    NotifierProvider<_IndependentKeysNotifier, Set<String>>(
  () => _IndependentKeysNotifier(
    prefKey: 'gratovo.dashboard.tiersIndependentKeys',
    defaults: _defaultIndependentKeys,
  ),
);

final viewTiersIndependentKeysProvider =
    NotifierProvider<_IndependentKeysNotifier, Set<String>>(
  () => _IndependentKeysNotifier(
    prefKey: 'gratovo.dashboard.viewTiersIndependentKeys',
    defaults: _defaultIndependentKeys,
  ),
);
