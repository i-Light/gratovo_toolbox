import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';

export 'package:gratovo_toolbox/data/models/influencer_query.dart'
    show InfluencerSearchScope, InfluencerSortBy;

/// Whether the list renders as rows or as cards.
///
/// Rows fit more channels on screen and line their numbers up in columns,
/// which is what you want when comparing. Cards show the channel art, which is
/// what you want when deciding whether a channel *looks* like a fit. Neither
/// is right for both jobs, so both exist and the choice is the user's.
enum InfluencerViewMode { list, cards }

/// The Influencer Database list's filter, sort and layout state.
///
/// Holds an [InfluencerQuery] rather than loose fields, because that query is
/// what travels to the database — keeping the screen's state in the same shape
/// the repository takes means there is no translation step that can drift.
class InfluencerFilterNotifier extends Notifier<InfluencerQuery> {
  @override
  InfluencerQuery build() =>
      const InfluencerQuery(sortBy: InfluencerSortBy.medianViews);

  void setSearch(String? text) {
    final trimmed = text?.trim();
    state = state.copyWith(
      search: () => (trimmed == null || trimmed.isEmpty) ? null : trimmed,
    );
  }

  /// Turns one place the search box looks on or off. The last one left on
  /// stays on: a search that looks nowhere finds nothing, and nobody means
  /// that.
  void setSearchScope(InfluencerSearchScope scope, {required bool on}) {
    final next = {...state.searchIn};
    if (on) {
      next.add(scope);
    } else {
      next.remove(scope);
    }
    if (next.isEmpty) return;
    state = state.copyWith(searchIn: next);
  }

  /// Moves [value] into `include` (dropping it from `exclude` if it was
  /// there) when it isn't already included, or clears it out of `include`
  /// when the checkbox is being unchecked. A value can only ever sit in one
  /// of the two sets — checking "include" on a country already marked
  /// "exclude" flips it rather than leaving both checked.
  ({Set<T> include, Set<T> exclude}) _toggleIn<T>(
    Set<T> include,
    Set<T> exclude,
    T value,
  ) {
    final nextInclude = Set<T>.of(include);
    final nextExclude = Set<T>.of(exclude);
    if (!nextInclude.remove(value)) {
      nextInclude.add(value);
      nextExclude.remove(value);
    }
    return (include: nextInclude, exclude: nextExclude);
  }

  ({Set<T> include, Set<T> exclude}) _toggleOut<T>(
    Set<T> include,
    Set<T> exclude,
    T value,
  ) {
    final swapped = _toggleIn(exclude, include, value);
    return (include: swapped.exclude, exclude: swapped.include);
  }

  void toggleIncludeCountry(String code) {
    final r = _toggleIn(state.includeCountries, state.excludeCountries, code);
    state = state.copyWith(
      includeCountries: r.include,
      excludeCountries: r.exclude,
    );
  }

  void toggleExcludeCountry(String code) {
    final r = _toggleOut(state.includeCountries, state.excludeCountries, code);
    state = state.copyWith(
      includeCountries: r.include,
      excludeCountries: r.exclude,
    );
  }

  void toggleIncludeChannelTag(ChannelTag tag) {
    final r =
        _toggleIn(state.includeChannelTags, state.excludeChannelTags, tag);
    state = state.copyWith(
      includeChannelTags: r.include,
      excludeChannelTags: r.exclude,
    );
  }

  void toggleExcludeChannelTag(ChannelTag tag) {
    final r =
        _toggleOut(state.includeChannelTags, state.excludeChannelTags, tag);
    state = state.copyWith(
      includeChannelTags: r.include,
      excludeChannelTags: r.exclude,
    );
  }

  void toggleIncludePipelineStage(PipelineStage stage) {
    final r = _toggleIn(
      state.includePipelineStages,
      state.excludePipelineStages,
      stage,
    );
    state = state.copyWith(
      includePipelineStages: r.include,
      excludePipelineStages: r.exclude,
    );
  }

  void toggleExcludePipelineStage(PipelineStage stage) {
    final r = _toggleOut(
      state.includePipelineStages,
      state.excludePipelineStages,
      stage,
    );
    state = state.copyWith(
      includePipelineStages: r.include,
      excludePipelineStages: r.exclude,
    );
  }

  void setMinSubscribers(int? value) =>
      state = state.copyWith(minSubscribers: () => value);

  void setMaxSubscribers(int? value) =>
      state = state.copyWith(maxSubscribers: () => value);

  void setMinMedianViews(int? value) =>
      state = state.copyWith(minMedianViews: () => value);

  void setMaxMedianViews(int? value) =>
      state = state.copyWith(maxMedianViews: () => value);

  void setDaysSinceLastDeal({int? min, int? max}) => state = state.copyWith(
        minDaysSinceLastDeal: () => min,
        maxDaysSinceLastDeal: () => max,
      );

  /// Changing the sort keeps the filters — they are independent questions, and
  /// resetting one when the other changes is the kind of thing that makes a
  /// list feel like it is fighting you.
  void setSortBy(InfluencerSortBy sortBy) {
    state = state.copyWith(
      sortBy: sortBy,
      // "Time since last deal" is the one sort where ascending is the useful
      // default: the channel you have not spoken to in the longest is the one
      // that needs attention, and that is the LARGEST number of days — but
      // every other sort here wants its largest value first too. The
      // difference is that this one reads naturally as "most overdue first",
      // so it keeps the same descending default rather than being special.
      descending: true,
    );
  }

  /// Turns one quick filter on or off.
  void toggleFlag(InfluencerFlag flag) {
    final next = {...state.requireFlags};
    if (!next.remove(flag)) next.add(flag);
    state = state.copyWith(requireFlags: next);
  }

  void toggleDirection() =>
      state = state.copyWith(descending: !state.descending);

  void clear() => state = InfluencerQuery(sortBy: state.sortBy);
}

final influencerFilterProvider =
    NotifierProvider<InfluencerFilterNotifier, InfluencerQuery>(
  InfluencerFilterNotifier.new,
);

final influencerViewModeProvider =
    NotifierProvider<InfluencerViewModeNotifier, InfluencerViewMode>(
  InfluencerViewModeNotifier.new,
);

class InfluencerViewModeNotifier extends Notifier<InfluencerViewMode> {
  @override
  InfluencerViewMode build() => InfluencerViewMode.cards;

  void set(InfluencerViewMode mode) => state = mode;
}

/// Whether each row/card carries the channel's newest stored upload.
///
/// On by default and session-only. Seeing what a channel most recently
/// uploaded is part of judging it at a glance, so the list starts with it
/// shown; it can still be switched off when the extra query per page and the
/// extra thumbnail per row are not worth the lost density. Session-only
/// because it belongs to the current task rather than being a standing
/// preference about the app.
///
/// The picture switch beside it ([influencerListImagesProvider]) IS persisted,
/// because "this connection cannot carry fifty images" is a fact about where
/// someone works, not about what they are doing this minute.
final influencerListLatestVideoProvider =
    NotifierProvider<InfluencerListLatestVideoNotifier, bool>(
  InfluencerListLatestVideoNotifier.new,
);

class InfluencerListLatestVideoNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void toggle() => state = !state;

  void set(bool value) => state = value;
}

/// The tags a Ctrl + right-click instantly applies to a channel, chosen once
/// via the brush button in the control bar instead of walking the tag menu
/// for each channel individually. Session-only, for the same reason as
/// [influencerListLatestVideoProvider]: it belongs to the current tagging
/// pass, not to the app's standing configuration.
final influencerQuickTagPresetProvider =
    NotifierProvider<InfluencerQuickTagPresetNotifier, List<ChannelTag>>(
  InfluencerQuickTagPresetNotifier.new,
);

class InfluencerQuickTagPresetNotifier extends Notifier<List<ChannelTag>> {
  @override
  List<ChannelTag> build() => const [];

  void set(List<ChannelTag> tags) => state = tags;
}
