import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/features/auth/application/auth_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/server_address_fields.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Sign-in screen. One per person — this replaced the old Team Sync card's
/// single shared superuser credential, which every device typed in and which
/// made everyone an administrator. With three access levels enforced in the
/// database, a shared admin login would have made those levels decorative.
///
/// Sessions persist: Supabase stores the refresh token on the device and
/// renews it in the background, so this screen is seen once per machine.
/// Sign out lives in Settings → Account.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  bool _obscure = true;
  bool _busy = false;
  bool _showAdvanced = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signIn(
            email: _email.text,
            password: _password.text,
          );
      // The router's redirect takes over from here — no manual navigation,
      // so there is exactly one place that decides where a signed-in user
      // lands (see routing/app_router.dart).
    } on AuthFailure catch (failure) {
      if (!mounted) return;
      setState(() => _error = _message(failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _message(AuthFailure failure) {
    final l10n = AppLocalizations.of(context);
    return switch (failure.problem) {
      SignInProblem.invalidCredentials => l10n.authErrorInvalidCredentials,
      SignInProblem.emailNotConfirmed => l10n.authErrorEmailNotConfirmed,
      SignInProblem.offline => l10n.authErrorOffline,
      SignInProblem.notConfigured => l10n.authErrorNotConfigured,
      SignInProblem.unknown => l10n.authErrorUnknown(failure.detail ?? ''),
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final boot = ref.watch(supabaseBootProvider);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  GradientText(
                    l10n.appTitle,
                    important: true,
                    style: theme.textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.authSignInSubtitle,
                    style: theme.textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),

                  // The backend never came up — no point letting someone type
                  // credentials that cannot be checked against anything.
                  if (!boot.isReady)
                    Card(
                      color: theme.colorScheme.errorContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          l10n.authServerUnreachable('${boot.error ?? ''}'),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onErrorContainer,
                          ),
                        ),
                      ),
                    ),

                  TextFormField(
                    controller: _email,
                    autofocus: true,
                    enabled: boot.isReady && !_busy,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    textInputAction: TextInputAction.next,
                    decoration: InputDecoration(
                      labelText: l10n.authEmailLabel,
                      prefixIcon: const Icon(Icons.alternate_email),
                      border: const OutlineInputBorder(),
                    ),
                    validator: (value) => (value ?? '').trim().contains('@')
                        ? null
                        : l10n.authEmailInvalid,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _password,
                    enabled: boot.isReady && !_busy,
                    obscureText: _obscure,
                    autofillHints: const [AutofillHints.password],
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: l10n.authPasswordLabel,
                      prefixIcon: const Icon(Icons.lock_outline),
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: Icon(_obscure
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscure = !_obscure),
                      ),
                    ),
                    validator: (value) => (value ?? '').isEmpty
                        ? l10n.authPasswordRequired
                        : null,
                  ),

                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.error),
                    ),
                  ],

                  const SizedBox(height: 20),
                  SizedBox(
                    height: 48,
                    child: GradientButton(
                      onPressed: boot.isReady && !_busy ? _submit : null,
                      important: true,
                      child: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(l10n.authSignInButton),
                    ),
                  ),

                  const SizedBox(height: 8),
                  Text(
                    l10n.authNoSelfSignupNotice,
                    style: theme.textTheme.bodySmall,
                    textAlign: TextAlign.center,
                  ),

                  const SizedBox(height: 12),
                  // Collapsed by default. This is the safe half of "edit the
                  // env file from the app": the server address and anon key
                  // are public values, so exposing them here costs nothing and
                  // means switching Supabase projects needs no rebuild. The
                  // service key is deliberately absent — it bypasses every
                  // access rule and belongs only in backend/.env.
                  TextButton.icon(
                    onPressed: () =>
                        setState(() => _showAdvanced = !_showAdvanced),
                    icon: Icon(
                        _showAdvanced ? Icons.expand_less : Icons.expand_more),
                    label: Text(l10n.authAdvancedToggle),
                  ),
                  if (_showAdvanced) const ServerAddressFields(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown to someone who signed in successfully but has not been granted a
/// level yet — the default state of every new account.
///
/// A dedicated screen rather than an empty app: every list would be blank and
/// every action would fail, and "the app is broken" is the wrong conclusion
/// for someone to reach when the real answer is "you have not been given
/// access yet."
class AccessPendingScreen extends ConsumerWidget {
  const AccessPendingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final session = ref.watch(currentSessionProvider);

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.hourglass_empty,
                    size: 48, color: theme.colorScheme.primary),
                const SizedBox(height: 16),
                Text(l10n.authAccessPendingTitle,
                    style: theme.textTheme.titleLarge,
                    textAlign: TextAlign.center),
                const SizedBox(height: 8),
                Text(
                  l10n.authAccessPendingBody(session?.user.email ?? ''),
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                OutlinedButton.icon(
                  onPressed: () =>
                      ref.read(authControllerProvider.notifier).signOut(),
                  icon: const Icon(Icons.logout),
                  label: Text(l10n.authSignOutButton),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: () => ref.invalidate(currentProfileProvider),
                  child: Text(l10n.authAccessPendingRecheck),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
