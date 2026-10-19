import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';

/// Where a team member's own hosted-AI-provider configs (API keys
/// included) live. Unlike every other repository in this codebase, this
/// one is NOT mock-now/Supabase-later — an API key is inherently
/// per-device, per-person, and never belongs in the shared team backend
/// (§10's "AI provider secrets" open question, now resolved: local only,
/// never synced). The real implementation
/// (`secure/secure_ai_provider_config_repository.dart`) is backed by OS-
/// level encrypted storage from day one, so there's no separate "mock
/// today, real later" migration for this one domain — see
/// `repository_providers.dart` for the one place that's wired.
abstract class AiProviderConfigRepository {
  Future<List<AiProviderConfig>> getAll();

  Future<void> upsert(AiProviderConfig config);

  Future<void> delete(String id);
}
