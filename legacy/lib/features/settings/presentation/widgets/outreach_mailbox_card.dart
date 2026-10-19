import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/mailbox_limits_store.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/section_status_chip.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Which mailbox this machine sends outreach from, and what it currently owes.
///
/// Sits beside [PythonEnvironmentCard] under the same `DesktopOnly` gate in
/// settings_screen.dart, and for the same reason: the mailbox is a per-machine
/// arrangement, not a team setting. Whoever runs the pipeline sends the mail,
/// their refresh token lives in their own `data/.env.local`, and the Gmail
/// thread ids that make follow-ups work are meaningless in anybody else's
/// account.
class OutreachMailboxCard extends ConsumerStatefulWidget {
  const OutreachMailboxCard({super.key, required this.titleColors});

  final Gradient titleColors;

  @override
  ConsumerState<OutreachMailboxCard> createState() =>
      _OutreachMailboxCardState();
}

class _OutreachMailboxCardState extends ConsumerState<OutreachMailboxCard> {
  bool _testing = false;
  bool _connecting = false;
  final Set<String> _signingOut = {};

  /// Runs the mailbox tool's browser sign-in to connect ONE MORE mailbox.
  /// It blocks on a person in a browser tab, so this can sit unresolved for a
  /// minute — [_connecting] drives the "waiting" affordance while it does.
  /// Reconnecting an address that is already on this machine just refreshes
  /// its token in place rather than adding a duplicate.
  Future<void> _connect() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _connecting = true);
    try {
      final outcome = await ref.read(gmailGatewayProvider).connect();
      if (!mounted) return;
      if (outcome.succeeded) {
        ref.invalidate(gmailStatusProvider);
        final account = outcome.value ?? '';
        AppToast.success(
          context,
          account.isEmpty
              ? l10n.settingsMailboxConnected
              : l10n.settingsMailboxConnectedAs(account),
        );
      } else {
        AppToast.error(context, outcome.error?.message ?? l10n.commonError);
      }
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  Future<void> _signOut(GmailAccountStatus entry) async {
    final l10n = AppLocalizations.of(context);
    final account = entry.account ?? '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(account.isEmpty
            ? l10n.settingsMailboxSignOutTitle
            : l10n.settingsMailboxSignOutTitleFor(account)),
        content: Text(account.isEmpty
            ? l10n.settingsMailboxSignOutBody
            : l10n.settingsMailboxSignOutBodyFor(account)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(MaterialLocalizations.of(context).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.settingsMailboxSignOut),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _signingOut.add(account));
    try {
      final outcome = await ref
          .read(gmailGatewayProvider)
          .disconnect(account: account.isEmpty ? null : account);
      if (!mounted) return;
      if (outcome.succeeded) {
        ref.invalidate(gmailStatusProvider);
        AppToast.success(
          context,
          account.isEmpty
              ? l10n.settingsMailboxSignedOut
              : l10n.settingsMailboxSignedOutOf(account),
        );
      } else {
        AppToast.error(context, outcome.error?.message ?? l10n.commonError);
      }
    } finally {
      if (mounted) setState(() => _signingOut.remove(account));
    }
  }

  /// Sends a test message from whichever mailbox is unambiguous — the only
  /// one connected, today's single-account behaviour unchanged. On a machine
  /// with several, the tool reports [GmailFailure.ambiguousAccount] and this
  /// surfaces it the same way any other failure shows up; picking which of
  /// several mailboxes to test from is a follow-up, not something silently
  /// guessed at.
  Future<void> _sendTest() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _testing = true);
    try {
      final outcome = await ref.read(gmailGatewayProvider).sendTest();
      if (!mounted) return;
      if (outcome.succeeded) {
        AppToast.success(context, l10n.settingsMailboxTestSent(outcome.value!));
      } else {
        AppToast.error(
          context,
          l10n.outreachGmailSendFailed(
              outcome.error?.message ?? l10n.commonError),
        );
      }
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  /// Opens one mailbox's daily cap and warm-up (HC-02, HC-03) and saves what
  /// the person settles on to this machine's settings.local.json.
  Future<void> _editLimits(GmailAccountStatus entry) async {
    final l10n = AppLocalizations.of(context);
    final account = entry.account ?? '';
    final result = await showDialog<(int, DateTime?)>(
      context: context,
      builder: (context) => _MailboxLimitsDialog(
        account: account,
        limits: entry.limits!,
        today: ref.read(mailboxLimitsClockProvider)(),
      ),
    );
    if (result == null || !mounted) return;
    try {
      await ref.read(mailboxLimitsStoreProvider).save(
            account,
            dailyCap: result.$1,
            warmupStartedOn: result.$2,
          );
      if (!mounted) return;
      ref.invalidate(gmailStatusProvider);
      AppToast.success(context, l10n.settingsMailboxLimitsSaved);
    } on Exception catch (error) {
      if (mounted) AppToast.error(context, '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final statusAsync = ref.watch(gmailStatusProvider);
    final status = statusAsync.value;
    final accounts = status?.accounts ?? const <GmailAccountStatus>[];
    final connected = status?.canSend ?? false;
    final needsAttention =
        accounts.isEmpty || accounts.any((entry) => !entry.connected);

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.mark_email_read_outlined,
        size: 32,
        color: AppColors.offwhite,
      ),
      titleWidget: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          GradientText(
            gradient: widget.titleColors,
            l10n.settingsMailboxTitle,
            style: theme.textTheme.titleSmall,
          ),
          if (needsAttention)
            SectionStatusChip.attention(
              label: l10n.settingsMailboxNotConnected,
              tooltip: status?.error?.message,
            ),
        ],
      ),
      subtitle: l10n.settingsMailboxSubtitle,
      initiallyExpanded: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: statusAsync.isLoading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : IconButton(
                    tooltip: l10n.settingsMailboxRefresh,
                    icon: const Icon(Icons.refresh),
                    onPressed: () => ref.invalidate(gmailStatusProvider),
                  ),
          ),
          if (accounts.isNotEmpty) ...[
            _MailboxAccountsRow(
              accounts: accounts,
              signingOut: _signingOut,
              onSignOut: _signOut,
            ),
            const SizedBox(height: 12),
            for (final entry in accounts)
              if (entry.connected && entry.limits != null) ...[
                _MailboxLimitsSummary(
                  entry: entry,
                  showAddress: accounts.length > 1,
                  onEdit: () => _editLimits(entry),
                ),
                const SizedBox(height: 12),
              ],
          ],
          _ConnectionRow(status: status, connected: connected),
          if (status?.error != null) ...[
            const SizedBox(height: 8),
            _ProblemNote(error: status!.error!),
          ],
          if (connected) ...[
            const SizedBox(height: 12),
            _Counters(status: status!),
          ],
          const SizedBox(height: 16),
          if (accounts.isEmpty) ...[
            // Shown whenever nothing is connected yet — including a machine
            // that used to have a mailbox and lost it. Signing in again is
            // the fix either way.
            Text(
              l10n.settingsMailboxConnectHint,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.icon(
                onPressed: _connecting ? null : _connect,
                icon: _connecting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.login),
                label: Text(_connecting
                    ? l10n.settingsMailboxConnecting
                    : l10n.settingsMailboxSignIn),
              ),
            ),
          ] else
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: _connecting ? null : _connect,
                icon: _connecting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add),
                label: Text(_connecting
                    ? l10n.settingsMailboxConnecting
                    : l10n.settingsMailboxAddAnother),
              ),
            ),
          if (_connecting) ...[
            const SizedBox(height: 6),
            Text(
              l10n.settingsMailboxConnectingHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
          const SizedBox(height: 6),
          Text(
            l10n.settingsMailboxTokenExpiryNote,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (connected) ...[
            const SizedBox(height: 12),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: OutlinedButton.icon(
                onPressed: _testing ? null : _sendTest,
                icon: _testing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.outgoing_mail),
                label: Text(l10n.settingsMailboxTestSend),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The row of signed-in mailboxes. Today's backend connects at most one
/// mailbox per machine, so [accounts] only ever has zero or one entries — but
/// the row is shaped for however many a future multi-account backend reports,
/// so that change only has to swap the data source, not this widget.
class _MailboxAccountsRow extends StatelessWidget {
  const _MailboxAccountsRow({
    required this.accounts,
    required this.signingOut,
    required this.onSignOut,
  });

  final List<GmailAccountStatus> accounts;

  /// Account addresses with a sign-out in flight — disables that chip's own
  /// button without touching the others.
  final Set<String> signingOut;

  final ValueChanged<GmailAccountStatus> onSignOut;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.settingsMailboxAccountsRowTitle,
          style: theme.textTheme.labelLarge,
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final entry in accounts)
              _MailboxAccountChip(
                entry: entry,
                signingOut: signingOut.contains(entry.account ?? ''),
                onSignOut: () => onSignOut(entry),
              ),
          ],
        ),
      ],
    );
  }
}

/// One signed-in mailbox: its address, whether it can currently send, and a
/// button to sign out of just this one.
class _MailboxAccountChip extends StatelessWidget {
  const _MailboxAccountChip({
    required this.entry,
    required this.signingOut,
    required this.onSignOut,
  });

  final GmailAccountStatus entry;
  final bool signingOut;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final connected = entry.connected;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: connected
            ? theme.colorScheme.surfaceContainerHighest
            : theme.colorScheme.errorContainer,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Tooltip(
            message: connected
                ? l10n.settingsMailboxConnectedAs(entry.account ?? '')
                : entry.error?.message ?? l10n.settingsMailboxNotConnected,
            child: Icon(
              connected
                  ? Icons.mark_email_read_outlined
                  : Icons.warning_amber_outlined,
              size: 14,
              color: connected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onErrorContainer,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            entry.account ?? '',
            style: theme.textTheme.bodySmall?.copyWith(
              color: connected ? null : theme.colorScheme.onErrorContainer,
            ),
          ),
          const SizedBox(width: 2),
          SizedBox(
            width: 22,
            height: 22,
            child: signingOut
                ? const Padding(
                    padding: EdgeInsets.all(4),
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : IconButton(
                    padding: EdgeInsets.zero,
                    iconSize: 14,
                    color: connected
                        ? theme.colorScheme.error
                        : theme.colorScheme.onErrorContainer,
                    tooltip: l10n.settingsMailboxSignOut,
                    icon: const Icon(Icons.close),
                    onPressed: onSignOut,
                  ),
          ),
        ],
      ),
    );
  }
}

/// One mailbox's daily cap of cold email and its warm-up, in words with an
/// icon each (never colour alone), and the button that changes them.
class _MailboxLimitsSummary extends ConsumerWidget {
  const _MailboxLimitsSummary({
    required this.entry,
    required this.showAddress,
    required this.onEdit,
  });

  final GmailAccountStatus entry;

  /// Only worth printing when there is more than one mailbox to tell apart.
  final bool showAddress;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final limits = entry.limits!;
    final now = ref.watch(mailboxLimitsClockProvider)();
    final days = limits.warmupDays(now);
    final muted = theme.colorScheme.onSurfaceVariant;

    final (IconData warmIcon, Color warmColor, String warmText) = days == null
        ? (Icons.event_busy_outlined, muted, l10n.settingsMailboxWarmupNotSet)
        : limits.warmedEnough(now)
            ? (
                Icons.verified_outlined,
                theme.colorScheme.primary,
                l10n.settingsMailboxWarmupDone(days),
              )
            : (
                Icons.local_fire_department_outlined,
                theme.colorScheme.error,
                l10n.settingsMailboxWarmupWarming(days),
              );

    Widget line(IconData icon, Color color, String text) => Row(
          children: [
            ExcludeSemantics(child: Icon(icon, size: 16, color: color)),
            const SizedBox(width: 8),
            Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
          ],
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showAddress)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text(entry.account ?? '', style: theme.textTheme.labelLarge),
          ),
        line(
          Icons.outgoing_mail,
          muted,
          l10n.settingsMailboxCapLine(limits.dailyCap, limits.leftToday),
        ),
        const SizedBox(height: 4),
        line(warmIcon, warmColor, warmText),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            onPressed: onEdit,
            icon: const Icon(Icons.tune),
            label: Text(l10n.settingsMailboxEditLimits),
          ),
        ),
      ],
    );
  }
}

/// The cap slider (10-50, the range HC-02 allows) and the warm-up start date.
/// Pops with the pair to save, or null on cancel.
class _MailboxLimitsDialog extends StatefulWidget {
  const _MailboxLimitsDialog({
    required this.account,
    required this.limits,
    required this.today,
  });

  final String account;
  final GmailLimits limits;
  final DateTime today;

  @override
  State<_MailboxLimitsDialog> createState() => _MailboxLimitsDialogState();
}

class _MailboxLimitsDialogState extends State<_MailboxLimitsDialog> {
  late int _cap =
      widget.limits.dailyCap.clamp(GmailLimits.minCap, GmailLimits.maxCap);
  late DateTime? _warmup = widget.limits.warmupStartedOn;

  Future<void> _pickDate() async {
    final today = widget.today;
    final picked = await showDatePicker(
      context: context,
      initialDate: _warmup ?? today,
      firstDate: DateTime(today.year - 3),
      lastDate: today,
    );
    if (picked != null && mounted) setState(() => _warmup = picked);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final help = theme.textTheme.bodySmall
        ?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final warmup = _warmup;

    return AlertDialog(
      title: Text(l10n.settingsMailboxLimitsTitle(widget.account)),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.settingsMailboxCapLabel(_cap),
                style: theme.textTheme.labelLarge),
            Slider(
              min: GmailLimits.minCap.toDouble(),
              max: GmailLimits.maxCap.toDouble(),
              divisions: GmailLimits.maxCap - GmailLimits.minCap,
              value: _cap.toDouble(),
              label: '$_cap',
              onChanged: (value) => setState(() => _cap = value.round()),
            ),
            Text(l10n.settingsMailboxCapHelp, style: help),
            const SizedBox(height: 20),
            Text(l10n.settingsMailboxWarmupLabel,
                style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.event),
                  label: Text(warmup == null
                      ? l10n.settingsMailboxWarmupPick
                      : MaterialLocalizations.of(context)
                          .formatMediumDate(warmup)),
                ),
                if (warmup != null)
                  TextButton(
                    onPressed: () => setState(() => _warmup = null),
                    child: Text(l10n.settingsMailboxWarmupClear),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(l10n.settingsMailboxWarmupHelp, style: help),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop((_cap, _warmup)),
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}

class _ConnectionRow extends StatelessWidget {
  const _ConnectionRow({required this.status, required this.connected});

  final GmailStatus? status;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final account = status?.account;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          connected ? Icons.mark_email_read_outlined : Icons.no_accounts,
          color: connected
              ? theme.colorScheme.primary
              : theme.colorScheme.onSurfaceVariant,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                connected && account != null
                    ? l10n.settingsMailboxConnectedAs(account)
                    : l10n.settingsMailboxNotConnected,
                style: theme.textTheme.bodyLarge,
              ),
              if (connected && (status?.label?.isNotEmpty ?? false))
                Text(
                  l10n.settingsMailboxLabelledAs(status!.label!),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Why the mailbox is not usable, when there is a reason worth reading.
///
/// `not_configured` is deliberately absent: a machine nobody has set up yet is
/// the ordinary state, the row above already says so, and repeating it as a
/// warning would make an unremarkable situation look broken.
class _ProblemNote extends StatelessWidget {
  const _ProblemNote({required this.error});

  final GmailError error;

  @override
  Widget build(BuildContext context) {
    if (error.failure == GmailFailure.notConfigured) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_outlined,
              size: 18, color: theme.colorScheme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(error.message, style: theme.textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

class _Counters extends StatelessWidget {
  const _Counters({required this.status});

  final GmailStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final counters = status.counters;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _Chip(
              icon: Icons.north_east,
              label: l10n.settingsMailboxCountersSent(counters.sent),
            ),
            _Chip(
              icon: Icons.hourglass_bottom,
              label:
                  l10n.settingsMailboxCountersAwaiting(counters.awaitingReply),
            ),
            _Chip(
              icon: Icons.schedule_send_outlined,
              label: l10n.settingsMailboxCountersQueued(counters.pendingSteps),
            ),
          ],
        ),
        // Surfaced only when non-zero, and surfaced at all because a follow-up
        // that quietly gave up is otherwise invisible: nothing was sent, no
        // error was shown, and the conversation simply stops.
        if (counters.failedSteps > 0) ...[
          const SizedBox(height: 8),
          Text(
            l10n.settingsMailboxFailedSteps(counters.failedSteps),
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.error),
          ),
        ],
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 6),
          Text(label, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}
