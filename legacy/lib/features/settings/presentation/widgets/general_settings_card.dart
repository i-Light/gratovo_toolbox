import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/theme/font_scale_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/theme/theme_provider.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/update/package_info_provider.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/always_on_top_settings_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/image_settings_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/startup_settings_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/time_zone_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/update_button.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Language and theme — the two toggles every build (desktop or mobile)
/// gets, wired straight to the providers that have existed since Phase 1
/// (`localeProvider`, `themeModeProvider`); this card is just the first UI
/// that actually lets someone change them.
class GeneralSettingsCard extends ConsumerWidget {
  const GeneralSettingsCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final locale = ref.watch(localeProvider);
    final themeMode = ref.watch(themeModeProvider);
    final fontScale = ref.watch(fontScaleProvider);
    final infoAsync = ref.watch(packageInfoProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          // spacing: 20,
          children: [
            Row(spacing: 8, children: [
              const Icon(
                Icons.home,
                color: AppColors.info,
              ),
              // The heading gives ground to the update button and the version
              // beside it rather than pushing them off a narrow card.
              Flexible(
                child: GradientText(
                  l10n.settingsGeneralTitle,
                  style: Theme.of(context).textTheme.titleMedium,
                  textAlign: TextAlign.start,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Spacer(),
              // Sits immediately before the version it is about, so "Update"
              // and "what you are running" read as one statement.
              const UpdateButton(),
              infoAsync.when(
                loading: () => const SizedBox(
                  height: 16,
                  width: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                error: (error, _) => const SizedBox.shrink(),
                data: (info) {
                  final label =
                      l10n.settingsAboutVersion(info.version, info.buildNumber);
                  return TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: label));
                      if (!context.mounted) return;
                      AppToast.success(
                          context, l10n.settingsAboutVersionCopied);
                    },
                    icon: const Icon(Icons.copy_outlined, size: 14),
                    label: Text(label,
                        style: Theme.of(context).textTheme.bodySmall),
                    style: TextButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                  );
                },
              ),
            ]),
            const SizedBox(
              height: 5,
            ),
            const Divider(),
            const SizedBox(
              height: 20,
            ),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              // crossAxisAlignment: WrapCrossAlignment,
              // spacing: 60,
              runSpacing: 24,
              children: [
                Column(
                  // mainAxisAlignment: MainAxisAlignment.stretch,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 16,
                  children: [
                    Row(
                        mainAxisSize: MainAxisSize.min,
                        // mainAxisAlignment: MainAxisAlignment.start,
                        // crossAxisAlignment: CrossAxisAlignment.start,
                        spacing: 8,
                        children: [
                          const Icon(Icons.translate_rounded,
                              color: AppColors.offwhite),
                          Flexible(
                            child: Text(
                              l10n.settingsLanguageLabel,
                              style: Theme.of(context).textTheme.labelLarge,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          )
                        ]),
                    SegmentedButton<Locale>(
                      segments: const [
                        // Labels should be constant for each language to be shown in their
                        // own normal understandable language.
                        ButtonSegment(
                          value: Locale('en'),
                          label: Text(
                              'English'), //Text(l10n.settingsLanguageEnglish),
                        ),
                        ButtonSegment(
                          value: Locale('ar'),
                          label: Text(
                              'اللغة العربية'), //Text(l10n.settingsLanguageArabic),
                        ),
                      ],
                      selected: {Locale(locale.languageCode)},
                      onSelectionChanged: (selected) {
                        ref
                            .read(localeProvider.notifier)
                            .setLocale(selected.first);
                      },
                    ),
                  ],
                ),
                Column(
                  // mainAxisAlignment: MainAxisAlignment.start,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: 16,
                  children: [
                    Row(
                        mainAxisSize: MainAxisSize.min,
                        // mainAxisAlignment: MainAxisAlignment.start,
                        // crossAxisAlignment: CrossAxisAlignment.start,
                        spacing: 8,
                        children: [
                          const Icon(Icons.color_lens_rounded,
                              color: AppColors.offwhite),
                          Flexible(
                            child: Text(
                              l10n.settingsThemeLabel,
                              style: Theme.of(context).textTheme.labelLarge,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          )
                        ]),
                    SegmentedButton<ThemeMode>(
                      segments: [
                        ButtonSegment(
                          value: ThemeMode.system,
                          label: Text(l10n.settingsThemeSystem),
                          icon: const Icon(Icons.brightness_auto_outlined),
                        ),
                        ButtonSegment(
                          value: ThemeMode.light,
                          label: Text(l10n.settingsThemeLight),
                          icon: const Icon(Icons.light_mode_outlined),
                        ),
                        ButtonSegment(
                          value: ThemeMode.dark,
                          label: Text(l10n.settingsThemeDark),
                          icon: const Icon(Icons.dark_mode_outlined),
                        ),
                      ],
                      selected: {themeMode},
                      onSelectionChanged: (selected) {
                        ref
                            .read(themeModeProvider.notifier)
                            .setThemeMode(selected.first);
                      },
                    ),
                  ],
                ),
                const TimeZoneSection(),
                const ImageSettingsSection(),
                const StartupSettingsSection(),
                const AlwaysOnTopSettingsSection(),
              ],
            ),

            const SizedBox(
              height: 30,
            ),
            // Font scalar. A slider rather than preset sizes because the right
            // value depends on the monitor the person is sitting at, and this
            // team's machines vary widely; divisions give it detents so it
            // still lands on round numbers.
            Column(
              spacing: 0,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Row(
                          mainAxisSize: MainAxisSize.min,
                          // mainAxisAlignment: MainAxisAlignment.start,
                          // crossAxisAlignment: CrossAxisAlignment.start,
                          spacing: 8,
                          children: [
                            const Icon(Icons.text_fields,
                                color: AppColors.offwhite),
                            // This label is the one guaranteed to be read at
                            // the top of the slider's range — it is the
                            // slider's own label — so it is also the one that
                            // must survive it.
                            Flexible(
                              child: Text(
                                l10n.settingsFontScaleLabelWithPercent(
                                  formatCount((fontScale * 100).round()),
                                ),
                                style: Theme.of(context).textTheme.labelLarge,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            )
                          ]),
                    ),
                    if (fontScale != kDefaultFontScale)
                      TextButton(
                        onPressed: () =>
                            ref.read(fontScaleProvider.notifier).reset(),
                        child: Text(l10n.settingsFontScaleReset),
                      ),
                  ],
                ),
                Slider(
                  value: fontScale,
                  min: kMinFontScale,
                  max: kMaxFontScale,
                  divisions: ((kMaxFontScale - kMinFontScale) * 20).round(),
                  label: '${(fontScale * 100).round()}%',
                  onChanged: (value) =>
                      ref.read(fontScaleProvider.notifier).setScale(value),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
