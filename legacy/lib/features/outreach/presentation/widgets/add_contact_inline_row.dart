import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/contact_method_presentation.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Adds a contact to the channel from inside the composer, then continues
/// composing to it — the "there is nobody to send this to yet" escape hatch.
///
/// Writes straight to `channels.contacts` (same path as the profile Contacts
/// card) so the address is there next time, and hands the new contact to the
/// compose controller so the method picker and To field fill in without a
/// round trip.
class AddContactInlineRow extends ConsumerStatefulWidget {
  const AddContactInlineRow({
    super.key,
    required this.influencer,
    required this.threadId,
    this.initialMethod,
  });

  final Influencer influencer;
  final String threadId;

  /// Preselects the method — set when the user chose a method that has no
  /// matching contact yet.
  final ContactMethod? initialMethod;

  @override
  ConsumerState<AddContactInlineRow> createState() =>
      _AddContactInlineRowState();
}

class _AddContactInlineRowState extends ConsumerState<AddContactInlineRow> {
  final _valueController = TextEditingController();
  final _labelController = TextEditingController();
  late ContactMethod _method = widget.initialMethod ?? ContactMethod.email;
  bool _saving = false;

  @override
  void dispose() {
    _valueController.dispose();
    _labelController.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final value = _valueController.text.trim();
    if (value.isEmpty || _saving) return;
    final label = _labelController.text.trim();
    final influencer = widget.influencer;
    final before = influencer.contacts;
    final contact = InfluencerContact(
      method: _method,
      value: value,
      label: label.isEmpty ? null : label,
      isPrimary: before.isEmpty,
    );
    final next = InfluencerContact.normalize([...before, contact]);

    setState(() => _saving = true);
    try {
      final result = await guardInfluencerMutation(
        context,
        ref,
        influencer,
        action: () => ref
            .read(influencerRepositoryProvider)
            .updateContacts(influencer.id, next, base: before),
        log: (logger) => logger.channelContactsChanged(influencer,
            before: before, after: next),
      );
      // Only adopt it into the composer if it was actually stored. Filling the
      // To field from a contact the database refused would leave someone
      // composing to an address that vanishes on the next reload.
      if (result.succeeded) {
        ref
            .read(composeControllerProvider(widget.threadId).notifier)
            .adoptContact(contact);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        DropdownButton<ContactMethod>(
          value: _method,
          underline: const SizedBox.shrink(),
          onChanged: _saving
              ? null
              : (value) {
                  if (value != null) setState(() => _method = value);
                },
          items: [
            for (final method in ContactMethod.values)
              DropdownMenuItem(
                value: method,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(contactMethodIcon(method), size: 16),
                    const SizedBox(width: 8),
                    Text(contactMethodLabel(method, l10n)),
                  ],
                ),
              ),
          ],
        ),
        SizedBox(
          width: 240,
          child: TextField(
            controller: _valueController,
            enabled: !_saving,
            decoration: InputDecoration(
              hintText: l10n.outreachAddContactValueHint,
              isDense: true,
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _add(),
          ),
        ),
        SizedBox(
          width: 150,
          child: TextField(
            controller: _labelController,
            enabled: !_saving,
            decoration: InputDecoration(
              hintText: l10n.influencerProfileContactLabelHint,
              isDense: true,
              border: const OutlineInputBorder(),
            ),
            onSubmitted: (_) => _add(),
          ),
        ),
        FilledButton.icon(
          onPressed: _saving ? null : _add,
          icon: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.add),
          label: Text(l10n.outreachAddContactAdd),
        ),
      ],
    );
  }
}
