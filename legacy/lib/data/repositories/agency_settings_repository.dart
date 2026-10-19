import 'package:gratovo_toolbox/data/models/agency_settings.dart';

/// The agency's own facts — one shared row (`agency_settings`), edited from
/// Settings and read by the drafting engine, the boycott check and the daily
/// target. Last write wins: it is one card a person saves whole.
abstract class AgencySettingsRepository {
  /// The saved facts, or the house defaults when nobody has saved yet.
  Future<AgencySettings> get();

  Future<void> save(AgencySettings settings);
}
