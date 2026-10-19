import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_preferences.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// One row of the onboarding wizard: a title, a done/pending chip, a one-line
/// detail, and — while pending — whatever [body] lets the person fix it
/// without leaving the wizard, plus a fallback link to the same thing's real
/// home in Settings.
///
/// Built on [CollapsibleCard], the same shell `AccountsCard`'s four cards use
/// — starts open while pending (there is something to look at) and folded
/// once done (nothing left to do here).
class OnboardingStepCard extends ConsumerWidget {
  const OnboardingStepCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.done,
    required this.detail,
    this.body,
  });

  final String title;
  final String subtitle;
  final bool done;

  /// What the status reads as right now, in one sentence.
  final String detail;

  /// The real control for fixing this step — an existing Settings widget,
  /// reused rather than rebuilt. Null for the sign-in step, which has no
  /// inline control of its own (see `onboarding_status.dart`'s doc comment on
  /// why that step is read-only).
  final Widget? body;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return CollapsibleCard(
      initiallyExpanded: !done,
      leadingIcon: Icon(
        done ? Icons.check_circle : Icons.radio_button_unchecked,
        color: done ? AppColors.success : AppColors.offwhite,
      ),
      titleWidget: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          GradientText(title, style: theme.textTheme.titleMedium),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: done
                  ? theme.colorScheme.surfaceContainerHighest
                  : theme.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              done
                  ? l10n.onboardingStepStatusDone
                  : l10n.onboardingStepStatusPending,
              style: theme.textTheme.labelSmall?.copyWith(
                color: done
                    ? theme.colorScheme.onSurfaceVariant
                    : theme.colorScheme.onErrorContainer,
              ),
            ),
          ),
        ],
      ),
      subtitle: subtitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(detail, style: theme.textTheme.bodyMedium),
          if (body != null) ...[
            const SizedBox(height: 12),
            body!,
          ],
          if (!done) ...[
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton.icon(
                onPressed: () => _skipToSettings(context, ref),
                icon: const Icon(Icons.settings_outlined, size: 16),
                label: Text(l10n.onboardingSkipToSettingsButton),
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Leaving the wizard for the full Settings page is a decision to stop
  /// seeing it, not just this step — the wizard has no notion of "later, on
  /// this one step only", and pretending otherwise would either leave the
  /// wizard reappearing on top of Settings (the gate wraps the whole shell) or
  /// require tracking per-step dismissal nothing else here needs. So this
  /// finishes onboarding the same way the primary button does, then lands
  /// on Settings instead of wherever the gate would otherwise resolve to.
  Future<void> _skipToSettings(BuildContext context, WidgetRef ref) async {
    await ref.read(onboardingCompletedProvider.notifier).markComplete();
    if (!context.mounted) return;
    context.go(AppRoutes.settings);
  }
}
