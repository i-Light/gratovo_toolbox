import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// The agency's facts as the app currently holds them. Re-reads whenever the
/// row changes — a save here, or a teammate's save arriving by sync.
class AgencySettingsController extends AsyncNotifier<AgencySettings> {
  @override
  Future<AgencySettings> build() {
    ref.watch(dataRevisionProvider(DataDomain.agency));
    return ref.watch(agencySettingsRepositoryProvider).get();
  }

  /// Saves [settings] for the whole team, then lets every reader re-read.
  Future<void> save(AgencySettings settings) async {
    await ref.read(agencySettingsRepositoryProvider).save(settings);
    ref.bumpData({DataDomain.agency});
  }
}

final agencySettingsProvider =
    AsyncNotifierProvider<AgencySettingsController, AgencySettings>(
  AgencySettingsController.new,
);
