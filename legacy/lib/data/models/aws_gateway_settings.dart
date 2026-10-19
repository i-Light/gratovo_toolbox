/// One AWS API Gateway endpoint the scraper can route through -- deployed by
/// `tools/aws_gateway_setup.py deploy`, never created or edited from this
/// app. Read-only here: the Settings screen can only see what has been
/// deployed and flip [AwsGatewaySettings.enabled], the same split as
/// `config.load_aws_gateways()` on the Python side.
class AwsGatewayEntry {
  const AwsGatewayEntry({
    required this.region,
    required this.apiId,
    required this.url,
  });

  final String region;
  final String apiId;
  final String url;

  factory AwsGatewayEntry.fromJson(Map<String, Object?> json) {
    return AwsGatewayEntry(
      region: json['region'] as String? ?? '',
      apiId: json['api_id'] as String? ?? '',
      url: json['url'] as String? ?? '',
    );
  }
}

/// Mirrors `data/aws_gateways.json` -- see `config.load_aws_gateways`'s doc
/// comment for why that file is separate from `data/settings.json` (written
/// by a script, embeds this AWS account's own ids, never committed). [enabled]
/// is the only field this app ever writes back; [gateways] is always exactly
/// what the file already holds.
class AwsGatewaySettings {
  const AwsGatewaySettings({
    required this.enabled,
    required this.gateways,
  });

  final bool enabled;
  final List<AwsGatewayEntry> gateways;

  static const empty = AwsGatewaySettings(enabled: false, gateways: []);
}
