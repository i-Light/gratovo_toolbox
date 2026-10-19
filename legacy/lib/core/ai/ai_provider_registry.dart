import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/anthropic_api_provider.dart';
import 'package:gratovo_toolbox/core/ai/template_fill_ai_provider.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';

/// Every [AiProvider] registered in this build: the always-available
/// `TemplateFillAiProvider` fallback first, then one `AnthropicApiProvider`
/// per config the team member has registered in Settings → AI Providers
/// (`aiProviderConfigsProvider`, backed by encrypted device storage — see
/// `data/repositories/ai_provider_config_repository.dart`).
///
/// Drafting through Gemini is not one of them any more: it lives in the
/// Comms queue, which runs the course-built skill and waits for a person.
///
/// Stays a synchronous `Provider<List<AiProvider>>` (not a `FutureProvider`)
/// on purpose, even though reading configs is async: `maybeWhen` returns
/// just the fallback while that read is in flight or if it fails, so every
/// existing caller (the Outreach compose card's provider dropdown,
/// `selectedAiProviderIdProvider`'s synchronous `build()`) keeps working
/// unchanged — the list simply grows once the async read resolves, and
/// `ref.watch` here means this provider rebuilds when it does.
final aiProvidersProvider = Provider<List<AiProvider>>((ref) {
  final configsAsync = ref.watch(aiProviderConfigsProvider);
  final configured = configsAsync.maybeWhen(
    data: (configs) => [
      for (final config in configs) AnthropicApiProvider(config: config),
    ],
    orElse: () => const <AiProvider>[],
  );
  return [
    TemplateFillAiProvider(),
    ...configured,
  ];
});

/// Which provider id is currently selected. A plain in-memory `Notifier`
/// for now (resets to the default on restart); Phase 4 is where this
/// becomes "selectable per task, per team member" and persisted, per the
/// owner's explicit requirement — the provider *interface* already
/// supports that, this is just where the picker UI and persistence get
/// added.
class SelectedAiProviderIdNotifier extends Notifier<String> {
  @override
  String build() => ref.read(aiProvidersProvider).first.id;

  void select(String id) => state = id;
}

final selectedAiProviderIdProvider =
    NotifierProvider<SelectedAiProviderIdNotifier, String>(
  SelectedAiProviderIdNotifier.new,
);

final selectedAiProviderProvider = Provider<AiProvider>((ref) {
  final id = ref.watch(selectedAiProviderIdProvider);
  final providers = ref.watch(aiProvidersProvider);
  return providers.firstWhere(
    (p) => p.id == id,
    orElse: () => providers.first,
  );
});
