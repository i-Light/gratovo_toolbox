import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/proxy_entry.dart';
import 'package:gratovo_toolbox/data/models/search_tuning_settings.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The scraper's pacing/proxy tunables — desktop-only (wrapped in
/// `DesktopOnly` by the caller, `settings_screen.dart`), since these only
/// mean anything on the machine that runs the Python search process.
///
/// No longer shows handles-to-search-limit: a genuine duplicate of the
/// search screen's own "Max videos/search" override
/// (`search_settings_panel.dart`'s `_MaxVideosField`, which already falls
/// back to whatever this card's own saved value is when left blank). Stays a
/// real `config.py` value on disk; this card just no longer edits it. (Two
/// more values used to live here — minimum subscribers and
/// recent-videos-months — removed outright rather than hidden, since
/// neither was read by the pipeline for anything; see
/// `data/models/search_tuning_settings.dart`'s doc comment.)
///
/// Edits are staged locally and only written through
/// `SearchTuningRepository.update()` on "Save" — a network/disk round-trip
/// per-slider-drag would be wasteful and, more importantly, noisy to
/// review before committing a pacing change the whole team's scraper runs
/// will pick up.
class SearchTuningCard extends ConsumerStatefulWidget {
  const SearchTuningCard({super.key});

  @override
  ConsumerState<SearchTuningCard> createState() => _SearchTuningCardState();
}

class _SearchTuningCardState extends ConsumerState<SearchTuningCard> {
  SearchTuningSettings? _local;
  _PacingTab _pacingTab = _PacingTab.normal;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final settingsAsync = ref.watch(searchTuningSettingsProvider);

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.search,
        size: 36,
        color: AppColors.info,
      ),
      title: l10n.settingsSearchTuningTitle,
      subtitle: l10n.settingsSearchTuningSubtitle,
      initiallyExpanded: false,
      child: settingsAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (settings) {
          _local ??= settings;
          final local = _local!;
          return _TuningForm(
            settings: local,
            l10n: l10n,
            pacingTab: _pacingTab,
            onPacingTabChanged: (tab) => setState(() => _pacingTab = tab),
            onChanged: (updated) => setState(() => _local = updated),
            onSave: () async {
              await ref.read(searchTuningRepositoryProvider).update(local);
              ref.invalidate(searchTuningSettingsProvider);
              if (context.mounted) {
                AppToast.success(context, l10n.settingsSearchTuningSaved);
              }
            },
          );
        },
      ),
    );
  }
}

/// Which of the two [PacingProfile]s (`search_tuning_settings.dart`) is
/// currently shown below the segmented control -- purely local UI state
/// (which tab is open), not a persisted setting, hence hoisted into
/// `_SearchTuningCardState` alongside the staged `_local` edits rather than
/// living in `SearchTuningSettings` itself.
enum _PacingTab { normal, fast }

class _TuningForm extends ConsumerWidget {
  const _TuningForm({
    required this.settings,
    required this.l10n,
    required this.pacingTab,
    required this.onPacingTabChanged,
    required this.onChanged,
    required this.onSave,
  });

  final SearchTuningSettings settings;
  final AppLocalizations l10n;
  final _PacingTab pacingTab;
  final ValueChanged<_PacingTab> onPacingTabChanged;
  final ValueChanged<SearchTuningSettings> onChanged;
  final Future<void> Function() onSave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Mirrors `config._proxy_rotation_active` OR'd with the AWS Gateway
    // provider's own enabled+deployed check -- the exact condition under
    // which `Config.delay()` picks the Fast profile on the Python side. A
    // still-loading/errored gateway provider counts as "not active" (the
    // same fallback `_AwsGatewaySection` uses), so the Fast tab defaults to
    // locked rather than briefly flashing unlocked before the real state
    // arrives.
    final awsGatewaySettings =
        ref.watch(awsGatewaySettingsProvider).asData?.value;
    final gatewayRotationActive = awsGatewaySettings != null &&
        awsGatewaySettings.enabled &&
        awsGatewaySettings.gateways.isNotEmpty;
    final rotationActive =
        settings.proxyRotationActive || gatewayRotationActive;
    final fastTabUsable = pacingTab == _PacingTab.fast && !rotationActive;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.settingsPacingTitle,
          style: Theme.of(context).textTheme.titleSmall,
        ),
        const SizedBox(height: 4),
        Text(
          l10n.settingsPacingHint,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        SegmentedButton<_PacingTab>(
          segments: [
            ButtonSegment(
              value: _PacingTab.normal,
              label: Text(l10n.settingsPacingNormalTab),
            ),
            ButtonSegment(
              value: _PacingTab.fast,
              label: Text(l10n.settingsPacingFastTab),
              icon: rotationActive
                  ? null
                  : const Icon(Icons.lock_outline, size: 16),
            ),
          ],
          selected: {pacingTab},
          onSelectionChanged: (selected) => onPacingTabChanged(selected.first),
        ),
        if (fastTabUsable) ...[
          const SizedBox(height: 8),
          Text(
            l10n.settingsPacingFastLockedHint,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: 12),
        _PacingSection(
          profile: pacingTab == _PacingTab.normal
              ? settings.pacing
              : settings.fastPacing,
          enabled: pacingTab == _PacingTab.normal || rotationActive,
          l10n: l10n,
          onChanged: (updated) => onChanged(
            pacingTab == _PacingTab.normal
                ? settings.copyWith(pacing: updated)
                : settings.copyWith(fastPacing: updated),
          ),
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.settingsProxyTitle,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            Switch(
              value: settings.proxyRotationEnabled,
              onChanged: (v) =>
                  onChanged(settings.copyWith(proxyRotationEnabled: v)),
            ),
          ],
        ),
        if (settings.proxyRotationEnabled) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.settingsProxyIncludeDirectLabel,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
              Switch(
                value: settings.includeDirectConnection,
                onChanged: (v) => onChanged(
                  settings.copyWith(includeDirectConnection: v),
                ),
              ),
            ],
          ),
          Text(
            l10n.settingsProxyIncludeDirectHint,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          if (settings.proxies.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(l10n.settingsProxyListEmpty),
            ),
          for (final proxy in settings.proxies)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                Icons.dns_outlined,
                color: proxy.enabled ? null : Theme.of(context).disabledColor,
              ),
              title: Text(proxy.label.isEmpty ? proxy.hostPort : proxy.label),
              subtitle: Text(proxy.hostPort),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: const Icon(Icons.edit_outlined),
                    onPressed: () async {
                      final updated =
                          await _openProxyEditor(context, l10n, entry: proxy);
                      if (updated == null) return;
                      onChanged(settings.copyWith(
                        proxies: [
                          for (final p in settings.proxies)
                            if (p.id == updated.id) updated else p,
                        ],
                      ));
                    },
                  ),
                  IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () => onChanged(settings.copyWith(
                      proxies: [
                        for (final p in settings.proxies)
                          if (p.id != proxy.id) p,
                      ],
                    )),
                  ),
                ],
              ),
            ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () async {
                final created = await _openProxyEditor(context, l10n);
                if (created == null) return;
                onChanged(settings.copyWith(
                  proxies: [...settings.proxies, created],
                ));
              },
              icon: const Icon(Icons.add),
              label: Text(l10n.settingsAddProxy),
            ),
          ),
        ],
        const SizedBox(height: 20),
        const _AwsGatewaySection(),
        const SizedBox(height: 20),
        _ParallelSection(
          settings: settings,
          gateways:
              gatewayRotationActive ? awsGatewaySettings.gateways.length : 0,
          l10n: l10n,
          onChanged: onChanged,
        ),
        const SizedBox(height: 16),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            onPressed: onSave,
            child: Text(l10n.commonSave),
          ),
        ),
      ],
    );
  }

  /// Add/edit dialog for one [ProxyEntry] — visually modelled on
  /// `ai_providers_card.dart`'s `_openEditor`, but returns the edited entry
  /// to the caller instead of persisting it directly: this card stages
  /// every edit locally and only writes to disk from its own bottom Save
  /// button (see the class doc comment), and a proxy row saving itself
  /// immediately would give this one card two different, inconsistent save
  /// behaviours.
  static Future<ProxyEntry?> _openProxyEditor(
    BuildContext context,
    AppLocalizations l10n, {
    ProxyEntry? entry,
  }) async {
    final labelController = TextEditingController(text: entry?.label ?? '');
    final hostController = TextEditingController(text: entry?.host ?? '');
    final portController = TextEditingController(
      text: entry?.port?.toString() ?? '',
    );
    final usernameController = TextEditingController(
      text: entry?.username ?? '',
    );
    final passwordController = TextEditingController(
      text: entry?.password ?? '',
    );
    var enabled = entry?.enabled ?? true;
    var obscurePassword = true;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: Text(
                entry == null
                    ? l10n.settingsNewProxyTitle
                    : l10n.settingsEditProxyTitle,
              ),
              content: SizedBox(
                width: 420,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      TextField(
                        controller: labelController,
                        decoration: InputDecoration(
                          labelText: l10n.settingsProxyLabelField,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: TextField(
                              controller: hostController,
                              decoration: InputDecoration(
                                labelText: l10n.settingsProxyHostLabel,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              controller: portController,
                              keyboardType: TextInputType.number,
                              decoration: InputDecoration(
                                labelText: l10n.settingsProxyPortLabel,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: usernameController,
                        decoration: InputDecoration(
                          labelText: l10n.settingsProxyUsernameLabel,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: passwordController,
                        obscureText: obscurePassword,
                        decoration: InputDecoration(
                          labelText: l10n.settingsProxyPasswordLabel,
                          suffixIcon: IconButton(
                            icon: Icon(
                              obscurePassword
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () => setDialogState(
                              () => obscurePassword = !obscurePassword,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(l10n.settingsProxyEnabledLabel),
                          ),
                          Switch(
                            value: enabled,
                            onChanged: (v) => setDialogState(() => enabled = v),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(l10n.commonCancel),
                ),
                FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: Text(l10n.commonSave),
                ),
              ],
            );
          },
        );
      },
    );

    // Read the fields out and release the controllers before any early
    // return: they are created fresh on every open of this dialog, so a
    // path that skipped disposal would leak one set per open.
    final label = labelController.text.trim();
    final host = hostController.text.trim();
    final port = int.tryParse(portController.text.trim());
    final username = usernameController.text.trim();
    final password = passwordController.text.trim();
    labelController.dispose();
    hostController.dispose();
    portController.dispose();
    usernameController.dispose();
    passwordController.dispose();

    if (saved != true) return null;
    if (host.isEmpty) return null;

    return ProxyEntry(
      id: entry?.id ?? 'proxy_${DateTime.now().microsecondsSinceEpoch}',
      label: label,
      host: host,
      port: port,
      username: username,
      password: password,
      enabled: enabled,
    );
  }
}

/// Parallel search: off by default, and only meaningful with at least two
/// rotating connections -- it says which, rather than letting a switch that
/// changes nothing look like it did something.
class _ParallelSection extends StatelessWidget {
  const _ParallelSection({
    required this.settings,
    required this.gateways,
    required this.l10n,
    required this.onChanged,
  });

  final SearchTuningSettings settings;

  /// AWS gateways deployed and switched on.
  final int gateways;
  final AppLocalizations l10n;
  final ValueChanged<SearchTuningSettings> onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final connections = settings.rotatingConnections(gateways: gateways);
    final workers = settings.parallelWorkers(gateways: gateways);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.settingsParallelTitle,
                style: theme.textTheme.titleSmall,
              ),
            ),
            Switch(
              key: const Key('parallel-search-switch'),
              value: settings.parallelSearchEnabled,
              onChanged: (v) =>
                  onChanged(settings.copyWith(parallelSearchEnabled: v)),
            ),
          ],
        ),
        Text(l10n.settingsParallelHint, style: theme.textTheme.bodySmall),
        if (settings.parallelSearchEnabled) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.settingsParallelMaxWorkersLabel,
                  style: theme.textTheme.bodyMedium,
                ),
              ),
              DropdownButton<int>(
                key: const Key('parallel-max-workers'),
                value: settings.parallelMaxWorkers.clamp(2, 8),
                items: [
                  for (var n = 2; n <= 8; n++)
                    DropdownMenuItem(value: n, child: Text('$n')),
                ],
                onChanged: (n) {
                  if (n != null) {
                    onChanged(settings.copyWith(parallelMaxWorkers: n));
                  }
                },
              ),
            ],
          ),
          Text(
            connections < 2
                ? l10n.settingsParallelNeedsTwo(connections)
                : l10n.settingsParallelActive(workers),
            key: const Key('parallel-search-status'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: connections < 2
                  ? theme.colorScheme.error
                  : theme.colorScheme.primary,
            ),
          ),
        ],
      ],
    );
  }
}

/// The Pacing section's field set for one [PacingProfile] -- shared by both
/// the Normal and Fast tabs on `_TuningForm`, which differ only in which
/// profile is passed in and whether [enabled] is true. See
/// `_TuningForm.build`'s `fastTabUsable` for when the Fast tab is shown
/// disabled (view-only): its numbers still render so a person can see what
/// is configured, but every control's `onChanged` is nulled out.
class _PacingSection extends StatelessWidget {
  const _PacingSection({
    required this.profile,
    required this.enabled,
    required this.l10n,
    required this.onChanged,
  });

  final PacingProfile profile;
  final bool enabled;
  final AppLocalizations l10n;
  final ValueChanged<PacingProfile> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _DelayRangeField(
          label: l10n.settingsHumanScrollDelayLabel,
          range: profile.humanScrollDelay,
          max: 10,
          enabled: enabled,
          onChanged: (r) => onChanged(profile.copyWith(humanScrollDelay: r)),
        ),
        _DelayRangeField(
          label: l10n.settingsJitterDelayLabel,
          range: profile.jitterDelay,
          max: 10,
          enabled: enabled,
          onChanged: (r) => onChanged(profile.copyWith(jitterDelay: r)),
        ),
        _DelayRangeField(
          label: l10n.settingsRecentVideosDelayLabel,
          range: profile.recentVideosDelay,
          max: 10,
          enabled: enabled,
          onChanged: (r) => onChanged(profile.copyWith(recentVideosDelay: r)),
        ),
        _DelayRangeField(
          label: l10n.settingsFastSubCountDelayLabel,
          range: profile.fastSubCountCheckDelay,
          max: 5,
          enabled: enabled,
          onChanged: (r) =>
              onChanged(profile.copyWith(fastSubCountCheckDelay: r)),
        ),
        _DelayRangeField(
          label: l10n.settingsFoundChannelsDelayLabel,
          range: profile.foundChannelsDelay,
          max: 10,
          enabled: enabled,
          onChanged: (r) => onChanged(profile.copyWith(foundChannelsDelay: r)),
        ),
        _DelayRangeField(
          label: l10n.settingsIpCooldownLabel,
          range: profile.ipCooldown,
          max: 300,
          enabled: enabled,
          onChanged: (r) => onChanged(profile.copyWith(ipCooldown: r)),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.settingsIpCooldownChanceLabel(
            '${(profile.ipCooldownChance * 100).round()}',
          ),
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        Slider(
          value: profile.ipCooldownChance,
          onChanged: enabled
              ? (v) => onChanged(profile.copyWith(ipCooldownChance: v))
              : null,
        ),
      ],
    );
  }
}

class _DelayRangeField extends StatelessWidget {
  const _DelayRangeField({
    required this.label,
    required this.range,
    required this.max,
    required this.enabled,
    required this.onChanged,
  });

  final String label;
  final DelayRange range;
  final double max;
  final bool enabled;
  final ValueChanged<DelayRange> onChanged;

  @override
  Widget build(BuildContext context) {
    final clampedMin = range.min.clamp(0, max).toDouble();
    final clampedMax = range.max.clamp(clampedMin, max).toDouble();

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$label: ${range.min.toStringAsFixed(1)}s–'
            '${range.max.toStringAsFixed(1)}s',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          RangeSlider(
            values: RangeValues(clampedMin, clampedMax),
            min: 0,
            max: max,
            divisions: (max * 2).round(),
            onChanged: enabled
                ? (values) => onChanged(
                      DelayRange(min: values.start, max: values.end),
                    )
                : null,
          ),
        ],
      ),
    );
  }
}

/// The AWS API Gateway outbound-IP-rotation toggle -- an alternative to the
/// proxy list above, see `pipeline/gratovo/scrapetube/proxy_pool.py`'s doc
/// comment. Unlike the rest of this card, this section writes through
/// immediately on toggle rather than staging into `_local`/waiting for the
/// card's own Save button: it lives in its own file (`data/aws_gateways.json`,
/// not `settings.json`) precisely so a Search Tuning save can never touch it,
/// so batching it into the same staged-edit flow would be misleading --
/// flipping this switch and closing the app without hitting the unrelated
/// Save button below would otherwise silently do nothing.
///
/// The gateway list itself is read-only here: which regions are deployed is
/// decided by running `tools/aws_gateway_setup.py deploy` on the machine that
/// runs searches, not from this screen -- see that script's doc comment for
/// why (it needs AWS credentials and makes real, billable AWS API calls,
/// neither of which belongs behind a Settings switch).
class _AwsGatewaySection extends ConsumerWidget {
  const _AwsGatewaySection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final settingsAsync = ref.watch(awsGatewaySettingsProvider);

    return settingsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (error, stackTrace) => const SizedBox.shrink(),
      data: (settings) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.settingsAwsGatewayTitle,
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                Switch(
                  // Disabled with nothing deployed: there is nothing to
                  // route through yet, and `writeAwsGatewayEnabled` is
                  // itself a no-op without a file to flip a flag in --
                  // this keeps the switch from looking like it did
                  // something when it didn't.
                  value: settings.enabled && settings.gateways.isNotEmpty,
                  onChanged: settings.gateways.isEmpty
                      ? null
                      : (v) async {
                          await ref
                              .read(awsGatewayRepositoryProvider)
                              .setEnabled(v);
                          ref.invalidate(awsGatewaySettingsProvider);
                          if (context.mounted) {
                            AppToast.success(
                              context,
                              v
                                  ? l10n.settingsAwsGatewayEnabledToast
                                  : l10n.settingsAwsGatewayDisabledToast,
                            );
                          }
                        },
                ),
              ],
            ),
            Text(
              l10n.settingsAwsGatewayHint,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            if (settings.gateways.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text(
                  l10n.settingsAwsGatewayEmpty,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              )
            else
              for (final gateway in settings.gateways)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: const Icon(Icons.cloud_outlined),
                  title: Text(gateway.region),
                  subtitle: Text(
                    gateway.url,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
          ],
        );
      },
    );
  }
}
