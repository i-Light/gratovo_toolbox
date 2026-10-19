import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/status/gemini_bridge_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/features/settings/application/gemini_account_memory.dart';
import 'package:gratovo_toolbox/features/settings/application/gemini_bridge_controller.dart';
import 'package:gratovo_toolbox/features/settings/presentation/widgets/section_status_chip.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Settings → Accounts → "Gemini in browser": the daemon that drives the
/// team's signed-in Gemini tab through the browser extension.
///
/// Top to bottom: the bridge's state and the buttons that move it (Start /
/// Stop / Test / Open Gemini). The Google account — the one signed in now, or
/// the last one seen, remembered by `geminiAccountMemoryProvider`. The
/// browser: which one Gemini opens in, what is installed, the add-on's state,
/// the two background switches, and for Edge/Chrome a copy button for the
/// folder to load unpacked (Firefox gets its add-on automatically). The text
/// settings (`GeminiBridgeSettings`: port, account match, gem URLs, default
/// model, browser program) with a Save that writes only the fields edited
/// here. And the Diagnostics panel — the
/// reason this card exists at all: when Gemini's page changes and an element
/// cannot be found, this is where somebody sees what is missing, how it used
/// to be found, and applies one of the extension's own suggestions without
/// touching code.
class GeminiBridgeCard extends ConsumerStatefulWidget {
  const GeminiBridgeCard({super.key, required this.titleColors});

  final Gradient titleColors;

  @override
  ConsumerState<GeminiBridgeCard> createState() => _GeminiBridgeCardState();
}

class _GeminiBridgeCardState extends ConsumerState<GeminiBridgeCard> {
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final bridge = ref.watch(geminiBridgeProvider);
    final bridgeState = ref.watch(geminiBridgeStateProvider);
    final card = ref.watch(geminiBridgeCardProvider);

    ref.listen(geminiBridgeCardProvider, (previous, next) {
      final healError = next.healError;
      if (healError != null && healError != previous?.healError) {
        AppToast.error(context, describeGeminiFailure(healError, l10n));
      }
      final healed = next.lastHealedElement;
      if (healed != null &&
          healed != previous?.lastHealedElement &&
          next.healingElement == null) {
        AppToast.success(context, l10n.geminiBridgeFixApplied(healed));
      }
    });

    return CollapsibleCard(
      leadingIcon: const Icon(
        Icons.language,
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
            l10n.geminiBridgeTitle,
            style: theme.textTheme.titleSmall,
          ),
          _StateChip(state: bridgeState),
        ],
      ),
      subtitle: l10n.geminiBridgeSubtitle,
      initiallyExpanded: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!bridge.isAvailable)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                l10n.geminiBridgeNotAvailable,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          _StatusLine(state: bridgeState),
          const SizedBox(height: 12),
          _ActionRow(
            bridgeState: bridgeState,
            card: card,
            available: bridge.isAvailable,
          ),
          if (card.testResult != null || card.testError != null) ...[
            const SizedBox(height: 12),
            _TestResult(result: card.testResult, error: card.testError),
          ],
          const SizedBox(height: 20),
          const _AccountSection(),
          const SizedBox(height: 20),
          _BrowserSection(card: card, extensionDir: bridge.extensionDir),
          const SizedBox(height: 20),
          const _SettingsFields(),
          const SizedBox(height: 20),
          _DiagnosticsPanel(card: card),
        ],
      ),
    );
  }
}

/// The header capsule: one glance says stopped / starting / listening /
/// connected as … / failed.
class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final GeminiBridgeState state;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final label = geminiBridgeStateLabel(state, l10n);
    return switch (state.phase) {
      GeminiBridgePhase.failed => SectionStatusChip.attention(
          label: label,
          tooltip: state.message,
        ),
      GeminiBridgePhase.connected => SectionStatusChip.info(
          label: label,
          icon: Icons.check_circle_outline,
        ),
      GeminiBridgePhase.listening => SectionStatusChip.info(
          label: label,
          icon: Icons.hourglass_empty,
        ),
      GeminiBridgePhase.starting => SectionStatusChip.info(
          label: label,
          icon: Icons.hourglass_top,
        ),
      GeminiBridgePhase.stopped => SectionStatusChip.info(
          label: label,
          icon: Icons.power_settings_new,
        ),
    };
  }
}

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.state});

  final GeminiBridgeState state;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final lines = <String>[geminiBridgeStateLabel(state, l10n)];
    final model = state.modelName;
    if (state.isConnected && model != null) {
      lines.add(l10n.geminiBridgeModelLine(model));
    }
    if (state.isConnected && (state.status?.status?.signedOut ?? false)) {
      lines.add(l10n.geminiBridgeTestSignedOut);
    }
    final message = state.message;
    if (state.isFailed && message != null) lines.add(message);
    return SelectableText(
      lines.join('\n'),
      style: theme.textTheme.bodyMedium,
    );
  }
}

class _ActionRow extends ConsumerWidget {
  const _ActionRow({
    required this.bridgeState,
    required this.card,
    required this.available,
  });

  final GeminiBridgeState bridgeState;
  final GeminiBridgeCardState card;
  final bool available;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(geminiBridgeCardProvider.notifier);
    final enabled = available && !card.busy;

    Future<void> run(
      Future<GeminiBridgeException?> Function() action,
    ) async {
      final error = await action();
      if (error != null && context.mounted) {
        AppToast.error(context, describeGeminiFailure(error, l10n));
      }
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (bridgeState.isUp || bridgeState.isStarting)
          FilledButton.tonalIcon(
            onPressed: enabled ? () => run(controller.stop) : null,
            icon: const Icon(Icons.stop_circle_outlined),
            label: Text(l10n.geminiBridgeStop),
          )
        else
          FilledButton.icon(
            onPressed: enabled ? () => run(controller.start) : null,
            icon: const Icon(Icons.play_arrow),
            label: Text(l10n.geminiBridgeStart),
          ),
        OutlinedButton.icon(
          onPressed: enabled ? controller.test : null,
          icon: const Icon(Icons.network_check),
          label: Text(l10n.geminiBridgeTest),
        ),
        OutlinedButton.icon(
          onPressed: enabled ? () => run(controller.openGemini) : null,
          icon: const Icon(Icons.open_in_browser),
          label: Text(l10n.geminiBridgeOpenGemini),
        ),
        if (card.busy)
          const SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
      ],
    );
  }
}

/// What Test came back with — the daemon's `bridge.status`, laid out as the
/// four facts somebody checks: extension connected, account, model, signed
/// in or out.
class _TestResult extends StatelessWidget {
  const _TestResult({required this.result, required this.error});

  final GeminiBridgeStatus? result;
  final GeminiBridgeException? error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;

    final failure = error;
    if (failure != null) {
      return _Notice(
        icon: Icons.error_outline,
        color: colors.error,
        text: describeGeminiFailure(failure, l10n),
      );
    }
    final status = result!;
    final page = status.status;
    final account = page?.account;
    final rows = <(IconData, String, bool)>[
      (
        Icons.power,
        status.listening
            ? l10n.geminiBridgeTestListening('${status.port ?? ''}')
            : l10n.geminiBridgeTestNotListening,
        status.listening,
      ),
      (
        Icons.extension_outlined,
        status.extensionConnected
            ? l10n.geminiBridgeTestExtensionConnected
            : l10n.geminiBridgeTestExtensionMissing,
        status.extensionConnected,
      ),
      if (page != null) ...[
        (
          Icons.person_outline,
          account == null || account.isEmpty
              ? l10n.geminiBridgeTestAccountUnknown
              : l10n.geminiBridgeTestAccount(account.label),
          account != null && !account.isEmpty,
        ),
        (
          Icons.memory,
          page.modelName == null
              ? l10n.geminiBridgeTestModelUnknown
              : l10n.geminiBridgeTestModel(page.modelName!),
          page.modelName != null,
        ),
        (
          page.signedOut ? Icons.lock_outline : Icons.lock_open,
          page.signedOut
              ? l10n.geminiBridgeTestSignedOut
              : l10n.geminiBridgeTestSignedIn,
          !page.signedOut,
        ),
      ],
    ];
    final statusError = status.statusError;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (icon, text, ok) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  Icon(
                    icon,
                    size: 16,
                    color: ok ? colors.primary : colors.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(text, style: theme.textTheme.bodySmall),
                  ),
                ],
              ),
            ),
          if (statusError != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                describeGeminiFailure(statusError, l10n),
                style: theme.textTheme.bodySmall?.copyWith(color: colors.error),
              ),
            ),
        ],
      ),
    );
  }
}

/// Who Gemini belongs to: the account signed in now, or — with the browser
/// closed — the last one seen, which is remembered. When that account is
/// not the one actions are pinned to, one click pins it.
class _AccountSection extends ConsumerWidget {
  const _AccountSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final settings = ref.watch(geminiBridgeSettingsProvider);
    final state = ref.watch(geminiBridgeStateProvider);
    final live = state.isConnected ? state.account : null;
    final hasLive = live != null && !live.isEmpty;
    final shown = hasLive ? live : lastSeenAccount(settings);
    final email = shown?.email?.trim() ?? '';
    final match = settings.accountMatch.trim();
    final canPin =
        email.isNotEmpty && match.toLowerCase() != email.toLowerCase();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.geminiBridgeAccountTitle, style: theme.textTheme.titleSmall),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(
              hasLive ? Icons.account_circle : Icons.account_circle_outlined,
              size: 18,
              color: hasLive
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: SelectableText(
                shown == null
                    ? l10n.geminiBridgeNoAccountSeen
                    : hasLive
                        ? l10n.geminiBridgeSignedInAs(shown.label)
                        : l10n.geminiBridgeLastSeen(shown.label),
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
        if (match.isNotEmpty)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 26, top: 2),
            child: Text(
              l10n.geminiBridgeAccountPinned(match),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        if (canPin)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 18, top: 4),
            child: TextButton.icon(
              onPressed: () async {
                await ref
                    .read(geminiBridgeSettingsProvider.notifier)
                    .edit((current) => current.copyWith(accountMatch: email));
                if (!context.mounted) return;
                AppToast.success(context, l10n.geminiBridgeSettingsSaved);
              },
              icon: const Icon(Icons.push_pin_outlined, size: 18),
              label: Text(l10n.geminiBridgeUseAccount(email)),
            ),
          ),
      ],
    );
  }
}

/// Which browser Gemini opens in, and what the app knows about it. Choices
/// and switches save at once — there is nothing half-typed about them — and
/// every browser call carries them, so they apply without a restart.
class _BrowserSection extends ConsumerWidget {
  const _BrowserSection({required this.card, required this.extensionDir});

  final GeminiBridgeCardState card;
  final String? extensionDir;

  static const _relativeExtensionDir = 'pipeline/gemini_extension';

  /// The product name alone, for "Starting Firefox…" — the picker's labels
  /// carry notes like "(recommended)".
  static String _plainBrowserName(String? wire) => switch (wire) {
        'edge' => 'Microsoft Edge',
        'chrome' => 'Google Chrome',
        'firefox' || null || '' => 'Firefox',
        final other => other,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final settings = ref.watch(geminiBridgeSettingsProvider);
    final notifier = ref.read(geminiBridgeSettingsProvider.notifier);
    final controller = ref.read(geminiBridgeCardProvider.notifier);
    final info = card.browserInfo;
    final infoError = card.browserInfoError;
    final activity = ref.watch(geminiWindowActivityProvider);

    String browserName(GeminiBrowserKind kind) => switch (kind) {
          GeminiBrowserKind.firefox => l10n.geminiBridgeBrowserFirefox,
          GeminiBrowserKind.edge => l10n.geminiBridgeBrowserEdge,
          GeminiBrowserKind.chrome => l10n.geminiBridgeBrowserChrome,
          GeminiBrowserKind.system => l10n.geminiBridgeBrowserSystem,
        };

    // Firefox gets its add-on from the app; Edge and Chrome need the folder
    // loaded unpacked once, and that is all the help they need here.
    final loadsUnpacked = settings.browser == GeminiBrowserKind.edge ||
        settings.browser == GeminiBrowserKind.chrome;
    final folder = extensionDir ?? _relativeExtensionDir;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.geminiBridgeBrowserTitle, style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<GeminiBrowserKind>(
                // Keyed on the value: the saved choice arrives after the
                // first build, and initialValue is only read once.
                key: ValueKey(settings.browser),
                initialValue: settings.browser,
                isExpanded: true,
                decoration: InputDecoration(
                  labelText: l10n.geminiBridgeBrowserLabel,
                  isDense: true,
                ),
                items: [
                  for (final kind in GeminiBrowserKind.values)
                    DropdownMenuItem(
                      value: kind,
                      child: Text(browserName(kind)),
                    ),
                ],
                onChanged: (kind) {
                  if (kind == null || kind == settings.browser) return;
                  notifier.edit((current) => current.copyWith(browser: kind));
                },
              ),
            ),
            if (loadsUnpacked)
              IconButton(
                tooltip: '${l10n.geminiBridgeExtensionFolderCopy}\n$folder',
                icon: const Icon(Icons.copy_outlined, size: 18),
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: folder));
                  if (!context.mounted) return;
                  AppToast.success(context, l10n.commonCopied);
                },
              ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              onPressed:
                  card.browserInfoLoading ? null : controller.detectBrowsers,
              icon: card.browserInfoLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.travel_explore, size: 18),
              label: Text(l10n.geminiBridgeDetectBrowsers),
            ),
          ],
        ),
        if (activity != null)
          Padding(
            key: const ValueKey('gemini-window-activity'),
            padding: const EdgeInsets.only(top: 8),
            child: Row(
              children: [
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    switch (activity.step) {
                      GeminiWindowStep.launching =>
                        l10n.geminiBridgeWindowLaunching(
                          _plainBrowserName(activity.browser),
                        ),
                      GeminiWindowStep.installing =>
                        l10n.geminiBridgeWindowInstalling,
                    },
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        if (infoError != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _Notice(
              icon: Icons.error_outline,
              color: theme.colorScheme.error,
              text: describeGeminiFailure(infoError, l10n),
            ),
          )
        else if (info != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: _DetectedBrowsers(info: info, selected: settings.browser),
          ),
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: settings.autoStart,
          title: Text(l10n.geminiBridgeAutoStartLabel),
          onChanged: (on) =>
              notifier.edit((current) => current.copyWith(autoStart: on)),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: settings.autoOpenWindow,
          title: Text(l10n.geminiBridgeAutoOpenLabel),
          onChanged: (on) =>
              notifier.edit((current) => current.copyWith(autoOpenWindow: on)),
        ),
      ],
    );
  }
}

/// The browsers the daemon found, and — for Firefox, where the app installs
/// the add-on itself — what state the add-on is in.
class _DetectedBrowsers extends StatelessWidget {
  const _DetectedBrowsers({required this.info, required this.selected});

  final GeminiBrowserInfo info;
  final GeminiBrowserKind selected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = Theme.of(context).colorScheme;
    final installed = info.installedBrowsers;
    final selectedFound = installed.any((b) => b.kind == selected);
    final addon = info.addon;
    final addonLine = switch (addon.state) {
      GeminiAddonState.missing => l10n.geminiBridgeAddonMissing,
      GeminiAddonState.temporary => l10n.geminiBridgeAddonTemporary,
      GeminiAddonState.installed => l10n.geminiBridgeAddonInstalled,
      GeminiAddonState.outdated => l10n.geminiBridgeAddonOutdated,
      GeminiAddonState.unsignedBlocked => l10n.geminiBridgeAddonBlocked,
      GeminiAddonState.unknown => l10n.geminiBridgeAddonUnknown,
    };

    String describe(GeminiBrowserEntry browser) {
      final details = [
        if (browser.version != null) browser.version!,
        if (browser.channel != 'unknown') browser.channel,
      ].join(' · ');
      return l10n.geminiBridgeBrowserFound(browser.label, details).trim();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (installed.isEmpty)
          _Notice(
            icon: Icons.warning_amber,
            color: colors.error,
            text: l10n.geminiBridgeBrowserNoneFound,
          )
        else
          for (final browser in installed)
            _Notice(
              icon: browser.kind == selected
                  ? Icons.check_circle
                  : Icons.check_circle_outline,
              color: browser.kind == selected
                  ? colors.primary
                  : colors.onSurfaceVariant,
              text: describe(browser),
            ),
        if (installed.isNotEmpty &&
            !selectedFound &&
            selected != GeminiBrowserKind.system)
          _Notice(
            icon: Icons.warning_amber,
            color: colors.error,
            text: l10n.geminiBridgeBrowserSelectedMissing,
          ),
        if (selected == GeminiBrowserKind.firefox)
          _Notice(
            icon: Icons.extension_outlined,
            color: addon.state == GeminiAddonState.unsignedBlocked
                ? colors.error
                : colors.onSurfaceVariant,
            text: addon.message.isEmpty
                ? addonLine
                : '$addonLine\n${addon.message}',
          ),
      ],
    );
  }
}

/// The per-machine text settings. Typing edits the fields; Save writes only
/// the fields that were edited here, merged into the settings as they are
/// then. Writing a whole local copy — as this card used to — put back
/// whatever that copy held from when the card was built: the defaults, if
/// that was before the saved values loaded, and never the account remembered
/// since — one way a saved account could vanish.
class _SettingsFields extends ConsumerStatefulWidget {
  const _SettingsFields();

  @override
  ConsumerState<_SettingsFields> createState() => _SettingsFieldsState();
}

enum _Field {
  port,
  accountMatch,
  keywordsGem,
  defaultModel,
  browserPath,
}

String _valueOf(GeminiBridgeSettings s, _Field field) => switch (field) {
      _Field.port => '${s.port}',
      _Field.accountMatch => s.accountMatch,
      _Field.keywordsGem => s.keywordsGem,
      _Field.defaultModel => s.defaultModel,
      _Field.browserPath => s.browserPath,
    };

GeminiBridgeSettings _withValue(
  GeminiBridgeSettings s,
  _Field field,
  String text,
) =>
    switch (field) {
      _Field.port => s.copyWith(port: int.parse(text.trim())),
      _Field.accountMatch => s.copyWith(accountMatch: text),
      _Field.keywordsGem => s.copyWith(keywordsGem: text),
      _Field.defaultModel => s.copyWith(defaultModel: text),
      _Field.browserPath => s.copyWith(browserPath: text),
    };

class _SettingsFieldsState extends ConsumerState<_SettingsFields> {
  late final Map<_Field, TextEditingController> _controllers;

  /// What each field held when it last matched the settings; a field whose
  /// text differs from this has been edited here.
  late final Map<_Field, String> _synced;

  @override
  void initState() {
    super.initState();
    final settings = ref.read(geminiBridgeSettingsProvider);
    _synced = {for (final f in _Field.values) f: _valueOf(settings, f)};
    _controllers = {
      for (final f in _Field.values)
        f: TextEditingController(text: _synced[f])..addListener(_changed),
    };
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  void _changed() => setState(() {});

  bool _dirty(_Field f) => _controllers[f]!.text != _synced[f];

  /// The settings changed underneath — the saved values loaded, the account
  /// was pinned from the section above, another card wrote. Fields not being
  /// edited follow; an edited one is left alone unless it now matches.
  void _follow(GeminiBridgeSettings settings) {
    for (final f in _Field.values) {
      final value = _valueOf(settings, f);
      final controller = _controllers[f]!;
      if (!_dirty(f)) {
        _synced[f] = value;
        if (controller.text != value) controller.text = value;
      } else if (controller.text == value) {
        _synced[f] = value;
      }
    }
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    final edited = {
      for (final f in _Field.values)
        if (_dirty(f)) f: _controllers[f]!.text,
    };
    await ref.read(geminiBridgeSettingsProvider.notifier).edit((current) {
      var next = current;
      edited.forEach((f, text) => next = _withValue(next, f, text));
      return next;
    });
    if (!mounted) return;
    setState(() => _synced.addAll(edited));
    AppToast.success(context, l10n.geminiBridgeSettingsSaved);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    ref.listen(geminiBridgeSettingsProvider, (_, next) => _follow(next));

    final port = int.tryParse(_controllers[_Field.port]!.text.trim());
    final portValid = port != null && port >= 1 && port <= 65535;
    final anyEdited = _Field.values.any(_dirty);

    Widget field(_Field f, String label, {String? hint, String? error}) =>
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextFormField(
            controller: _controllers[f],
            keyboardType:
                f == _Field.port ? TextInputType.number : TextInputType.text,
            inputFormatters: f == _Field.port
                ? [FilteringTextInputFormatter.digitsOnly]
                : null,
            decoration: InputDecoration(
              labelText: label,
              hintText: hint,
              errorText: error,
            ),
          ),
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        field(
          _Field.port,
          l10n.geminiBridgePortLabel,
          hint: '${GeminiBridgeSettings.defaultPort}',
          error: portValid ? null : l10n.geminiBridgePortInvalid,
        ),
        field(
          _Field.accountMatch,
          l10n.geminiBridgeAccountMatchLabel,
          hint: l10n.geminiBridgeAccountMatchHint,
        ),
        field(
          _Field.keywordsGem,
          l10n.geminiBridgeKeywordsGemLabel,
          hint: l10n.geminiBridgeGemHint,
        ),
        field(
          _Field.defaultModel,
          l10n.geminiBridgeDefaultModelLabel,
          hint: l10n.geminiBridgeDefaultModelHint,
        ),
        field(
          _Field.browserPath,
          l10n.geminiBridgeBrowserPathLabel,
          hint: l10n.geminiBridgeBrowserPathHint,
        ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: FilledButton(
            onPressed: portValid && anyEdited ? _save : null,
            child: Text(l10n.commonSave),
          ),
        ),
        Text(
          l10n.geminiBridgeSettingsRestartHint,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

// ---- diagnostics -----------------------------------------------------------

class _DiagnosticsPanel extends ConsumerWidget {
  const _DiagnosticsPanel({required this.card});

  final GeminiBridgeCardState card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final controller = ref.read(geminiBridgeCardProvider.notifier);
    final diagnostics = card.diagnostics;
    final error = card.diagnosticsError;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.geminiBridgeDiagnosticsTitle,
                style: theme.textTheme.titleSmall,
              ),
            ),
            if (diagnostics != null)
              TextButton.icon(
                onPressed: () async {
                  await Clipboard.setData(
                    ClipboardData(text: diagnostics.rawJson),
                  );
                  if (!context.mounted) return;
                  AppToast.success(
                    context,
                    l10n.geminiBridgeDiagnosticsJsonCopied,
                  );
                },
                icon: const Icon(Icons.data_object, size: 18),
                label: Text(l10n.geminiBridgeCopyJson),
              ),
            FilledButton.tonalIcon(
              onPressed:
                  card.diagnosticsLoading ? null : controller.runDiagnostics,
              icon: card.diagnosticsLoading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.troubleshoot_outlined, size: 18),
              label: Text(l10n.geminiBridgeRunDiagnostics),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (card.diagnosticsLoading && diagnostics == null)
          Text(
            l10n.geminiBridgeDiagnosticsRunning,
            style: theme.textTheme.bodySmall,
          )
        else if (error != null)
          _Notice(
            icon: Icons.error_outline,
            color: theme.colorScheme.error,
            text: describeGeminiFailure(error, l10n),
          )
        else if (diagnostics == null)
          Text(
            l10n.geminiBridgeDiagnosticsEmpty,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          )
        else
          _DiagnosticsBody(diagnostics: diagnostics, card: card),
      ],
    );
  }
}

class _DiagnosticsBody extends StatelessWidget {
  const _DiagnosticsBody({required this.diagnostics, required this.card});

  final GeminiDiagnostics diagnostics;
  final GeminiBridgeCardState card;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final elements = diagnostics.elements.values.toList();
    final missing = diagnostics.missingElements.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Notice(
          icon: missing == 0 ? Icons.check_circle_outline : Icons.warning_amber,
          color: missing == 0 ? colors.primary : colors.error,
          text: missing == 0
              ? l10n.geminiBridgeDiagnosticsAllFound(elements.length)
              : l10n.geminiBridgeDiagnosticsMissing(missing, elements.length),
        ),
        if (diagnostics.signedOut)
          _Notice(
            icon: Icons.lock_outline,
            color: colors.error,
            text: l10n.geminiBridgeTestSignedOut,
          ),
        if (diagnostics.pageError != null)
          _Notice(
            icon: Icons.report_outlined,
            color: colors.error,
            text: diagnostics.pageError!,
          ),
        if (diagnostics.page.changed)
          _Notice(
            icon: Icons.difference_outlined,
            color: colors.tertiary,
            text: l10n.geminiBridgeDiagnosticsPageChanged,
          ),
        const SizedBox(height: 4),
        for (final element in elements)
          _ElementTile(
            element: element,
            healing: card.healingElement == element.name,
            anyHealing: card.healingElement != null,
          ),
      ],
    );
  }
}

/// One element: found (strategy in the subtitle) or missing (everything the
/// resolver tried, what it used to match, and the fixes on offer).
class _ElementTile extends ConsumerWidget {
  const _ElementTile({
    required this.element,
    required this.healing,
    required this.anyHealing,
  });

  final GeminiElementDiagnostics element;
  final bool healing;
  final bool anyHealing;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final colors = theme.colorScheme;
    final controller = ref.read(geminiBridgeCardProvider.notifier);
    final strategy = element.strategy;
    final lastKnown = element.lastKnown;

    return Card(
      margin: const EdgeInsets.only(bottom: 6),
      child: ExpansionTile(
        key: ValueKey('gemini-element-${element.name}'),
        shape: const Border(),
        initiallyExpanded: !element.found,
        leading: Icon(
          element.found ? Icons.check_circle : Icons.cancel,
          color: element.found ? colors.primary : colors.error,
        ),
        title: Text(element.name, style: theme.textTheme.titleSmall),
        subtitle: Text(
          element.found
              ? (strategy == null
                  ? l10n.geminiBridgeElementFound
                  : l10n.geminiBridgeElementStrategy(strategy))
              : l10n.geminiBridgeElementMissing,
          style: theme.textTheme.bodySmall?.copyWith(
            color: element.found ? colors.onSurfaceVariant : colors.error,
          ),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (element.found && element.element.isNotEmpty)
            _Mono(describeElement(element.element)),
          if (element.tried.isNotEmpty) ...[
            _SubHeading(l10n.geminiBridgeElementTried),
            for (final attempt in element.tried)
              _Mono(
                l10n.geminiBridgeTriedLine(
                  attempt.describe ?? attempt.strategy,
                  attempt.matched,
                  attempt.visible,
                ),
              ),
          ],
          if (!element.found) ...[
            _SubHeading(l10n.geminiBridgeElementLastKnown),
            if (lastKnown == null)
              Text(
                l10n.geminiBridgeElementLastKnownNone,
                style: theme.textTheme.bodySmall,
              )
            else ...[
              if (lastKnown.strategy != null)
                _Mono(l10n.geminiBridgeElementStrategy(lastKnown.strategy!)),
              if (lastKnown.element.isNotEmpty)
                _Mono(describeElement(lastKnown.element)),
              if (lastKnown.at != null)
                Text(
                  lastKnown.at!.toLocal().toString(),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
                ),
            ],
            _SubHeading(l10n.geminiBridgeElementSuggestions),
            if (element.suggestions.isEmpty)
              Text(
                l10n.geminiBridgeElementNoSuggestions,
                style: theme.textTheme.bodySmall,
              )
            else
              for (var i = 0; i < element.suggestions.length; i++)
                _SuggestionRow(
                  index: i,
                  suggestion: element.suggestions[i],
                  busy: healing,
                  enabled: !anyHealing,
                  onApply: () => controller.applyFix(element.name, i),
                ),
          ],
        ],
      ),
    );
  }
}

class _SuggestionRow extends StatelessWidget {
  const _SuggestionRow({
    required this.index,
    required this.suggestion,
    required this.busy,
    required this.enabled,
    required this.onApply,
  });

  final int index;
  final GeminiSuggestion suggestion;
  final bool busy;
  final bool enabled;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final reason = suggestion.reason;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 24,
            child: Text('${index + 1}.', style: theme.textTheme.bodySmall),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _Mono(suggestion.describe),
                if (suggestion.candidate.isNotEmpty)
                  _Mono(describeElement(suggestion.candidate)),
                if (reason != null)
                  Text(
                    reason,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.tonal(
            onPressed: enabled ? onApply : null,
            child: Text(
              busy ? l10n.geminiBridgeApplyingFix : l10n.geminiBridgeApplyFix,
            ),
          ),
        ],
      ),
    );
  }
}

class _SubHeading extends StatelessWidget {
  const _SubHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 4),
      child: Text(
        text,
        style: theme.textTheme.labelLarge?.copyWith(
          color: theme.colorScheme.primary,
        ),
      ),
    );
  }
}

class _Mono extends StatelessWidget {
  const _Mono(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: SelectableText(
        text,
        style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace'),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.color,
    required this.text,
  });

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(text, style: theme.textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}
