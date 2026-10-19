import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/search_settings_controller.dart';

void main() {
  group('SearchSortBy.wireValue', () {
    test('matches the exact strings scrapetube.get_search expects', () {
      expect(SearchSortBy.relevance.wireValue, 'relevance');
      expect(SearchSortBy.uploadDate.wireValue, 'upload_date');
      expect(SearchSortBy.viewCount.wireValue, 'view_count');
      expect(SearchSortBy.rating.wireValue, 'rating');
    });
  });

  group('SearchResultsType.wireValue', () {
    test('matches the exact strings scrapetube.get_search expects', () {
      expect(SearchResultsType.video.wireValue, 'video');
      expect(SearchResultsType.channel.wireValue, 'channel');
    });
  });

  group('SearchSettings.copyWith', () {
    test('changes only the fields passed', () {
      const original = SearchSettings();
      final updated = original.copyWith(sortBy: SearchSortBy.rating);

      expect(updated.sortBy, SearchSortBy.rating);
      expect(updated.resultsType, original.resultsType);
      expect(updated.countries, original.countries);
    });

    test('leaves an override untouched when its setter is omitted', () {
      const original = SearchSettings(handleLimitOverride: 10);
      final updated = original.copyWith(countries: {'US'});

      expect(updated.handleLimitOverride, 10);
    });

    test('an override can be explicitly cleared back to null', () {
      const original = SearchSettings(handleLimitOverride: 10);
      final updated = original.copyWith(handleLimitOverride: () => null);

      // Cleared, rather than left at 10 -- this is exactly the
      // `int? Function()?` vs `int?` distinction the signature exists for: a
      // plain `int?` could not tell "clear it" apart from "don't touch it".
      expect(updated.handleLimitOverride, isNull);
      expect(updated.countries, const SearchSettings().countries);
    });
  });

  group('SearchSettings.toRunConfigJson', () {
    test('always includes sort_by and results_type', () {
      const settings = SearchSettings();
      final json = settings.toRunConfigJson();

      expect(json['sort_by'], 'upload_date');
      expect(json['results_type'], 'video');
    });

    test('includes the country/handle_limit defaults', () {
      const settings = SearchSettings();
      final json = settings.toRunConfigJson();

      // A sorted list of the native-English, high-CPM markets.
      expect(json['countries'], ['AU', 'CA', 'GB', 'IE', 'NZ', 'US']);
      expect(json['handle_limit'], 200);
    });

    test('omits handle_limit when explicitly cleared', () {
      const settings = SearchSettings(handleLimitOverride: null);
      final json = settings.toRunConfigJson();

      expect(json.containsKey('handle_limit'), isFalse);
    });

    // The per-run recency override is gone. `search.py` still reads
    // `recency_months`, so a stale key here would silently override the
    // shared Search Tuning value the setting now lives in exclusively.
    test('never writes recency_months', () {
      expect(
        const SearchSettings().toRunConfigJson().containsKey('recency_months'),
        isFalse,
      );
    });

    test('trims, uppercases and sorts the country codes', () {
      const settings = SearchSettings(countries: {' us ', 'gb'});
      final json = settings.toRunConfigJson();

      expect(json['countries'], ['GB', 'US']);
    });

    test('an empty country set is treated as "any country"', () {
      const settings = SearchSettings(countries: {});
      final json = settings.toRunConfigJson();

      expect(json.containsKey('countries'), isFalse);
    });

    test('a set of only blank codes is treated as "any country"', () {
      const settings = SearchSettings(countries: {'  ', ''});
      final json = settings.toRunConfigJson();

      expect(json.containsKey('countries'), isFalse);
    });

    test('includes overrides only when they are set', () {
      const settings = SearchSettings(
        sortBy: SearchSortBy.viewCount,
        resultsType: SearchResultsType.channel,
        countries: {'eg'},
        handleLimitOverride: 15,
      );
      final json = settings.toRunConfigJson();

      expect(json, {
        'sort_by': 'view_count',
        'results_type': 'channel',
        'countries': ['EG'],
        'handle_limit': 15,
      });
    });
  });

  group('SearchSettingsNotifier', () {
    test('build() starts from the defaults', () {
      final notifier = SearchSettingsNotifier();
      final state = notifier.build();

      expect(state.sortBy, SearchSortBy.uploadDate);
      expect(state.resultsType, SearchResultsType.video);
      expect(state.countries, kDefaultSearchCountries);
      expect(state.handleLimitOverride, 200);
    });
  });

  group('SearchSettings.normalizedCountries', () {
    test('trims, uppercases and drops blanks', () {
      const settings = SearchSettings(countries: {' us ', 'gb', '', '  '});
      expect(settings.normalizedCountries, {'US', 'GB'});
    });
  });
}
