import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/data/models/aws_gateway_settings.dart';
import 'package:gratovo_toolbox/data/repositories/aws_gateway_repository.dart';

/// The real, file-backed [AwsGatewayRepository]. Reads and writes
/// `data/aws_gateways.json` -- see [AwsGatewaySettings]'s doc comment.
/// Wired in unconditionally, same reasoning as [LocalSearchTuningRepository]:
/// [ScraperProcess.resolvePaths] already answers null on a platform with no
/// local pipeline, and this falls back to [AwsGatewaySettings.empty] there.
class LocalAwsGatewayRepository implements AwsGatewayRepository {
  const LocalAwsGatewayRepository();

  @override
  Future<AwsGatewaySettings> get() async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return AwsGatewaySettings.empty;
    final json = await PipelineSettings.readAwsGateways(paths);
    final rawGateways = json['gateways'];
    return AwsGatewaySettings(
      enabled: json['enabled'] == true,
      gateways: rawGateways is List
          ? rawGateways
              .whereType<Map>()
              .map((e) => AwsGatewayEntry.fromJson(e.cast<String, Object?>()))
              .toList()
          : const [],
    );
  }

  @override
  Future<void> setEnabled(bool enabled) async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return;
    await PipelineSettings.writeAwsGatewayEnabled(paths, enabled);
  }
}
