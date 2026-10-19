import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/github/github_auth.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/features/settings/application/github_account_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

/// Settings -> Accounts -> GitHub: what this machine downloads updates with.
///
/// Normally that is the shared token compiled into the build, and this card
/// exists to say whether it still works. That matters more than it sounds: a
/// private repository answers an unusable token with a 404 rather than an
/// error, so the symptom of an expired token is not a failure anybody sees —
/// it is the app quietly never updating again, on everyone's machine at once.
///
/// Signing in personally is offered as the way out of exactly that, and as
/// the escape hatch for anyone whose own account needs to be used instead.
class GithubAccountCard extends ConsumerWidget {
  const GithubAccountCard({super.key, this.titleColors});

  final Gradient? titleColors;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final account = ref.watch(githubAccountProvider);
    final notifier = ref.read(githubAccountProvider.notifier);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.cloud_download_outlined, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: GradientText(
                    l10n.settingsGithubTitle,
                    gradient: titleColors,
                    style: theme.textTheme.titleSmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (account.busy && !account.isSigningIn)
                  const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              l10n.settingsGithubBody,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            if (account.isSigningIn)
              _DeviceCodePanel(code: account.pendingCode!)
            else if (account.usesSharedToken)
              // No sign-in button front and centre: on the shared-token setup
              // nobody needs to sign in, and a prominent button suggesting
              // otherwise would have most of the team doing something
              // pointless. It stays available underneath.
              Row(
                children: [
                  Icon(
                    Icons.workspaces_outline,
                    size: 18,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      l10n.settingsGithubSharedToken,
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                  TextButton(
                    onPressed: notifier.refresh,
                    child: Text(l10n.settingsGithubRecheck),
                  ),
                  if (GithubAuth().isConfigured)
                    TextButton(
                      onPressed: account.busy ? null : notifier.signIn,
                      child: Text(l10n.settingsGithubSignInOptional),
                    ),
                ],
              )
            else if (account.isSignedIn)
              Row(
                children: [
                  if (account.avatarUrl != null)
                    CircleAvatar(
                      radius: 14,
                      backgroundImage: NetworkImage(account.avatarUrl!),
                    ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      l10n.settingsGithubSignedInAs(account.login!),
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                  TextButton(
                    onPressed: notifier.refresh,
                    child: Text(l10n.settingsGithubRecheck),
                  ),
                  TextButton(
                    onPressed: notifier.signOut,
                    child: Text(l10n.settingsGithubSignOut),
                  ),
                ],
              )
            else ...[
              _Note(
                text: l10n.settingsGithubNoToken,
                color: theme.colorScheme.error,
                icon: Icons.cloud_off_outlined,
              ),
              if (GithubAuth().isConfigured) ...[
                const SizedBox(height: 12),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: FilledButton.icon(
                    onPressed: account.busy ? null : notifier.signIn,
                    icon: const Icon(Icons.login, size: 18),
                    label: Text(l10n.settingsGithubSignIn),
                  ),
                ),
              ],
            ],
            if (account.failure != null) ...[
              const SizedBox(height: 12),
              _Note(
                text: _failureText(l10n, account.failure!),
                color: theme.colorScheme.error,
              ),
            ],
            if (!account.hasNoToken) ...[
              const SizedBox(height: 12),
              _accessNote(context, l10n, account),
            ],
          ],
        ),
      ),
    );
  }

  Widget _accessNote(
    BuildContext context,
    AppLocalizations l10n,
    GithubAccount account,
  ) {
    final scheme = Theme.of(context).colorScheme;
    // A shared token that stopped working is a different sentence from a
    // personal one: it is not this person's sign-in that broke, it is
    // everybody's, and the fix is a new build rather than anything they can
    // do on this screen.
    if (account.usesSharedToken) {
      return switch (account.access) {
        GithubReleaseAccess.granted => _Note(
            text: l10n.settingsGithubSharedTokenOk,
            color: scheme.primary,
            icon: Icons.check_circle_outline,
          ),
        GithubReleaseAccess.denied ||
        GithubReleaseAccess.tokenRejected =>
          _Note(
            text: l10n.settingsGithubSharedRejected,
            color: scheme.error,
            icon: Icons.key_off_outlined,
          ),
        GithubReleaseAccess.unreachable => _Note(
            text: l10n.settingsGithubAccessUnknown,
            color: scheme.onSurfaceVariant,
            icon: Icons.cloud_off_outlined,
          ),
        GithubReleaseAccess.unknown => const SizedBox.shrink(),
      };
    }

    return switch (account.access) {
      GithubReleaseAccess.granted => _Note(
          text: l10n.settingsGithubAccessGranted,
          color: scheme.primary,
          icon: Icons.check_circle_outline,
        ),
      // The one that matters: it names the account, because the fix is to add
      // exactly that login to the repository.
      GithubReleaseAccess.denied => _Note(
          text: l10n.settingsGithubAccessDenied(account.login ?? ''),
          color: scheme.error,
          icon: Icons.person_off_outlined,
        ),
      GithubReleaseAccess.tokenRejected => _Note(
          text: l10n.settingsGithubTokenRejected,
          color: scheme.error,
          icon: Icons.key_off_outlined,
        ),
      GithubReleaseAccess.unreachable => _Note(
          text: l10n.settingsGithubAccessUnknown,
          color: scheme.onSurfaceVariant,
          icon: Icons.cloud_off_outlined,
        ),
      GithubReleaseAccess.unknown => const SizedBox.shrink(),
    };
  }

  static String _failureText(
    AppLocalizations l10n,
    GithubAuthFailure failure,
  ) =>
      switch (failure) {
        GithubAuthFailure.notConfigured => l10n.settingsGithubNotConfigured,
        GithubAuthFailure.denied => l10n.settingsGithubDenied,
        GithubAuthFailure.expired => l10n.settingsGithubExpired,
        GithubAuthFailure.unreachable => l10n.settingsGithubUnreachable,
        GithubAuthFailure.storage => l10n.settingsGithubStorageFailed,
      };
}

/// The device-flow step: a code to type and a link to type it into.
///
/// The code is selectable and copyable rather than only readable — it is
/// eight characters someone has to get into another window, and retyping it
/// by eye is the one part of this flow people get wrong.
class _DeviceCodePanel extends StatelessWidget {
  const _DeviceCodePanel({required this.code});

  final GithubDeviceCode code;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.settingsGithubCodeInstruction(code.verificationUri),
          style: theme.textTheme.bodySmall,
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            SelectableText(
              code.userCode,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontFeatures: const [FontFeature.tabularFigures()],
                letterSpacing: 4,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 12),
            IconButton(
              tooltip: l10n.commonCopy,
              icon: const Icon(Icons.copy_outlined, size: 18),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: code.userCode));
                if (!context.mounted) return;
                AppToast.success(context, l10n.settingsGithubCodeCopied);
              },
            ),
            const Spacer(),
            FilledButton.tonalIcon(
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(l10n.settingsGithubSignIn),
              onPressed: () => launchUrl(
                Uri.parse(code.verificationUri),
                mode: LaunchMode.externalApplication,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        const LinearProgressIndicator(),
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.text, required this.color, this.icon});

  final String text;
  final Color color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon ?? Icons.info_outline, size: 16, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style:
                Theme.of(context).textTheme.bodySmall?.copyWith(color: color),
          ),
        ),
      ],
    );
  }
}
