import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/config/supabase_config.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Overrides for the server address and public key, shared by the login
/// screen's Advanced section and Settings → Account.
///
/// Both values are public by design (see supabase_config.dart), which is why
/// they can be edited in the app at all. The service key — the one that
/// bypasses every access rule — is deliberately not here and never will be; it
/// belongs only in `backend/.env` on the machine that runs the importer.
///
/// Changing these requires a restart, and says so. `Supabase.initialize()`
/// can only run once per process, so a live swap would leave half the app
/// talking to the old project. A restart is the honest answer.
///
/// "Reset to defaults" means what THIS build shipped with
/// ([shippedSupabaseConfigProvider]) and the card says what that is, so the
/// button is never a leap of faith: the shipped address and a masked key sit
/// under the fields, and the button is only live when there is something for
/// it to undo.
class ServerAddressFields extends ConsumerStatefulWidget {
  const ServerAddressFields({super.key});

  @override
  ConsumerState<ServerAddressFields> createState() =>
      _ServerAddressFieldsState();
}

class _ServerAddressFieldsState extends ConsumerState<ServerAddressFields> {
  late final TextEditingController _url;
  late final TextEditingController _anonKey;

  /// What the fields held when they were last loaded, saved or reset — the
  /// yardstick for "unsaved changes", so typing a value and typing it back
  /// stops counting as an edit.
  late SupabaseConfig _synced;

  /// Whether this device stores values of its own. Null until the store has
  /// answered, during which the reset button stays available rather than
  /// guessing it away.
  bool? _hasOverride;

  /// Set once a save or reset has changed what the NEXT launch will use to
  /// something other than what this process started with.
  bool _restartNeeded = false;

  bool _busy = false;

  SupabaseConfig get _shipped => ref.read(shippedSupabaseConfigProvider);

  SupabaseConfigStore get _store => SupabaseConfigStore(shipped: _shipped);

  SupabaseConfig get _typed =>
      SupabaseConfig(url: _url.text, anonKey: _anonKey.text).trimmed;

  @override
  void initState() {
    super.initState();
    _synced = ref.read(supabaseBootProvider).config.trimmed;
    _url = TextEditingController(text: _synced.url);
    _anonKey = TextEditingController(text: _synced.anonKey);
    _url.addListener(_onEdited);
    _anonKey.addListener(_onEdited);
    unawaited(_loadOverrideState());
  }

  void _onEdited() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _url.dispose();
    _anonKey.dispose();
    super.dispose();
  }

  Future<void> _loadOverrideState() async {
    final has = await _store.hasOverride();
    if (mounted) setState(() => _hasOverride = has);
  }

  /// After a save or reset: did the stored state move the next launch away
  /// from what is running now? A restart is asked for only when it did.
  Future<void> _settle(SupabaseConfig fieldsNow) async {
    final store = _store;
    final next = await store.read();
    final has = await store.hasOverride();
    if (!mounted) return;
    final running = ref.read(supabaseBootProvider).config.trimmed;
    setState(() {
      _synced = fieldsNow;
      _hasOverride = has;
      _restartNeeded = next.trimmed != running;
    });
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context);
    final typed = _typed;
    setState(() => _busy = true);
    try {
      await _store.write(typed);
      await _settle(typed);
      if (!mounted) return;
      if (_restartNeeded) {
        AppToast.warning(
          context,
          l10n.settingsServerSavedRestart,
          duration: const Duration(seconds: 6),
        );
      }
    } catch (error) {
      if (mounted) {
        AppToast.error(context, l10n.settingsServerActionFailed('$error'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reset() async {
    final l10n = AppLocalizations.of(context);
    final shipped = _shipped;
    setState(() => _busy = true);
    try {
      await _store.clear();
      _url.text = shipped.url;
      _anonKey.text = shipped.anonKey;
      await _settle(shipped.trimmed);
      if (!mounted) return;
      if (_restartNeeded) {
        AppToast.warning(
          context,
          l10n.settingsServerSavedRestart,
          duration: const Duration(seconds: 6),
        );
      } else {
        AppToast.success(
          context,
          shipped.isConfigured
              ? l10n.settingsServerResetDone
              : l10n.settingsServerCleared,
        );
      }
    } catch (error) {
      if (mounted) {
        AppToast.error(context, l10n.settingsServerActionFailed('$error'));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final shipped = ref.watch(shippedSupabaseConfigProvider);

    final dirty = _typed != _synced;
    // Nothing saved here and the fields untouched from what shipped: there is
    // nothing for Reset to do, so it says so by being unavailable rather than
    // by announcing a restart for a change that did not happen.
    final atDefaults = _hasOverride == false && _typed == shipped.trimmed;

    final status = _restartNeeded
        ? (l10n.settingsServerStatusRestart, theme.colorScheme.error)
        : dirty
            ? (l10n.settingsServerStatusUnsaved, null)
            : _hasOverride ?? false
                ? (l10n.settingsServerStatusCustom, null)
                : shipped.isConfigured
                    ? (l10n.settingsServerStatusDefaults, null)
                    : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Server addresses and keys are Latin-script regardless of app locale.
        Directionality(
          textDirection: TextDirection.ltr,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _url,
                decoration: InputDecoration(
                  labelText: l10n.settingsServerUrlLabel,
                  hintText: 'https://yourproject.supabase.co',
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _anonKey,
                maxLines: 2,
                minLines: 1,
                style: theme.textTheme.bodySmall,
                decoration: InputDecoration(
                  labelText: l10n.settingsServerAnonKeyLabel,
                  helperText: l10n.settingsServerAnonKeyHelp,
                  helperMaxLines: 3,
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _ShippedDefaults(shipped: shipped),
        if (status != null) ...[
          const SizedBox(height: 8),
          Text(
            status.$1,
            key: const Key('server-status'),
            style: theme.textTheme.bodySmall?.copyWith(
              color: status.$2 ?? theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            TextButton(
              key: const Key('server-reset'),
              onPressed: _busy || atDefaults ? null : _reset,
              // A build that shipped nothing has no defaults to restore, and a
              // button that says it does would be a small lie.
              child: Text(
                shipped.isConfigured
                    ? l10n.settingsServerResetDefaults
                    : l10n.settingsServerClearSaved,
              ),
            ),
            const Spacer(),
            FilledButton(
              key: const Key('server-save'),
              onPressed: _busy || !dirty ? null : _save,
              child: Text(l10n.commonSave),
            ),
          ],
        ),
      ],
    );
  }
}

/// What "defaults" means for this build: the address it shipped with and the
/// key, masked. Or, for a build that shipped neither, a sentence saying so.
class _ShippedDefaults extends StatelessWidget {
  const _ShippedDefaults({required this.shipped});

  final SupabaseConfig shipped;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;

    return Container(
      key: const Key('server-shipped'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            spacing: 8,
            children: [
              Icon(Icons.inventory_2_outlined, size: 16, color: muted),
              Expanded(
                child: Text(
                  l10n.settingsServerShippedTitle,
                  style: theme.textTheme.labelLarge,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (!shipped.isConfigured)
            Text(
              l10n.settingsServerShippedNone,
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            )
          else
            Directionality(
              textDirection: TextDirection.ltr,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: 4,
                children: [
                  _ShippedValue(
                    label: l10n.settingsServerUrlLabel,
                    value: shipped.url.trim(),
                  ),
                  _ShippedValue(
                    label: l10n.settingsServerAnonKeyLabel,
                    value: shipped.maskedAnonKey,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ShippedValue extends StatelessWidget {
  const _ShippedValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: '$label  ',
            style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
          ),
          TextSpan(text: value),
        ],
      ),
      style: theme.textTheme.bodySmall,
    );
  }
}
