/// One person's own AWS IAM access key pair for
/// `tools/aws_gateway_setup.py` -- recorded so the team can see who is
/// holding which key and when it last changed. This is bookkeeping, not a
/// live credential store: the script itself still only ever reads
/// `data/.env` on the machine it runs on (see that script's module doc
/// comment). Every field is blank until that person fills the form in --
/// there is no migration to run for an account created before this table
/// existed.
class AwsGatewayCredentials {
  const AwsGatewayCredentials({
    required this.userId,
    required this.accessKeyId,
    required this.secretAccessKey,
    required this.defaultRegions,
    required this.updatedAt,
  });

  final String userId;
  final String accessKeyId;
  final String secretAccessKey;
  final String defaultRegions;

  /// Null only for a row that has never been saved.
  final DateTime? updatedAt;

  bool get isBlank => accessKeyId.isEmpty && secretAccessKey.isEmpty;

  static AwsGatewayCredentials blank(String userId) => AwsGatewayCredentials(
        userId: userId,
        accessKeyId: '',
        secretAccessKey: '',
        defaultRegions: '',
        updatedAt: null,
      );

  factory AwsGatewayCredentials.fromRow(Map<String, Object?> row) {
    return AwsGatewayCredentials(
      userId: row['user_id'] as String,
      accessKeyId: row['access_key_id'] as String? ?? '',
      secretAccessKey: row['secret_access_key'] as String? ?? '',
      defaultRegions: row['default_regions'] as String? ?? '',
      updatedAt: DateTime.tryParse('${row['updated_at']}')?.toUtc(),
    );
  }
}

/// One saved snapshot of [AwsGatewayCredentials] -- a row in the append-only
/// history table, for the "what did this hold before" list and the
/// "restore this" action. Never mutated once written.
class AwsGatewayCredentialVersion {
  const AwsGatewayCredentialVersion({
    required this.id,
    required this.userId,
    required this.accessKeyId,
    required this.secretAccessKey,
    required this.defaultRegions,
    required this.savedAt,
  });

  final String id;
  final String userId;
  final String accessKeyId;
  final String secretAccessKey;
  final String defaultRegions;
  final DateTime savedAt;

  factory AwsGatewayCredentialVersion.fromRow(Map<String, Object?> row) {
    return AwsGatewayCredentialVersion(
      id: row['id'] as String,
      userId: row['user_id'] as String,
      accessKeyId: row['access_key_id'] as String? ?? '',
      secretAccessKey: row['secret_access_key'] as String? ?? '',
      defaultRegions: row['default_regions'] as String? ?? '',
      savedAt: DateTime.tryParse('${row['saved_at']}')?.toUtc() ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }
}
