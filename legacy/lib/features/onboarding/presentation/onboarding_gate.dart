import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/onboarding/application/onboarding_preferences.dart';
import 'package:gratovo_toolbox/features/onboarding/presentation/onboarding_wizard_screen.dart';

/// Shows the first-launch wizard instead of [child] until it has run once on
/// this machine, per [needsOnboardingProvider].
///
/// Self-contained by design: wrap whatever the app shows once someone is
/// signed in and authorized with this, and nothing else about that content
/// needs to know the wizard exists. See this feature's own report for the
/// one-line change that wires it in — `main.dart`, `app.dart` and
/// `routing/` are owned centrally and this feature does not touch them.
class OnboardingGate extends ConsumerWidget {
  const OnboardingGate({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final needsOnboarding = ref.watch(needsOnboardingProvider);
    return needsOnboarding ? const OnboardingWizardScreen() : child;
  }
}
