import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/capabilities/capability_gate.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/theme/gratovo_logo.dart';
import 'package:gratovo_toolbox/features/job_scheduler/presentation/widgets/job_scheduler_status_card.dart';
import 'package:gratovo_toolbox/features/my_apps/presentation/my_apps_card.dart';
import 'package:gratovo_toolbox/features/settings/application/settings_attention_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/accounts_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/agency_facts_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/attention_outline.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/general_settings_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/merge_status_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/python_environment_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/search_tuning_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Language/theme/text size, Pictures, Account, and AI Providers (every build — none of these
/// need the desktop machine that runs the scraper), and Advanced / Search
/// Tuning (desktop-only, via `DesktopOnly` — the pacing/proxy/threshold
/// tunables the scraper reads only mean anything on the machine that
/// actually runs it).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
        appBar: const GradientAppBar(
          // Both text runs give ground rather than running off the bar: at
          // a narrow width the mark, the wordmark and the page name together
          // are wider than the toolbar, and `mainAxisSize.min` asks for a
          // width it is not necessarily given.
          title: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              GratovoLogo(size: 40),
              SizedBox(width: 12),
              Flexible(
                child: GradientText(
                  'Gratovo',
                  important: true,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              SizedBox(width: 12),
              Flexible(
                child: Text(
                  '- Settings',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
        body: GradientBackdrop(
          colors: const [
            AppColors.brandNavy,
            AppColors.primaryDark,
            AppColors.info
          ],
          strength: 0.2,
          from: Alignment.topCenter,
          extent: 1,
          fade: false,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              spacing: 16,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AttentionOutline(
                  target: SettingsAttentionTarget.general,
                  child: GeneralSettingsCard(),
                ),
                const SizedBox(
                  height: 0,
                ),
                const AccountsCard(),
                // The team's shared facts: what the engine may claim, the
                // boycott list, the daily target.
                const AgencyFactsCard(),
                const SearchTuningCard(),
                const MergeStatusCard(),
                // Wave 2: job scheduler status card
                const JobSchedulerStatusCard(),
                // Every build: on a phone it is where the Play/APK links are.
                const MyAppsCard(),
                DesktopOnly(
                  requires: (caps) => caps.canTuneScrapingSettings,
                  fallback: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          const Icon(Icons.desktop_windows_outlined),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(l10n.settingsSearchTuningDesktopOnly),
                          ),
                        ],
                      ),
                    ),
                  ),
                  child: const Column(
                    children: [
                      PythonEnvironmentCard(),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ));
  }
}
