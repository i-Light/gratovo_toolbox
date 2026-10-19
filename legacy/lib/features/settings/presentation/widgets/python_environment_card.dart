import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// How *this* machine launches the Python pipeline — see
/// `python_environment_controller.dart`'s doc comment for why this is
/// per-device rather than shared like `SearchTuningCard`'s tunables.
/// Shown alongside `SearchTuningCard` (same `DesktopOnly` wrapper in
/// settings_screen.dart) since neither means anything on a machine that
/// isn't running the scraper.
class PythonEnvironmentCard extends ConsumerStatefulWidget {
  const PythonEnvironmentCard({super.key});

  @override
  ConsumerState<PythonEnvironmentCard> createState() =>
      _PythonEnvironmentCardState();
}

class _PythonEnvironmentCardState extends ConsumerState<PythonEnvironmentCard> {
  PythonEnvironmentSettings? _local;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final settings = ref.watch(pythonEnvironmentProvider);
    _local ??= settings;
    final local = _local!;

    return CollapsibleCard(
      title: l10n.settingsPythonEnvironmentTitle,
      subtitle: l10n.settingsPythonEnvironmentSubtitle,
      initiallyExpanded: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextFormField(
            initialValue: local.pythonExecutable,
            decoration: InputDecoration(
              labelText: l10n.settingsPythonExecutableLabel,
              hintText: 'python',
            ),
            onChanged: (v) =>
                setState(() => _local = local.copyWith(pythonExecutable: v)),
          ),
          const SizedBox(height: 12),
          TextFormField(
            initialValue: local.projectRootOverride,
            decoration: InputDecoration(
              labelText: l10n.settingsProjectRootOverrideLabel,
              hintText: l10n.settingsProjectRootOverrideHint,
            ),
            onChanged: (v) => setState(
              () => _local = local.copyWith(projectRootOverride: v),
            ),
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: () async {
                await ref
                    .read(pythonEnvironmentProvider.notifier)
                    .update(local);
                if (!context.mounted) return;
                AppToast.success(
                  context,
                  l10n.settingsPythonEnvironmentSaved,
                );
              },
              child: Text(l10n.commonSave),
            ),
          ),
        ],
      ),
    );
  }
}
