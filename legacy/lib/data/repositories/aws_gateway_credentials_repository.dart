import 'package:gratovo_toolbox/data/models/aws_gateway_credentials.dart';

/// Read/write access to the signed-in person's own AWS IAM key pair and its
/// save history -- see [AwsGatewayCredentials]'s doc comment for what this
/// is (and is not) used for.
///
/// Every method is scoped to "mine": there is deliberately no way to read or
/// write anyone else's row through this interface, matching the database
/// RLS policies (`aws_gateway_credentials_rw`, `..._history_read/_append` in
/// `backend/schema.sql`) that enforce the same thing server-side.
abstract class AwsGatewayCredentialsRepository {
  Future<AwsGatewayCredentials> getMine();

  /// Newest first.
  Future<List<AwsGatewayCredentialVersion>> getMyHistory({int limit = 50});

  /// Upserts the current row and appends one history snapshot.
  ///
  /// The history write is best-effort: if it fails, the save that already
  /// landed in the current row must not be reported as failed for that --
  /// same reasoning as `ActivityLogRepository.record`.
  Future<void> saveMine({
    required String accessKeyId,
    required String secretAccessKey,
    required String defaultRegions,
  });
}
