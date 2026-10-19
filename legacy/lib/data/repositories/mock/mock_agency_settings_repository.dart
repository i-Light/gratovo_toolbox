import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/repositories/agency_settings_repository.dart';

/// In-memory [AgencySettingsRepository], starting from the house defaults.
class MockAgencySettingsRepository implements AgencySettingsRepository {
  AgencySettings _settings = const AgencySettings();

  @override
  Future<AgencySettings> get() async => _settings;

  @override
  Future<void> save(AgencySettings settings) async => _settings = settings;
}
