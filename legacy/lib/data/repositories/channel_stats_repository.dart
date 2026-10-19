import 'package:gratovo_toolbox/data/models/channel_stats.dart';

/// Aggregates over the whole channel table, for the Dashboard's analytics
/// section.
///
/// Separate from [InfluencerRepository] rather than two more methods on it, and
/// the reason is the access level rather than tidiness. Every other read of
/// `channels` is open to `basic` authority; these two are not. An aggregate
/// answers "how big is the roster and what is in it" without handing over a
/// single row of it, which is exactly the shape of question the `basic` level
/// exists to withhold — so it lives behind its own interface, its own provider
/// and its own `is_full()` check, where the boundary is one thing to read
/// rather than a condition buried in a method.
///
/// Three implementations, like the other channel-backed repositories: the mock,
/// the network, and — on a machine whose mirror has finished a first sync — the
/// local one. The mirror version came later than the rest and against this
/// file's own earlier advice, which was that six aggregates is one small round
/// trip and that re-expressing them in SQLite would be a second definition of
/// every number on the page. The second half of that is true and is the price;
/// the first half stopped deciding it, because this is a background screen that
/// stays open, and a page nobody is waiting on is the wrong last user of the
/// network. `MirrorChannelStatsRepository` lists every way the two definitions
/// can disagree.
abstract class ChannelStatsRepository {
  /// Every breakdown the analytics section draws, for one filter, from one
  /// scan.
  ///
  /// One call rather than one per chart, because the charts describe the same
  /// population: six independent requests are six scans that can disagree with
  /// each other, and a search run inserting rows between the second and the
  /// fifth produces a page whose totals do not add up with nothing on it to say
  /// so.
  Future<ChannelStats> load(ChannelStatsQuery query);

  /// The values the filter dropdowns offer, read from the data.
  ///
  /// Unfiltered, deliberately — see [ChannelStatsFacets].
  Future<ChannelStatsFacets> facets();
}
