import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/countries.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_page_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Adds a channel by hand.
///
/// Everything but the handle is optional, and a blank field stays blank rather
/// than becoming a zero. That matters more here than in most forms: this row
/// sits in the same table as pipeline-discovered channels, and a manually
/// entered `0` subscribers is indistinguishable from a measured one — it would
/// sort and range-filter as a real reading of a channel nobody watches.
class AddInfluencerDialog extends ConsumerStatefulWidget {
  const AddInfluencerDialog({super.key});

  static Future<bool?> show(BuildContext context) {
    return showDialog<bool>(
      context: context,
      builder: (context) => const AddInfluencerDialog(),
    );
  }

  @override
  ConsumerState<AddInfluencerDialog> createState() =>
      _AddInfluencerDialogState();
}

class _AddInfluencerDialogState extends ConsumerState<AddInfluencerDialog> {
  final _formKey = GlobalKey<FormState>();
  final _handle = TextEditingController();
  final _channelId = TextEditingController();
  final _name = TextEditingController();
  final _url = TextEditingController();
  final _subscribers = TextEditingController();
  final _notes = TextEditingController();
  String? _country;
  bool _saving = false;

  @override
  void dispose() {
    for (final controller in [
      _handle,
      _channelId,
      _name,
      _url,
      _subscribers,
      _notes,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _submit(AppLocalizations l10n) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);

    try {
      final subscribers = _subscribers.text.trim();
      final createdId = await ref.read(influencerRepositoryProvider).create(
            NewInfluencer(
              handle: _handle.text,
              channelId: _channelId.text.trimmedOrNull,
              name: _name.text.trimmedOrNull,
              channelUrl: _url.text.trimmedOrNull,
              country: _country,
              subscriberCount:
                  subscribers.isEmpty ? null : int.tryParse(subscribers),
              notes: _notes.text.trimmedOrNull,
            ),
          );

      // The id comes back from create(), so the entry points at the row that
      // was actually written — which, for a manual entry with no YouTube id,
      // is a synthetic one nobody could have guessed from the handle.
      ref.read(activityLoggerProvider).channelCreated(
            id: createdId,
            handle: '@${_handle.text.trim().replaceFirst('@', '')}',
          );

      // Reload the page the list is showing directly, so the new channel is
      // already there when this dialog closes rather than a moment later.
      // Everything else that reads channels — the dashboard tiles, the
      // analytics charts, the country vocabulary the filter dropdown is built
      // from — follows from the announcement.
      await ref
          .read(influencerPageProvider(ref.read(influencerFilterProvider))
              .notifier)
          .refresh();
      ref.bumpData(const {DataDomain.channels});

      if (mounted) {
        Navigator.of(context).pop(true);
        AppToast.success(context, l10n.influencerAddSucceeded);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.error(context, l10n.influencerAddFailed);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return AlertDialog(
      title: Text(l10n.influencerAddTitle),
      content: SizedBox(
        width: 420,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.influencerAddIntro,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _handle,
                  autofocus: true,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddHandle,
                    hintText: l10n.influencerAddHandleHint,
                    border: const OutlineInputBorder(),
                  ),
                  validator: (value) => (value == null ||
                          value.trim().replaceAll('@', '').isEmpty)
                      ? l10n.influencerAddHandleRequired
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _channelId,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddChannelId,
                    helperText: l10n.influencerAddChannelIdHelp,
                    helperMaxLines: 3,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _name,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddName,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _url,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddUrl,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _subscribers,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddSubscribers,
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String?>(
                  initialValue: _country,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddCountry,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    DropdownMenuItem(
                      value: null,
                      child: Text(l10n.influencerFilterAny),
                    ),
                    // The full list here, unlike the filter sheet's: adding a
                    // channel is exactly when a country not yet in the data
                    // gets introduced, so offering only what already exists
                    // would make the first channel from a new market
                    // unenterable.
                    for (final country in kAllCountries)
                      DropdownMenuItem(
                        value: country.code,
                        child: Text('${country.name} (${country.code})'),
                      ),
                  ],
                  onChanged: (value) => setState(() => _country = value),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _notes,
                  maxLines: 3,
                  decoration: InputDecoration(
                    labelText: l10n.influencerAddNotes,
                    border: const OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: _saving ? null : () => _submit(l10n),
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.influencerAddSubmit),
        ),
      ],
    );
  }
}
