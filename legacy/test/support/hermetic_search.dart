import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:gratovo_toolbox/data/models/aws_gateway_settings.dart';
import 'package:gratovo_toolbox/data/models/search_run.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';
import 'package:gratovo_toolbox/data/repositories/aws_gateway_repository.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/data/repositories/search_repository.dart';
import 'package:gratovo_toolbox/data/repositories/search_tuning_repository.dart';

/// Overrides that stop a widget test of the Search page from reading *this
/// machine's* pipeline files.
///
/// The three repositories behind the page are wired to the real local files
/// unconditionally (`repository_providers.dart` explains why), so a test that
/// mounts `SearchScreen` without overriding them reads whatever the person
/// running it has on disk: their `gratovo.db`, their `settings.json`, their
/// `aws_gateways.json`. That is not a hypothetical. The newest search row in a
/// developer's database is very often one that is still `running`, and the
/// progress panel then paints a live run -- a pulsing dot and a ticking clock
/// -- that never lets `pumpAndSettle` finish. Eight tests failed with
/// `pumpAndSettle timed out` on such a machine and passed on a clean checkout.
///
/// Every value defaults to "nothing there": no run, the stock tuning, no
/// gateways deployed.
List<Override> hermeticSearchOverrides({
  SearchRun? latestRun,
  SearchTuningSettings tuning = SearchTuningSettings.defaults,
  AwsGatewaySettings aws = AwsGatewaySettings.empty,
}) {
  return [
    searchRepositoryProvider
        .overrideWithValue(_FixedSearchRepository(latestRun)),
    searchTuningRepositoryProvider
        .overrideWithValue(_FixedTuningRepository(tuning)),
    awsGatewayRepositoryProvider.overrideWithValue(_FixedAwsRepository(aws)),
  ];
}

class _FixedSearchRepository implements SearchRepository {
  const _FixedSearchRepository(this.run);

  final SearchRun? run;

  @override
  Future<SearchRun?> getCurrentRun() async => run;
}

class _FixedTuningRepository implements SearchTuningRepository {
  _FixedTuningRepository(this.settings);

  SearchTuningSettings settings;

  @override
  Future<SearchTuningSettings> get() async => settings;

  @override
  Future<void> update(SearchTuningSettings next) async => settings = next;
}

class _FixedAwsRepository implements AwsGatewayRepository {
  _FixedAwsRepository(this.settings);

  AwsGatewaySettings settings;

  @override
  Future<AwsGatewaySettings> get() async => settings;

  @override
  Future<void> setEnabled(bool enabled) async {
    settings =
        AwsGatewaySettings(enabled: enabled, gateways: settings.gateways);
  }
}
