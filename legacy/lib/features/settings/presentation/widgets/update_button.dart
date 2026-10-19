import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/update/update_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/install_confirm_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Update control that sits beside the version in Settings -> General.
///
/// Invisible while there's nothing to say, which is almost always. It appears
/// when a release has been found, shows the download happening, and then
/// becomes the button that applies it — the deliberate press that every minor
/// and major release waits for, and that a patch falls back to when it
/// couldn't be installed quietly.
///
/// This widget is also what keeps `updateProvider` alive while Settings is
/// open: the controller's poll timer lives in its `build()`, so it stays built
/// only while something watches it. Settings isn't open often enough for that
/// on its own, which is why `AppShell` watches it too via
/// `settingsAttentionProvider`.
class UpdateButton extends ConsumerStatefulWidget {
  const UpdateButton({super.key});

  @override
  ConsumerState<UpdateButton> createState() => _UpdateButtonState();
}

class _UpdateButtonState extends ConsumerState<UpdateButton> {
  /// Guards against a second dialog being pushed if the phase is rebuilt
  /// while one is already on screen.
  bool _confirming = false;

  Future<void> _confirm(UpdateState state) async {
    if (_confirming) return;
    _confirming = true;
    try {
      final insisted = await showDialog<bool>(
        context: context,
        // Not dismissible by tapping outside: backing out is a decision worth
        // making on purpose, same as going ahead.
        barrierDismissible: false,
        builder: (_) => InstallConfirmDialog(
          sideBySideVersion:
              state.isSideBySide ? state.release?.version.toString() : null,
        ),
      );
      if (!mounted) return;
      final notifier = ref.read(updateProvider.notifier);
      if (insisted ?? false) {
        await notifier.installNow(force: true);
      } else {
        notifier.cancelConfirmation();
      }
    } finally {
      _confirming = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(updateProvider);
    final version = state.release?.version.toString();

    // The controller asks for the confirmation by moving into this phase; the
    // dialog belongs to the widget layer, so this is where the two meet.
    // Deferred to after the frame because it runs during build.
    if (state.phase == UpdatePhase.awaitingConfirmation && !_confirming) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            ref.read(updateProvider).phase ==
                UpdatePhase.awaitingConfirmation) {
          _confirm(state);
        }
      });
    }

    if (version == null || state.phase == UpdatePhase.upToDate) {
      return const SizedBox.shrink();
    }

    switch (state.phase) {
      case UpdatePhase.downloading:
        return _Status(
          label: l10n.settingsUpdateDownloading(version),
          // Indeterminate until the first chunk lands, so a server that sends
          // no content length shows a moving bar rather than a stuck 0%.
          progress: state.progress > 0 ? state.progress : null,
        );

      case UpdatePhase.installing:
        return _Status(label: l10n.settingsUpdateInstalling);

      case UpdatePhase.readyToInstall:
      case UpdatePhase.awaitingConfirmation:
        return Tooltip(
          message: l10n.settingsUpdateAvailable(version),
          child: FilledButton.icon(
            onPressed: () => ref.read(updateProvider.notifier).installNow(),
            icon: const Icon(Icons.system_update_alt, size: 16),
            label: Text(l10n.settingsUpdateInstall),
            style: FilledButton.styleFrom(
              visualDensity: VisualDensity.compact,
              textStyle: theme.textTheme.bodySmall,
            ),
          ),
        );

      case UpdatePhase.unknown:
      case UpdatePhase.upToDate:
        return const SizedBox.shrink();
    }
  }
}

/// A non-interactive spinner + caption, for the two phases where pressing
/// anything would only interrupt something already underway.
class _Status extends StatelessWidget {
  const _Status({required this.label, this.progress});

  final String label;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 14,
          width: 14,
          child: CircularProgressIndicator(strokeWidth: 2, value: progress),
        ),
        const SizedBox(width: 8),
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
  }
}
