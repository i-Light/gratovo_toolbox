import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/theme/gratovo_logo.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_preferences.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_status.dart';
import 'package:gratovo_toolbox/features/onboarding/presentation/widgets/onboarding_step_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/aws_accounts_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/outreach_mailbox_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/python_environment_card.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/time_zone_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The first-launch wizard: four steps, each read from a provider that
/// already exists elsewhere in the app (`onboarding_status.dart`), each fixed
/// with a widget that already exists elsewhere in the app. Nothing here
/// re-detects or re-implements what those steps are about — see each step's
/// comment in `onboarding_status.dart` for the reasoning.
///
/// Shown by `OnboardingGate` in place of the app shell's content while
/// [needsOnboardingProvider] is true; dismissed by either button below,
/// which both end at `onboardingCompletedProvider.markComplete()` — nothing
/// here requires every step to be done first, only that the person has seen
/// them once.
class OnboardingWizardScreen extends ConsumerWidget {
  const OnboardingWizardScreen({super.key});

  static const _titleColors = LinearGradient(
    colors: [AppColors.info, AppColors.offwhite],
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 940),
              child: Column(
                spacing: 12,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Directionality(
                      textDirection: TextDirection.ltr,
                      child: Row(spacing: 6, children: [
                        const Icon(Icons.back_hand, color: AppColors.offwhite),
                        // Expanded + Align rather than a bare text followed by
                        // a spacer: the greeting is ~48 characters, so in a
                        // narrow window a bare text cannot shrink and the row
                        // overflowed by the width of the calligraphy glyph
                        // beside it. Align loosens the constraint again, so a
                        // roomy window still sizes the text (and its gradient)
                        // to the words rather than stretching it across the row.
                        Expanded(
                          child: Align(
                            alignment: AlignmentDirectional.centerStart,
                            child: GradientText(
                              l10n.fullSalam,
                              gradient: const LinearGradient(colors: [
                                AppColors.offwhite,
                                AppColors.primary,
                              ]),
                              style: theme.textTheme.bodyLarge,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ),
                        const Text('6',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontFamily: 'Bismillah',
                              height: 0.7,
                              fontSize: 100,
                            )),
                      ])),
                  Directionality(
                      textDirection: TextDirection.ltr,
                      child: Row(
                        spacing: 4,
                        children: [
                          const GratovoLogo(),
                          GradientText('ratovo',
                              important: true,
                              style: theme.textTheme.headlineLarge?.copyWith(
                                  fontWeight: const FontWeight(600))),
                          const Expanded(
                            child: SizedBox(),
                          ),
                          const _LanguageQuickSwitch(),
                        ],
                      )),
                  Text(l10n.onboardingWizardTitle,
                      style: theme.textTheme.headlineSmall),
                  Text(l10n.onboardingWizardSubtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  _SignInStep(l10n: l10n),
                  _PythonEnvironmentStep(l10n: l10n),
                  _MailboxStep(l10n: l10n),
                  _TimeZoneStep(l10n: l10n),
                  _AwsStep(l10n: l10n),
                  const SizedBox(height: 12),
                  Align(
                    alignment: AlignmentDirectional.center,
                    child: GradientButton(
                      important: true,
                      onPressed: () => ref
                          .read(onboardingCompletedProvider.notifier)
                          .markComplete(),
                      child: Text(l10n.onboardingFinishButton),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SignInStep extends ConsumerWidget {
  const _SignInStep({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = ref.watch(onboardingStepDoneProvider(OnboardingStepId.signIn));
    final email = ref.watch(currentSessionProvider)?.user.email;

    return OnboardingStepCard(
      title: l10n.onboardingSignInStepTitle,
      subtitle: l10n.onboardingSignInStepSubtitle,
      done: done,
      detail: done
          ? l10n.onboardingSignInDoneDetail(email ?? '')
          : l10n.onboardingSignInPendingDetail,
    );
  }
}

class _PythonEnvironmentStep extends ConsumerWidget {
  const _PythonEnvironmentStep({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = ref
        .watch(onboardingStepDoneProvider(OnboardingStepId.pythonEnvironment));
    final canRunSearch = ref.watch(capabilitiesProvider).canRunSearch;

    return OnboardingStepCard(
      title: l10n.onboardingPythonStepTitle,
      subtitle: l10n.onboardingPythonStepSubtitle,
      done: done,
      detail: done && canRunSearch
          ? l10n.onboardingPythonDoneDetail
          : l10n.onboardingPythonPendingDetail,
      // Editing the interpreter/project-root only means anything where a
      // pipeline could actually be launched — same gate `PythonEnvironmentCard`
      // is already shown behind in Settings.
      body: canRunSearch ? const PythonEnvironmentCard() : null,
    );
  }
}

class _MailboxStep extends ConsumerWidget {
  const _MailboxStep({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done =
        ref.watch(onboardingStepDoneProvider(OnboardingStepId.mailbox));

    return OnboardingStepCard(
      title: l10n.onboardingMailboxStepTitle,
      subtitle: l10n.onboardingMailboxStepSubtitle,
      done: done,
      detail: done
          ? l10n.onboardingMailboxDoneDetail
          : l10n.onboardingMailboxPendingDetail,
      body: const OutreachMailboxCard(
        titleColors: OnboardingWizardScreen._titleColors,
      ),
    );
  }
}

class _TimeZoneStep extends ConsumerWidget {
  const _TimeZoneStep({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done =
        ref.watch(onboardingStepDoneProvider(OnboardingStepId.timeZone));

    return OnboardingStepCard(
      title: l10n.onboardingTimeZoneStepTitle,
      subtitle: l10n.onboardingTimeZoneStepSubtitle,
      done: done,
      detail: done
          ? l10n.onboardingTimeZoneDoneDetail
          : l10n.onboardingTimeZonePendingDetail,
      body: const TimeZoneSection(),
    );
  }
}

class _AwsStep extends ConsumerWidget {
  const _AwsStep({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final done = ref.watch(onboardingStepDoneProvider(OnboardingStepId.aws));

    return OnboardingStepCard(
      title: l10n.onboardingAwsStepTitle,
      subtitle: l10n.onboardingAwsStepSubtitle,
      done: done,
      detail:
          done ? l10n.onboardingAwsDoneDetail : l10n.onboardingAwsPendingDetail,
      body: const AwsAccountsCard(
        titleColors: OnboardingWizardScreen._titleColors,
      ),
    );
  }
}

/// A compact, two-tap toggle between the app's two supported locales — the
/// same [localeProvider] `GeneralSettingsCard` already writes to, just
/// reachable without leaving the wizard first.
class _LanguageQuickSwitch extends ConsumerWidget {
  const _LanguageQuickSwitch();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final locale = ref.watch(localeProvider);

    return SegmentedButton<Locale>(
      showSelectedIcon: false,
      style: const ButtonStyle(
        visualDensity: VisualDensity.compact,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      segments: const [
        // Each language names itself, so these labels are deliberately not
        // run through l10n — see GeneralSettingsCard's language toggle.
        // Short forms here (rather than "English" / "اللغة العربية") since
        // this switch shares the header row with the logo and wordmark.
        ButtonSegment(value: Locale('en'), label: Text('EN')),
        ButtonSegment(value: Locale('ar'), label: Text('عربي')),
      ],
      selected: {Locale(locale.languageCode)},
      onSelectionChanged: (selected) =>
          ref.read(localeProvider.notifier).setLocale(selected.first),
    );
  }
}
