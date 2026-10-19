import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/theme/gradient_text.dart';
import 'package:gratovo_toolbox/features/settings/application/settings_attention_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/account_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/ai_providers_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/attention_outline.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/aws_accounts_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/gemini_bridge_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/github_account_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/outreach_mailbox_card.dart';

/// Every account this app knows about, as a list of independently
/// collapsible cards — each built on the shared `CollapsibleCard`
/// (`core/widgets/collapsible_card.dart`), now used by all four: the
/// Supabase account, AI providers, AWS accounts, and the outreach mailbox.
/// Each header carries its own status chip, so a problem (signed out, a
/// disconnected mailbox) reads without expanding anything.
///
/// Not a `Card` itself — its four children already are.
class AccountsCard extends StatelessWidget {
  const AccountsCard({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    const titleColors = LinearGradient(colors: [
      AppColors.info,
      AppColors.offwhite,
    ]);
    return Stack(clipBehavior: Clip.none, children: [
      Card(
          shape: RoundedRectangleBorder(
            side: BorderSide(
              color: AppColors.darkBorder.withAlpha(255),
              width: 2.0,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          color: AppColors.brandNavy.withAlpha(110),
          shadowColor: AppColors.accent.withAlpha(110),
          elevation: 22,
          child: const Padding(
              padding: EdgeInsetsGeometry.all(16),
              child: Column(
                spacing: 12,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    height: 12,
                  ),
                  // Each wrapped so the nav-rail badge can be followed to the
                  // one card it is actually about. Nothing is drawn unless
                  // that card is the reason.
                  AttentionOutline(
                    target: SettingsAttentionTarget.account,
                    child: AccountCard(titleColors: titleColors),
                  ),
                  AttentionOutline(
                    target: SettingsAttentionTarget.aiProviders,
                    child: AiProvidersCard(titleColors: titleColors),
                  ),
                  // Beside the hosted providers: it is the no-key provider,
                  // and the card is where its bridge is started and healed.
                  GeminiBridgeCard(titleColors: titleColors),
                  AttentionOutline(
                    target: SettingsAttentionTarget.awsGateway,
                    child: AwsAccountsCard(titleColors: titleColors),
                  ),
                  AttentionOutline(
                    target: SettingsAttentionTarget.mailbox,
                    child: OutreachMailboxCard(titleColors: titleColors),
                  ),
                  AttentionOutline(
                    target: SettingsAttentionTarget.github,
                    child: GithubAccountCard(titleColors: titleColors),
                  ),
                  // DesktopOnly(
                  //   requires: (caps) => caps.canTuneScrapingSettings,
                  //   fallback: Card(
                  //     child: Padding(
                  //       padding: const EdgeInsets.all(16),
                  //       child: Row(
                  //         children: [
                  //           const Icon(Icons.desktop_windows_outlined),
                  //           const SizedBox(width: 12),
                  //           Expanded(
                  //               child: Text(l10n.settingsMailboxDesktopOnly)),
                  //         ],
                  //       ),
                  //     ),
                  //   ),
                  //   // child:
                  // ),
                ],
              ))),
      Positioned(
          left: 16 + 6,
          top: 0,
          child: FractionalTranslation(
              translation: const Offset(0, -0.4),
              child: Card(
                shape: RoundedRectangleBorder(
                  side: BorderSide(
                    color: AppColors.darkBorder.withAlpha(255),
                    width: 2.0,
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                shadowColor: AppColors.accent.withAlpha(190),
                elevation: 40,
                child: Padding(
                    padding: const EdgeInsetsGeometry.fromLTRB(16, 6, 32, 12),
                    child: Row(spacing: 16, children: [
                      const Icon(color: AppColors.info, Icons.manage_accounts),
                      GradientText(
                        'Accounts',
                        style: theme.textTheme.titleMedium,
                        textAlign: TextAlign.center,
                      )
                    ])),
              ))),
    ]);
  }
}
