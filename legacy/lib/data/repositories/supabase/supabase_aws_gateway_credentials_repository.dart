import 'package:gratovo_toolbox/data/models/aws_gateway_credentials.dart';
import 'package:gratovo_toolbox/data/repositories/aws_gateway_credentials_repository.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The real [AwsGatewayCredentialsRepository] -- talks to Supabase directly,
/// not through the local-first mirror every other repository in this app
/// uses (`repository_providers.dart`'s doc comment: "Nothing in this file
/// talks to Supabase").
///
/// That mirror pulls a table's rows down to local disk on every signed-in
/// machine, which is exactly wrong for a secret access key: the RLS policy
/// restricts each row to its own owner already, but a secret is worth not
/// persisting to a second, less-audited copy on disk if there is no need to.
/// This is the same carve-out `currentProfileProvider`/`teamMembersProvider`
/// (`supabase_client_provider.dart`) and the account color picker
/// (`account_card.dart`) already make for identity data -- a small, explicit
/// list of things read and written straight from PostgREST.
class SupabaseAwsGatewayCredentialsRepository
    implements AwsGatewayCredentialsRepository {
  const SupabaseAwsGatewayCredentialsRepository(this._client, this._userId);

  final SupabaseClient _client;
  final String _userId;

  @override
  Future<AwsGatewayCredentials> getMine() async {
    final row = await _client
        .from('aws_gateway_credentials')
        .select()
        .eq('user_id', _userId)
        .maybeSingle();
    return row == null
        ? AwsGatewayCredentials.blank(_userId)
        : AwsGatewayCredentials.fromRow(row);
  }

  @override
  Future<List<AwsGatewayCredentialVersion>> getMyHistory({
    int limit = 50,
  }) async {
    final rows = await _client
        .from('aws_gateway_credential_history')
        .select()
        .eq('user_id', _userId)
        .order('saved_at', ascending: false)
        .limit(limit);
    return [
      for (final row in rows) AwsGatewayCredentialVersion.fromRow(row),
    ];
  }

  @override
  Future<void> saveMine({
    required String accessKeyId,
    required String secretAccessKey,
    required String defaultRegions,
  }) async {
    await _client.from('aws_gateway_credentials').upsert({
      'user_id': _userId,
      'access_key_id': accessKeyId,
      'secret_access_key': secretAccessKey,
      'default_regions': defaultRegions,
    });

    try {
      await _client.from('aws_gateway_credential_history').insert({
        'user_id': _userId,
        'access_key_id': accessKeyId,
        'secret_access_key': secretAccessKey,
        'default_regions': defaultRegions,
      });
    } catch (_) {
      // Swallowed on purpose -- see the interface doc comment.
    }
  }
}
