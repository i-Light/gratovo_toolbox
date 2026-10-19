import 'package:gratovo_toolbox/data/models/email_template.dart';

/// How the UI reads and edits the outreach template library. See
/// influencer_repository.dart's doc comment for the mock/Supabase swap
/// pattern this follows.
abstract class TemplateRepository {
  Future<List<EmailTemplate>> getAll();

  Future<void> upsert(EmailTemplate template);

  Future<void> delete(String id);
}
