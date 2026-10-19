import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/aws_gateway_credentials.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/settings/application/aws_gateway_credentials_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/section_status_chip.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One tab per teammate for their own AWS IAM key pair -- the credentials
/// `tools/aws_gateway_setup.py` needs to deploy AWS Gateway IP-rotation
/// endpoints (see `_AwsGatewaySection` in `search_tuning_card.dart` for the
/// switch that turns routing through them on/off, which is unaffected by
/// this card).
///
/// Same shape as [ScratchpadScreen]'s tab strip: everyone's tab is shown so
/// the team can see who has a key configured, but only the signed-in
/// person's own tab is editable -- the database enforces that too (see
/// `aws_gateway_credentials_rw` in `backend/schema.sql`). Your own tab is
/// always first, so it is the one already open when this card is expanded.
class AwsAccountsCard extends ConsumerStatefulWidget {
  const AwsAccountsCard({super.key, required this.titleColors});
  final Gradient titleColors;

  @override
  ConsumerState<AwsAccountsCard> createState() => _AwsAccountsCardState();
}

class _AwsAccountsCardState extends ConsumerState<AwsAccountsCard> {
  String? _selectedId;

  List<TeamMember> _ordered(Iterable<TeamMember> members, String? myId) {
    final list = members.toList()
      ..sort((a, b) => a.displayName.toLowerCase().compareTo(
            b.displayName.toLowerCase(),
          ));
    if (myId == null) return list;
    final mineIndex = list.indexWhere((m) => m.id == myId);
    if (mineIndex <= 0) return list;
    final mine = list.removeAt(mineIndex);
    return [mine, ...list];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final myId = ref.watch(currentProfileProvider).value?.id;
    final membersAsync = ref.watch(teamMembersProvider);
    final gatewaySettings = ref.watch(awsGatewaySettingsProvider).asData?.value;
    final rotationOn = gatewaySettings != null &&
        gatewaySettings.enabled &&
        gatewaySettings.gateways.isNotEmpty;

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.hub,
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
            l10n.settingsAwsAccountsTitle,
            style: theme.textTheme.titleSmall,
          ),
          SectionStatusChip.info(
            icon: rotationOn ? Icons.sync : Icons.sync_disabled,
            label: rotationOn
                ? l10n.settingsAwsAccountsRotationOn
                : l10n.settingsAwsAccountsRotationOff,
          ),
          if (myId == null)
            SectionStatusChip.attention(
              label: l10n.settingsAwsAccountsNotSignedIn,
            ),
        ],
      ),
      subtitle: l10n.settingsAwsAccountsSubtitle,
      initiallyExpanded: false,
      child: membersAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (membersById) {
          final members = _ordered(membersById.values, myId);
          if (members.isEmpty) {
            return Text(
              l10n.settingsAwsAccountsNoTeammates,
              style: theme.textTheme.bodySmall,
            );
          }

          _selectedId ??= myId ?? members.first.id;
          if (!members.any((m) => m.id == _selectedId)) {
            _selectedId = myId ?? members.first.id;
          }
          final selected = members.firstWhere((m) => m.id == _selectedId);
          final isMine = myId != null && selected.id == myId;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _AccountTabStrip(
                members: members,
                selectedId: _selectedId!,
                myId: myId,
                onSelected: (id) => setState(() => _selectedId = id),
              ),
              const SizedBox(height: 12),
              if (myId == null)
                Text(
                  l10n.settingsAwsAccountsNotSignedIn,
                  style: theme.textTheme.bodySmall,
                )
              else if (isMine)
                const _MyAwsAccountPanel()
              else
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    l10n.settingsAwsAccountsOthersLocked(
                      selected.displayName,
                    ),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _AccountTabStrip extends StatelessWidget {
  const _AccountTabStrip({
    required this.members,
    required this.selectedId,
    required this.myId,
    required this.onSelected,
  });

  final List<TeamMember> members;
  final String selectedId;
  final String? myId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: members.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final m = members[i];
          final isSelected = m.id == selectedId;
          final isMine = m.id == myId;
          return ChoiceChip(
            selected: isSelected,
            onSelected: (_) => onSelected(m.id),
            avatar: CircleAvatar(backgroundColor: m.color, radius: 6),
            label: Text(
              isMine
                  ? '${m.displayName} · ${l10n.scratchpadYouTab}'
                  : m.displayName,
            ),
          );
        },
      ),
    );
  }
}

/// The signed-in person's own form: access key / secret / regions, the
/// setup guide, and this account's save history.
class _MyAwsAccountPanel extends ConsumerStatefulWidget {
  const _MyAwsAccountPanel();

  @override
  ConsumerState<_MyAwsAccountPanel> createState() => _MyAwsAccountPanelState();
}

class _MyAwsAccountPanelState extends ConsumerState<_MyAwsAccountPanel> {
  final _accessKeyController = TextEditingController();
  final _secretKeyController = TextEditingController();
  final _regionsController = TextEditingController();

  bool _seeded = false;
  bool _obscureSecret = true;
  bool _saving = false;
  bool _setupExpanded = false;
  bool _historyExpanded = false;

  @override
  void dispose() {
    _accessKeyController.dispose();
    _secretKeyController.dispose();
    _regionsController.dispose();
    super.dispose();
  }

  void _seedFrom(AwsGatewayCredentials current) {
    _accessKeyController.text = current.accessKeyId;
    _secretKeyController.text = current.secretAccessKey;
    _regionsController.text = current.defaultRegions;
    _seeded = true;
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final l10n = AppLocalizations.of(context);
    try {
      await ref.read(awsGatewayCredentialsControllerProvider.notifier).save(
            accessKeyId: _accessKeyController.text.trim(),
            secretAccessKey: _secretKeyController.text.trim(),
            defaultRegions: _regionsController.text.trim(),
          );
      if (mounted) {
        AppToast.success(context, l10n.settingsAwsAccountsSavedToast);
      }
    } catch (error) {
      if (mounted) {
        AppToast.error(
          context,
          l10n.settingsAwsAccountsSaveFailedToast('$error'),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _restore(AwsGatewayCredentialVersion version) {
    setState(() {
      _accessKeyController.text = version.accessKeyId;
      _secretKeyController.text = version.secretAccessKey;
      _regionsController.text = version.defaultRegions;
    });
    final l10n = AppLocalizations.of(context);
    AppToast.info(context, l10n.settingsAwsAccountsHistoryRestoredToast);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final stateAsync = ref.watch(awsGatewayCredentialsControllerProvider);

    return stateAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) => _ErrorBar(
        message: l10n.settingsAwsAccountsLoadFailed,
        retryLabel: l10n.settingsAwsAccountsRetry,
        onRetry: () => ref.invalidate(awsGatewayCredentialsControllerProvider),
      ),
      data: (state) {
        if (!_seeded) _seedFrom(state.current);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _accessKeyController,
              decoration: InputDecoration(
                labelText: l10n.settingsAwsAccountsAccessKeyLabel,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _secretKeyController,
              obscureText: _obscureSecret,
              decoration: InputDecoration(
                labelText: l10n.settingsAwsAccountsSecretKeyLabel,
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscureSecret
                        ? Icons.visibility_outlined
                        : Icons.visibility_off_outlined,
                  ),
                  tooltip: _obscureSecret
                      ? l10n.settingsAwsAccountsShowSecret
                      : l10n.settingsAwsAccountsHideSecret,
                  onPressed: () =>
                      setState(() => _obscureSecret = !_obscureSecret),
                ),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _regionsController,
              decoration: InputDecoration(
                labelText: l10n.settingsAwsAccountsRegionsLabel,
                hintText: l10n.settingsAwsAccountsRegionsHint,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton(
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.settingsAwsAccountsSaveButton),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              l10n.settingsAwsAccountsNotWiredNote,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const Divider(height: 24),
            _CollapsibleSection(
              title: l10n.settingsAwsAccountsSetupTitle,
              expanded: _setupExpanded,
              onToggle: () => setState(() => _setupExpanded = !_setupExpanded),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final step in [
                    l10n.settingsAwsAccountsSetupStep1,
                    l10n.settingsAwsAccountsSetupStep2,
                    l10n.settingsAwsAccountsSetupStep3,
                    l10n.settingsAwsAccountsSetupStep4,
                    l10n.settingsAwsAccountsSetupStep5,
                    l10n.settingsAwsAccountsSetupStep6,
                  ])
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(step, style: theme.textTheme.bodySmall),
                    ),
                ],
              ),
            ),
            const Divider(height: 24),
            _CollapsibleSection(
              title:
                  '${l10n.settingsAwsAccountsHistoryTitle} (${state.history.length})',
              expanded: _historyExpanded,
              onToggle: () =>
                  setState(() => _historyExpanded = !_historyExpanded),
              child: state.history.isEmpty
                  ? Text(
                      l10n.settingsAwsAccountsHistoryEmpty,
                      style: theme.textTheme.bodySmall,
                    )
                  : Column(
                      children: [
                        for (final version in state.history)
                          _HistoryRow(
                            version: version,
                            onRestore: () => _restore(version),
                          ),
                      ],
                    ),
            ),
          ],
        );
      },
    );
  }
}

class _CollapsibleSection extends StatelessWidget {
  const _CollapsibleSection({
    required this.title,
    required this.expanded,
    required this.onToggle,
    required this.child,
  });

  final String title;
  final bool expanded;
  final VoidCallback onToggle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: onToggle,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(title,
                      style: Theme.of(context).textTheme.labelLarge),
                ),
                Icon(expanded ? Icons.expand_less : Icons.expand_more),
              ],
            ),
          ),
        ),
        if (expanded) child,
      ],
    );
  }
}

class _HistoryRow extends ConsumerWidget {
  const _HistoryRow({required this.version, required this.onRestore});

  final AwsGatewayCredentialVersion version;
  final VoidCallback onRestore;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    final keyId = version.accessKeyId;
    final subtitle = keyId.isEmpty
        ? l10n.settingsAwsAccountsHistoryEntryBlank
        : l10n.settingsAwsAccountsHistoryEntryKey(
            keyId.length <= 4 ? keyId : keyId.substring(keyId.length - 4),
          );

    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: const Icon(Icons.history),
      title: Text(fmt.dateTime(version.savedAt)),
      subtitle: Text(
        [subtitle, version.defaultRegions]
            .where((s) => s.isNotEmpty)
            .join(' · '),
        style: theme.textTheme.bodySmall,
      ),
      trailing: TextButton(
        onPressed: onRestore,
        child: Text(l10n.settingsAwsAccountsHistoryRestore),
      ),
    );
  }
}

class _ErrorBar extends StatelessWidget {
  const _ErrorBar({
    required this.message,
    required this.retryLabel,
    required this.onRetry,
  });

  final String message;
  final String retryLabel;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(
          child: Text(
            message,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.error),
          ),
        ),
        TextButton(onPressed: onRetry, child: Text(retryLabel)),
      ],
    );
  }
}
