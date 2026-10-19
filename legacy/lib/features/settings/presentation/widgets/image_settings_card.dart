import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/images/image_preferences.dart';
import 'package:gratovo_toolbox/core/images/image_store.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Whether pictures are kept on this machine after they load, and how much
/// space that has taken.
///
/// The one thing this has to communicate correctly is that the checkbox does
/// NOT control whether pictures are shown. Every picture is shown either way.
/// What it decides is what happens on a miss: keep the bytes, or fetch them for
/// display and keep nothing. And in both cases a copy already on disk is used
/// before the network — which is why turning it off does not make a
/// machine that has been caching for a month suddenly slow again.
///
/// On by default: the same avatars and thumbnails are looked at repeatedly
/// across a vetting session, so fetching each one once is the cheaper default.
/// Turning it off is the choice to make on a shared or borrowed machine, where
/// the app should leave no growing folder of creators' photographs behind.
class ImageSettingsSection extends ConsumerStatefulWidget {
  const ImageSettingsSection({super.key});

  @override
  ConsumerState<ImageSettingsSection> createState() =>
      _ImageSettingsSectionState();
}

class _ImageSettingsSectionState extends ConsumerState<ImageSettingsSection> {
  int? _cacheBytes;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _measure();
  }

  Future<void> _measure() async {
    if (!ImageStore.isAvailable) return;
    final bytes = await ImageStore.size();
    if (mounted) setState(() => _cacheBytes = bytes);
  }

  Future<void> _clear() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    try {
      final freed = await ImageStore.clear();
      // The in-memory resolver holds providers pointing at files that no longer
      // exist. Without this, the next build would serve from bytes it had
      // already read and the deletion would look like it had not happened.
      RemoteImageResolver.forgetAll();
      await _measure();
      if (!mounted) return;
      AppToast.success(
        context,
        l10n.settingsImageCacheCleared(
          formatBytes(freed, locale: l10n.localeName),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final autoDownload = ref.watch(autoDownloadImagesProvider);
    final bytes = _cacheBytes;
    final errorColor = theme.colorScheme.error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: 8,
      children: [
        if (!ImageStore.isAvailable) ...[
          Row(mainAxisSize: MainAxisSize.min, spacing: 8, children: [
            const Icon(Icons.image_outlined),
            Text(
              l10n.settingsImagesTitle,
              style: theme.textTheme.labelLarge,
            )
          ]),
          // On web there is no filesystem to save into. Saying so beats
          // showing a checkbox that silently does nothing.
          Text(
            l10n.settingsImagesNoStorage,
            style: theme.textTheme.bodySmall,
          ),
        ] else ...[
          Tooltip(
            message:
                '${l10n.settingsAutoDownloadImagesLabel}\n${autoDownload ? l10n.settingsAutoDownloadImagesOn : l10n.settingsAutoDownloadImagesOff}',
            child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                spacing: 8,
                children: [
                  const Icon(Icons.image_outlined, color: AppColors.offwhite),
                  // See the note in startup_settings_card.dart: the row's
                  // minimum is not a promise of room.
                  Flexible(
                    child: Text(
                      l10n.settingsImagesTitle,
                      style: theme.textTheme.labelLarge,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Checkbox(
                    value: autoDownload,
                    // No `materialTapTargetSize: shrinkWrap` — it took this row's
                    // whole hit area down to 32px, under every platform's floor,
                    // to save eight pixels on a Settings card with room to
                    // spare. `compact` alone still trims the standard 48 to 40.
                    visualDensity: VisualDensity.compact,
                    onChanged: (value) => ref
                        .read(autoDownloadImagesProvider.notifier)
                        .set(value ?? autoDownload),
                  ),
                ]),
          ),
          if (bytes != null && bytes > 0)
            Tooltip(
              message: l10n.settingsClearImageCache(
                formatBytes(bytes, locale: l10n.localeName),
              ),
              child: FilledButton.icon(
                onPressed: _busy ? null : _clear,
                style: FilledButton.styleFrom(
                  backgroundColor: errorColor.withAlpha(50),
                  foregroundColor: errorColor,
                  side: BorderSide(color: errorColor),
                ),
                icon: _busy
                    ? SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: errorColor,
                        ),
                      )
                    : const Icon(Icons.delete_outline),
                label: Text(formatBytes(bytes, locale: l10n.localeName)),
              ),
            ),
        ],
      ],
    );
  }
}
