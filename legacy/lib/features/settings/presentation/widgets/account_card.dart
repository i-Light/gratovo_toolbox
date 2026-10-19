import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/features/auth/application/auth_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/server_address_fields.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/sync_status_row.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Who you are signed in as, what you are allowed to see, and how you appear
/// to the rest of the team.
///
/// This replaced the old Team Sync card, which asked every device for the
/// SAME PocketBase superuser email and password. That model could not
/// coexist with per-person access levels: a shared administrator credential
/// on eight machines means eight administrators, and the database rules
/// become decoration. Identity now belongs to the person (login screen,
/// session token in the platform's own store), and the only thing left that
/// is genuinely per-device is the server address — which is public, and lives
/// under Advanced below.
class AccountCard extends ConsumerWidget {
  const AccountCard({super.key, required this.titleColors});

  final Gradient titleColors;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final boot = ref.watch(supabaseBootProvider);
    final session = ref.watch(currentSessionProvider);
    final profileAsync = ref.watch(currentProfileProvider);
    final profile = profileAsync.maybeWhen(
      data: (profile) => profile,
      orElse: () => null,
    );

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.emoji_emotions,
        size: 32,
        color: AppColors.offwhite,
      ),
      // Three chips and a title in one Row is more than a narrow card holds:
      // a Row can only place its children, not fold them, so below roughly a
      // tablet's width the chips ran off the card's edge. A Wrap puts them on
      // a second line instead, still pushed to the trailing end, and the
      // title gives ground before any of it is clipped.
      titleWidget: Row(
        children: [
          Flexible(
            child: GradientText(
              gradient: titleColors,
              l10n.settingsAccountTitle,
              style: theme.textTheme.titleSmall,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Expanded(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              alignment: WrapAlignment.end,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _ConnectionChip(
                    isReady: boot.isReady, signedIn: session != null),
                if (profile != null)
                  _AccessLevelChip(level: profile.accessLevel),
                if (profile != null) _ColorChangeChip(profile: profile),
                const SizedBox(width: 8),
              ],
            ),
          ),
        ],
      ),
      initiallyExpanded: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          profileAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Text(
              l10n.settingsAccountProfileError('$error'),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.error),
            ),
            data: (profile) {
              if (profile == null) {
                return Text(l10n.settingsAccountSignedOut,
                    style: theme.textTheme.bodyMedium);
              }
              return _SignedInBody(
                profile: profile,
                email: session?.user.email ?? '',
              );
            },
          ),
          const Divider(height: 32),
          const SyncStatusRow(),
          const Divider(height: 32),
          _AdvancedSection(),
        ],
      ),
    );
  }
}

class _SignedInBody extends ConsumerWidget {
  const _SignedInBody({required this.profile, required this.email});

  final TeamMember profile;
  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Wrap(
      alignment: WrapAlignment.spaceBetween,
      crossAxisAlignment: WrapCrossAlignment.center,
      runSpacing: 12,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(
              backgroundColor: profile.color,
              child: Text(
                profile.displayName.characters.take(1).toString().toUpperCase(),
                style: const TextStyle(color: Colors.white),
              ),
            ),
            const SizedBox(width: 12),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 260),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    profile.displayName,
                    style: theme.textTheme.titleSmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    email,
                    style: theme.textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        OutlinedButton.icon(
          onPressed: () async {
            await ref.read(authControllerProvider.notifier).signOut();
          },
          icon: const Icon(Icons.logout),
          label: Text(l10n.authSignOutButton),
        ),
      ],
    );
  }
}

/// Says what this level can and cannot see, in the same words the database
/// rules enforce — so nobody has to guess why a price is blank. Kept to a
/// capsule with the icon and the level's name; the explanation moves into a
/// tooltip so this can sit on the header row next to the connection status
/// instead of taking a block of its own.
class _AccessLevelChip extends StatelessWidget {
  const _AccessLevelChip({required this.level});

  final AccessLevel level;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    final (label, explanation, background, foreground) = switch (level) {
      AccessLevel.full => (
          l10n.accessLevelFull,
          l10n.accessLevelFullExplanation,
          colors.secondary.withAlpha(100),
          colors.onSecondaryContainer,
        ),
      AccessLevel.basic => (
          l10n.accessLevelBasic,
          l10n.accessLevelBasicExplanation,
          colors.secondaryContainer,
          colors.onSecondaryContainer,
        ),
      AccessLevel.unauthorized => (
          l10n.accessLevelUnauthorized,
          l10n.accessLevelUnauthorizedExplanation,
          colors.errorContainer,
          colors.onErrorContainer,
        ),
    };

    return Tooltip(
      message: explanation,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_outlined, size: 14, color: foreground),
            const SizedBox(width: 4),
            Text(
              label,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: foreground),
            ),
          ],
        ),
      ),
    );
  }
}

/// The eight colors the database assigns from, so a person's chosen color
/// always comes from the same palette their teammates' do — picking freely
/// would let two people land on near-identical shades and defeat the purpose.
class _ColorPicker extends ConsumerStatefulWidget {
  const _ColorPicker({required this.current});

  final Color current;

  @override
  ConsumerState<_ColorPicker> createState() => _ColorPickerState();
}

class _ColorPickerState extends ConsumerState<_ColorPicker> {
  bool _saving = false;

  Future<void> _pick(Color color) async {
    final client = ref.read(supabaseClientProvider);
    final session = ref.read(currentSessionProvider);
    if (client == null || session == null || _saving) return;

    setState(() => _saving = true);
    try {
      await client.from('profiles').update(
          {'color': TeamMember.colorToHex(color)}).eq('id', session.user.id);
      ref.invalidate(currentProfileProvider);
      ref.invalidate(teamMembersProvider);
    } catch (error) {
      if (!mounted) return;
      AppToast.error(context, '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final color in TeamMember.palette)
          InkWell(
            onTap: _saving ? null : () => _pick(color),
            borderRadius: BorderRadius.circular(20),
            child: Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                border: Border.all(
                  color: color.toARGB32() == widget.current.toARGB32()
                      ? Theme.of(context).colorScheme.onSurface
                      : Colors.transparent,
                  width: 3,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The capsule that sits on the header row next to the connection status,
/// showing the account's own color and opening the picker on tap.
class _ColorChangeChip extends StatelessWidget {
  const _ColorChangeChip({required this.profile});

  final TeamMember profile;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: () => showDialog<void>(
        context: context,
        builder: (_) => _ColorPickerDialog(profile: profile),
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: colors.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: colors.outlineVariant),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.colorize, size: 14, color: colors.onSurfaceVariant),
            const SizedBox(width: 6),
            Text(
              l10n.settingsAccountColorButton,
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: colors.onSurfaceVariant),
            ),
            const SizedBox(width: 6),
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: profile.color,
                shape: BoxShape.circle,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The color picker, in a popup rather than inline in the card — the
/// palette swatches are only interesting at the moment someone wants to
/// change their color, not every time they open Settings. Also shows
/// everyone else's color underneath, in a simplified read-only form, so
/// the choice can be made with the same information the presence bar uses:
/// which shades are already taken.
class _ColorPickerDialog extends ConsumerWidget {
  const _ColorPickerDialog({required this.profile});

  final TeamMember profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    // Not `profile.color` — that's a snapshot from when the dialog opened.
    // Watching the provider keeps the picker's ring on the swatch that was
    // just saved, instead of the one that was current a tap ago.
    final currentColor = ref.watch(currentProfileProvider).maybeWhen(
              data: (current) => current?.color,
              orElse: () => null,
            ) ??
        profile.color;
    final membersAsync = ref.watch(teamMembersProvider);
    final others = membersAsync.maybeWhen(
      data: (members) =>
          members.values.where((member) => member.id != profile.id).toList(),
      orElse: () => const <TeamMember>[],
    );

    return AlertDialog(
      title: Text(l10n.settingsAccountColorLabel),
      content: SizedBox(
        width: 360,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.settingsAccountColorHelp,
                style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            _ColorPicker(current: currentColor),
            if (others.isNotEmpty) ...[
              const SizedBox(height: 20),
              Text(
                l10n.settingsAccountColorOthersLabel,
                style: theme.textTheme.labelLarge,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  for (final member in others)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 12,
                          height: 12,
                          decoration: BoxDecoration(
                            color: member.color,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(member.displayName,
                            style: theme.textTheme.bodySmall),
                      ],
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    );
  }
}

class _AdvancedSection extends StatefulWidget {
  @override
  State<_AdvancedSection> createState() => _AdvancedSectionState();
}

class _AdvancedSectionState extends State<_AdvancedSection> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: () => setState(() => _expanded = !_expanded),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.settingsServerAdvancedTitle,
                    style: Theme.of(context).textTheme.labelLarge,
                  ),
                ),
                Icon(_expanded ? Icons.expand_less : Icons.expand_more),
              ],
            ),
          ),
        ),
        if (_expanded) ...[
          Text(
            l10n.settingsServerAdvancedHelp,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          const ServerAddressFields(),
        ],
      ],
    );
  }
}

class _ConnectionChip extends StatelessWidget {
  const _ConnectionChip({required this.isReady, required this.signedIn});

  final bool isReady;
  final bool signedIn;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;

    final (label, background, foreground) = !isReady
        ? (
            l10n.settingsAccountStatusUnreachable,
            colors.errorContainer,
            colors.onErrorContainer
          )
        : signedIn
            ? (
                l10n.settingsAccountStatusConnected,
                AppColors.success.withAlpha(70),
                colors.onSecondaryContainer
              )
            : (
                l10n.settingsAccountStatusSignedOut,
                colors.surfaceContainerHighest,
                colors.onSurfaceVariant
              );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style:
            Theme.of(context).textTheme.labelSmall?.copyWith(color: foreground),
      ),
    );
  }
}
