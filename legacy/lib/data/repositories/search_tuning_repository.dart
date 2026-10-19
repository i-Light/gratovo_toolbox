import 'package:gratovo_toolbox/data/models/proxy_entry.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';

/// One shared row of scraper pacing/proxy/threshold tunables — see
/// [SearchTuningSettings]'s doc comment. Backed by `data/settings.json`
/// (`LocalSearchTuningRepository`), the same file `config.py` reads on every
/// run — see that class for the exact key mapping. Each [ProxyEntry]'s
/// password lives here rather than secure storage because the Python
/// pipeline has to be able to read it, and this file is the only thing
/// that crosses the Flutter/Python boundary — same tradeoff as any other
/// credential in this file, not a gap specific to proxies.
abstract class SearchTuningRepository {
  Future<SearchTuningSettings> get();

  Future<void> update(SearchTuningSettings settings);
}
