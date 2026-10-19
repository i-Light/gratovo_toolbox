import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';

/// Which stage the team-wide Deal list is currently filtered to. Null means
/// "show every stage." A plain `Notifier<DealStage?>` plus a pure filter
/// function, same split as `influencer_filter_controller.dart` — testable
/// without pumping a widget tree.
class DealFilterNotifier extends Notifier<DealStage?> {
  @override
  DealStage? build() => null;

  void setStage(DealStage? stage) => state = stage;
}

final dealFilterProvider = NotifierProvider<DealFilterNotifier, DealStage?>(
  DealFilterNotifier.new,
);

/// Applies the current stage filter and sorts most-recently-updated first.
List<Deal> applyDealFilter(List<Deal> deals, DealStage? stage) {
  final filtered = stage == null
      ? deals.toList()
      : deals.where((d) => d.stage == stage).toList();
  filtered.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
  return filtered;
}
