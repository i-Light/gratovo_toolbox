import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/native/scraper_process_types.dart';

void main() {
  group('ScraperProcessPaths.dbPath', () {
    test('is a plain forward-slash join, not platform-aware', () {
      const paths = ScraperProcessPaths(
        pipelineDir: r'C:\proj\pipeline',
        dataDir: r'C:\proj\data',
      );
      expect(paths.dbPath, r'C:\proj\data/database/gratovo.db');
    });

    // The databases sit one level below `data/` so that the folder holding
    // them can be gitignored whole, without a rule that also has to dodge
    // `settings.json` and `keywords.json`. Pinned here because the Python side
    // (`config.DATABASE_DIR`) derives the same folder independently, and the
    // two agreeing is what keeps the app and the pipeline reading one file.
    test('the databases live in a database/ folder under data/', () {
      const paths = ScraperProcessPaths(
        pipelineDir: r'C:\proj\pipeline',
        dataDir: r'C:\proj\data',
      );
      expect(paths.databaseDir, r'C:\proj\data/database');
      expect(paths.dbPath, startsWith(paths.databaseDir));
    });
  });

  group('ProcessResultLite.succeeded', () {
    test('is true only for exit code 0', () {
      expect(
        const ProcessResultLite(exitCode: 0, output: '').succeeded,
        isTrue,
      );
      expect(
        const ProcessResultLite(exitCode: 1, output: 'boom').succeeded,
        isFalse,
      );
    });
  });

  group('normalizeKeywords', () {
    test('keeps the typed order', () {
      expect(
        normalizeKeywords(['tech review', 'travel vlog']),
        ['tech review', 'travel vlog'],
      );
    });

    test('drops blank/whitespace-only entries', () {
      expect(
        normalizeKeywords(['tech review', '', '  ', 'travel']),
        ['tech review', 'travel'],
      );
    });

    test('trims whitespace before comparing and storing', () {
      expect(normalizeKeywords([' tech review ']), ['tech review']);
    });

    test('dedupes, keeping the first occurrence', () {
      expect(normalizeKeywords(['a', 'b', 'a']), ['a', 'b']);
    });

    test('an empty list stays empty', () {
      expect(normalizeKeywords([]), isEmpty);
    });
  });
}
