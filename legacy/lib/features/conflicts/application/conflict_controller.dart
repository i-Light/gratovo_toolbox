import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Every unresolved conflict across the whole database.
///
/// Not paged. A healthy team has none of these and a bad week has a handful; if
/// this list is ever long enough to need paging, the problem is not the page.
final openConflictsProvider = FutureProvider<List<EditConflict>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.conflicts));
  return ref.watch(conflictRepositoryProvider).getOpen();
});

/// Unresolved conflicts on one channel, for the banner on its profile.
///
/// A family rather than a filter over [openConflictsProvider], so a profile
/// page does not have to load every conflict in the database to find out
/// whether it has one.
final conflictsForChannelProvider =
    FutureProvider.family<List<EditConflict>, String>((ref, channelId) {
  ref.watch(dataRevisionProvider(DataDomain.conflicts));
  return ref.watch(conflictRepositoryProvider).getOpenForChannel(channelId);
});

/// Recently settled conflicts.
///
/// Shown because a conflict that simply vanished when someone dealt with it
/// would leave the other person's rejected text disappearing with no record of
/// what happened to it — which is the thing they most want to know.
final resolvedConflictsProvider = FutureProvider<List<EditConflict>>((ref) {
  ref.watch(dataRevisionProvider(DataDomain.conflicts));
  return ref.watch(conflictRepositoryProvider).getResolved();
});

/// How many open conflicts there are, for the badge in the app bar.
final openConflictCountProvider = Provider<int>((ref) {
  return ref.watch(openConflictsProvider).value?.length ?? 0;
});
