import 'package:gratovo_toolbox/data/models/aws_gateway_settings.dart';

/// Read access to `data/aws_gateways.json` and the one field this app is
/// allowed to change in it -- see [AwsGatewaySettings]'s doc comment for why
/// the gateway list itself is not editable here.
abstract class AwsGatewayRepository {
  Future<AwsGatewaySettings> get();

  Future<void> setEnabled(bool enabled);
}
