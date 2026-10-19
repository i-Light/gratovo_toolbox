import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The per-run search options -- these values get written into
/// `run_config.json` right before every launch and actually change what
/// `search.py` does. They replaced an earlier, decorative version of this
/// same panel whose `SearchSortBy`/`SearchResultsType` values (subscribers/
/// recentActivity/averageViews, channels/videos) didn't correspond to
/// anything the real pipeline did. These do -- they're a direct mirror of
/// `scrapetube.get_search()`'s own `sort_by`/`results_type` parameters,
/// which `search.py` now passes straight through.
enum SearchSortBy {
  relevance,
  uploadDate,
  viewCount,
  rating;

  /// The exact string `scrapetube.get_search(sort_by: ...)` expects.
  String get wireValue => switch (this) {
        SearchSortBy.relevance => 'relevance',
        SearchSortBy.uploadDate => 'upload_date',
        SearchSortBy.viewCount => 'view_count',
        SearchSortBy.rating => 'rating',
      };
}

/// Only "video" and "channel" are offered -- scrapetube also supports
/// "playlist"/"movie", but neither is a meaningful way to discover an
/// influencer *channel* to reach out to (see search.py's `discover_handles`
/// doc comment for the parsing-shape reason those two aren't wired up at
/// all, not just hidden here).
enum SearchResultsType {
  video,
  channel;

  /// The exact string `scrapetube.get_search(results_type: ...)` expects.
  String get wireValue => switch (this) {
        SearchResultsType.video => 'video',
        SearchResultsType.channel => 'channel',
      };
}

/// The countries a run targets out of the box: the native-English, high-CPM
/// markets (United States, United Kingdom, Canada, Australia, New Zealand,
/// Ireland). Picked because these are where an English-language sponsorship is
/// worth the most per view; clear the filter to fall back to "any country".
const Set<String> kDefaultSearchCountries = {
  'US',
  'GB',
  'CA',
  'AU',
  'NZ',
  'IE',
};

class SearchSettings {
  const SearchSettings({
    this.sortBy = SearchSortBy.uploadDate,
    this.resultsType = SearchResultsType.video,
    this.countries = kDefaultSearchCountries,
    this.handleLimitOverride = 200,
  });

  final SearchSortBy sortBy;
  final SearchResultsType resultsType;

  /// A set of ISO-3166 alpha-2 codes (e.g. {"US", "GB"}). Empty means "any
  /// country" -- the same convention `search.py`'s `COUNTRY_FILTER` uses.
  /// Matched against each discovered channel's own `snippet.country` (YouTube
  /// Studio's "Channel country" setting) after channel metadata is fetched; a
  /// channel is kept when its country is in this set. A channel with no country
  /// set on YouTube never matches a filter that IS set, so it's excluded, not
  /// silently kept. Defaults to [kDefaultSearchCountries] -- clear it to fall
  /// back to "any country".
  final Set<String> countries;

  /// Defaults to 200 handles. Pass null to instead use whatever Settings →
  /// Search Tuning has saved -- the shared, team-wide default. A non-null
  /// value here is a one-run override, written into `run_config.json` and
  /// never persisted anywhere past this run.
  ///
  /// How far back to look for a channel's recent videos used to be overridable
  /// here too, and before that lived as a shared `recent_videos_months` value
  /// in `settings.json`. Both are gone now: nothing in the pipeline ever
  /// actually read that value back out to filter by recency, so there was no
  /// real behavior left to override.
  final int? handleLimitOverride;

  SearchSettings copyWith({
    SearchSortBy? sortBy,
    SearchResultsType? resultsType,
    Set<String>? countries,
    int? Function()? handleLimitOverride,
  }) {
    return SearchSettings(
      sortBy: sortBy ?? this.sortBy,
      resultsType: resultsType ?? this.resultsType,
      countries: countries ?? this.countries,
      handleLimitOverride: handleLimitOverride != null
          ? handleLimitOverride()
          : this.handleLimitOverride,
    );
  }

  /// The stored codes, trimmed, upper-cased and de-duplicated. The one place
  /// the rest of the class should read the country set from.
  Set<String> get normalizedCountries => {
        for (final code in countries)
          if (code.trim().isNotEmpty) code.trim().toUpperCase(),
      };

  /// The `run_config.json` payload `search.py` reads (see its doc comment
  /// for the exact keys). A pure function on purpose -- unit-testable
  /// without touching a file or a process.
  Map<String, Object?> toRunConfigJson() {
    final codes = normalizedCountries.toList()..sort();
    return {
      'sort_by': sortBy.wireValue,
      'results_type': resultsType.wireValue,
      if (codes.isNotEmpty) 'countries': codes,
      if (handleLimitOverride != null) 'handle_limit': handleLimitOverride,
    };
  }
}

class SearchSettingsNotifier extends Notifier<SearchSettings> {
  @override
  SearchSettings build() => const SearchSettings();

  void setSortBy(SearchSortBy sortBy) {
    state = state.copyWith(sortBy: sortBy);
  }

  void setResultsType(SearchResultsType resultsType) {
    state = state.copyWith(resultsType: resultsType);
  }

  /// Replace the whole country set. An empty set means "any country".
  void setCountries(Set<String> countries) {
    state = state.copyWith(countries: {
      for (final code in countries)
        if (code.trim().isNotEmpty) code.trim().toUpperCase(),
    });
  }

  /// Add or remove a single ISO-3166 code, leaving the rest of the set alone.
  void toggleCountry(String code, bool selected) {
    final next = {...state.normalizedCountries};
    final normalized = code.trim().toUpperCase();
    if (normalized.isEmpty) return;
    if (selected) {
      next.add(normalized);
    } else {
      next.remove(normalized);
    }
    state = state.copyWith(countries: next);
  }

  /// Pass null to clear the override and go back to the shared default.
  void setHandleLimitOverride(int? limit) {
    state = state.copyWith(handleLimitOverride: () => limit);
  }
}

final searchSettingsProvider =
    NotifierProvider<SearchSettingsNotifier, SearchSettings>(
  SearchSettingsNotifier.new,
);
