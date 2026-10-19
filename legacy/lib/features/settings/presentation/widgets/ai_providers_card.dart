import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/ai_provider_config.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/section_status_chip.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Register/edit/remove hosted AI providers (today: Anthropic's Messages
/// API — `core/ai/anthropic_api_provider.dart`) that the Outreach compose
/// panel can pick from alongside the always-available, no-key-needed
/// `TemplateFillAiProvider` fallback (never listed here since it isn't
/// configurable). Every config is per-device, encrypted at rest — see
/// `data/repositories/secure/secure_ai_provider_config_repository.dart`.
class AiProvidersCard extends ConsumerWidget {
  const AiProvidersCard({super.key, required this.titleColors});

  final Gradient titleColors;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final configsAsync = ref.watch(aiProviderConfigsProvider);

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.auto_awesome,
        size: 32,
        color: AppColors.offwhite,
      ),
      titleWidget: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          GradientText(
            gradient: titleColors,
            l10n.settingsAiProvidersTitle,
            style: Theme.of(context).textTheme.titleSmall,
          ),
          if (configsAsync.hasError)
            SectionStatusChip.attention(label: l10n.commonError),
        ],
      ),
      subtitle: l10n.settingsAiProvidersSubtitle,
      initiallyExpanded: false,
      child: configsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (configs) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (configs.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(l10n.settingsAiProvidersEmpty),
                ),
              for (final config in configs)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.smart_toy_outlined),
                  title: Text(config.displayName),
                  subtitle: Text(
                    l10n.settingsAiProviderSubtitle(
                      config.model,
                      _maskKey(config.apiKey),
                    ),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: const Icon(Icons.edit_outlined),
                        onPressed: () => _openEditor(
                          context,
                          ref,
                          l10n,
                          config: config,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          await ref
                              .read(aiProviderConfigRepositoryProvider)
                              .delete(config.id);
                          ref.invalidate(aiProviderConfigsProvider);
                        },
                      ),
                    ],
                  ),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _openEditor(context, ref, l10n),
                  icon: const Icon(Icons.add),
                  label: Text(l10n.settingsAddAiProvider),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _maskKey(String key) {
    if (key.length <= 4) return '••••';
    return '••••${key.substring(key.length - 4)}';
  }

  Future<void> _openEditor(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n, {
    AiProviderConfig? config,
  }) async {
    final nameController = TextEditingController(
      text: config?.displayName ?? '',
    );
    final keyController = TextEditingController(text: config?.apiKey ?? '');
    final modelController = TextEditingController(
      text: config?.model ?? 'claude-sonnet-4-5',
    );
    var obscureKey = true;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: Text(
                config == null
                    ? l10n.settingsNewAiProviderTitle
                    : l10n.settingsEditAiProviderTitle,
              ),
              content: SizedBox(
                width: 420,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: nameController,
                        decoration: InputDecoration(
                          labelText: l10n.settingsAiProviderNameLabel,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: keyController,
                        obscureText: obscureKey,
                        decoration: InputDecoration(
                          labelText: l10n.settingsAiProviderKeyLabel,
                          suffixIcon: IconButton(
                            icon: Icon(
                              obscureKey
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () => setDialogState(
                              () => obscureKey = !obscureKey,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: modelController,
                        decoration: InputDecoration(
                          labelText: l10n.settingsAiProviderModelLabel,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.settingsAiProviderKeyHint,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(l10n.commonCancel),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: Text(l10n.commonSave),
                ),
              ],
            );
          },
        );
      },
    );

    // Read the fields out and release the controllers before any early
    // return: they are created fresh on every open of this dialog, so a
    // path that skipped disposal would leak one set per open.
    final name = nameController.text.trim();
    final key = keyController.text.trim();
    final model = modelController.text.trim();
    nameController.dispose();
    keyController.dispose();
    modelController.dispose();

    if (saved != true) return;
    if (name.isEmpty || key.isEmpty) return;

    final id = config?.id ?? 'aiprov_${DateTime.now().microsecondsSinceEpoch}';
    await ref.read(aiProviderConfigRepositoryProvider).upsert(
          AiProviderConfig(
            id: id,
            displayName: name,
            apiKey: key,
            model: model,
          ),
        );
    ref.invalidate(aiProviderConfigsProvider);
  }
}
