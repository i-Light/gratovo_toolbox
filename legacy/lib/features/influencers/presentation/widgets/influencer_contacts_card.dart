import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/contact_method_presentation.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/contact_discovery.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every way this channel can actually be reached, and the editor for adding
/// more.
///
/// A list rather than one email field, because a creator routinely has several
/// and no single "the" address: a business email from the About tab, a
/// manager's address that answers faster, a WhatsApp number from a first call.
/// A single field would force whoever finds the second one to overwrite the
/// first, which is how the useful one gets lost.
///
/// Distinct from [InfluencerEmailsCard] below it, which shows the emails that
/// have been EXCHANGED. This is where to write; that is what was written.
class InfluencerContactsCard extends ConsumerStatefulWidget {
  const InfluencerContactsCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  ConsumerState<InfluencerContactsCard> createState() =>
      _InfluencerContactsCardState();
}

class _InfluencerContactsCardState
    extends ConsumerState<InfluencerContactsCard> {
  final _valueController = TextEditingController();
  final _labelController = TextEditingController();
  ContactMethod _method = ContactMethod.email;
  bool _saving = false;

  /// Null until "Scan for contacts" is pressed; an empty list is a genuine
  /// "scanned, found nothing" rather than "never scanned" — the two read
  /// differently below.
  List<ContactCandidate>? _candidates;

  @override
  void initState() {
    super.initState();
    // Emails the pipeline already found (fix #11) are shown straight away, one
    // click from being a contact; the About-text scan still waits for its
    // button.
    if (widget.influencer.foundEmails.isNotEmpty) {
      final found = {
        for (final email in widget.influencer.foundEmails) email.toLowerCase(),
      };
      final candidates = [
        for (final candidate in findContactCandidates(widget.influencer))
          if (found.contains(candidate.value.trim().toLowerCase())) candidate,
      ];
      if (candidates.isNotEmpty) _candidates = candidates;
    }
  }

  @override
  void dispose() {
    _valueController.dispose();
    _labelController.dispose();
    super.dispose();
  }

  /// One write path for every mutation, so the log entry and the invalidation
  /// cannot be forgotten by whichever button happens to be added next.
  ///
  /// This used to be `try`/`finally` with no `catch`: the spinner stopped and
  /// the exception went unhandled, so a refused save was signalled only by the
  /// *absence* of the success message. The guard reports both outcomes.
  Future<void> _commit(List<InfluencerContact> next) async {
    final influencer = widget.influencer;
    final before = influencer.contacts;
    final normalized = InfluencerContact.normalize(next);

    setState(() => _saving = true);
    try {
      await guardInfluencerMutation(
        context,
        ref,
        influencer,
        action: () => ref
            .read(influencerRepositoryProvider)
            .updateContacts(influencer.id, normalized, base: before),
        log: (logger) => logger.channelContactsChanged(
          influencer,
          before: before,
          after: normalized,
        ),
        successMessage: widget.l10n.influencerProfileContactsSaved,
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _add() async {
    final value = _valueController.text.trim();
    if (value.isEmpty) return;
    final label = _labelController.text.trim();
    final contact = InfluencerContact(
      method: _method,
      value: value,
      label: label.isEmpty ? null : label,
      // The first contact anyone records is the primary by default. Anything
      // else means a channel with exactly one contact has no primary, and
      // every reader then has to work out that the only one is the one.
      isPrimary: widget.influencer.contacts.isEmpty,
    );
    _valueController.clear();
    _labelController.clear();
    await _commit([...widget.influencer.contacts, contact]);
  }

  /// By index, not by value. Two contacts CAN be identical — the same address
  /// recorded twice by two people — and removing "the one that equals this"
  /// would then delete both, which is not what the person who pressed the
  /// button on one row asked for.
  Future<void> _removeAt(int index) {
    final next = [...widget.influencer.contacts]..removeAt(index);
    return _commit(next);
  }

  /// Scans the channel's own scraped text and shows what was found. Read-only
  /// — this never touches `contacts` on its own; see [_addCandidate] for the
  /// only path that does.
  void _scanForContacts() {
    setState(() {
      _candidates = findContactCandidates(widget.influencer);
    });
  }

  /// Accepts one suggestion, through the exact same guarded compare-and-set
  /// path [_add] uses — a scanned candidate is not a shortcut around
  /// `influencer_mutation_guard`, just a prefilled version of the same add.
  Future<void> _addCandidate(ContactCandidate candidate) async {
    final contact = InfluencerContact(
      method: candidate.method,
      value: candidate.value,
      isPrimary: widget.influencer.contacts.isEmpty,
    );
    await _commit([...widget.influencer.contacts, contact]);
    // Drop it from the shown suggestions now that it is saved (or, on a
    // conflict/failure, so the person can re-scan for the current truth
    // rather than stare at a candidate that may already be handled).
    if (mounted) {
      setState(() => _candidates?.remove(candidate));
    }
  }

  Future<void> _makePrimaryAt(int index) {
    final contacts = widget.influencer.contacts;
    return _commit([
      // The chosen one first and marked; normalize clears the rest. Moving it
      // to the front as well as marking it means the order on screen matches
      // the order to try them in.
      contacts[index].copyWith(isPrimary: true),
      for (var i = 0; i < contacts.length; i++)
        if (i != index) contacts[i].copyWith(isPrimary: false),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final theme = Theme.of(context);
    final contacts = widget.influencer.contacts;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.influencerProfileContactsTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                if (!_saving)
                  TextButton.icon(
                    onPressed: _scanForContacts,
                    icon: const Icon(Icons.search, size: 18),
                    label: Text(l10n.contactDiscoveryScanAction),
                  ),
                if (_saving)
                  const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            if (_candidates case final candidates?) ...[
              const SizedBox(height: 4),
              if (candidates.isEmpty)
                Text(
                  l10n.contactDiscoveryNoneFound,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                )
              else ...[
                Text(
                  l10n.contactDiscoverySuggestionsTitle,
                  style: theme.textTheme.labelLarge,
                ),
                for (final candidate in candidates)
                  _CandidateRow(
                    candidate: candidate,
                    l10n: l10n,
                    enabled: !_saving,
                    onAdd: () => _addCandidate(candidate),
                  ),
              ],
            ],
            const SizedBox(height: 12),
            if (contacts.isEmpty)
              Text(
                l10n.influencerProfileNoContacts,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              )
            else
              for (var index = 0; index < contacts.length; index++)
                _ContactRow(
                  contact: contacts[index],
                  l10n: l10n,
                  enabled: !_saving,
                  onRemove: () => _removeAt(index),
                  onMakePrimary: () => _makePrimaryAt(index),
                ),
            const Divider(height: 28),
            // A Wrap, not a Row: the method dropdown, two fields and a button
            // do not fit side by side at phone width, and a Row cannot shrink
            // a TextField below its intrinsic width — it overflows instead.
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                DropdownButton<ContactMethod>(
                  value: _method,
                  underline: const SizedBox.shrink(),
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
                  onChanged: _saving
                      ? null
                      : (value) {
                          if (value != null) setState(() => _method = value);
                        },
                ),
                SizedBox(
                  width: 240,
                  child: TextField(
                    controller: _valueController,
                    enabled: !_saving,
                    decoration: InputDecoration(
                      hintText: l10n.influencerProfileContactValueHint,
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _add(),
                  ),
                ),
                SizedBox(
                  width: 160,
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
                  icon: const Icon(Icons.add),
                  label: Text(l10n.influencerProfileAddContact),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({
    required this.contact,
    required this.l10n,
    required this.enabled,
    required this.onRemove,
    required this.onMakePrimary,
  });

  final InfluencerContact contact;
  final AppLocalizations l10n;
  final bool enabled;
  final VoidCallback onRemove;
  final VoidCallback onMakePrimary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            contactMethodIcon(contact.method),
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Selectable, because half of what anyone does with an address
                // is take part of it — the domain, the country code — and a
                // copy button that only copies the whole thing does not cover
                // that.
                SelectableText(
                  contact.value,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                ),
                Text(
                  [
                    contactMethodLabel(contact.method, l10n),
                    if (contact.label != null) contact.label!,
                  ].join('  ·  '),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          if (contact.isPrimary)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  l10n.influencerProfileContactPrimary,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
              ),
            )
          else
            IconButton(
              tooltip: l10n.influencerProfileContactMakePrimary,
              icon: const Icon(Icons.star_outline, size: 18),
              onPressed: enabled ? onMakePrimary : null,
            ),
          IconButton(
            tooltip: l10n.influencerProfileContactCopy,
            icon: const Icon(Icons.copy, size: 18),
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: contact.value));
              if (context.mounted) {
                AppToast.success(context, l10n.commonCopied);
              }
            },
          ),
          IconButton(
            tooltip: l10n.influencerProfileContactRemove,
            icon: const Icon(Icons.close, size: 18),
            onPressed: enabled ? onRemove : null,
          ),
        ],
      ),
    );
  }
}

/// One suggestion from [findContactCandidates], with the only action it
/// offers: accept it. There is no "dismiss" button because there is nothing
/// to dismiss — a candidate lives only in this widget's own state and is
/// gone the moment the card rebuilds without a fresh scan.
class _CandidateRow extends StatelessWidget {
  const _CandidateRow({
    required this.candidate,
    required this.l10n,
    required this.enabled,
    required this.onAdd,
  });

  final ContactCandidate candidate;
  final AppLocalizations l10n;
  final bool enabled;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            contactMethodIcon(candidate.method),
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  candidate.value,
                  style: theme.textTheme.bodyMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  contactMethodLabel(candidate.method, l10n),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          if (candidate.isBusinessInquiry)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: 4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: theme.colorScheme.secondaryContainer,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  l10n.contactDiscoveryBusinessInquiry,
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
              ),
            ),
          IconButton(
            tooltip: l10n.contactDiscoveryAddSuggestion,
            icon: const Icon(Icons.add_circle_outline, size: 18),
            onPressed: enabled ? onAdd : null,
          ),
        ],
      ),
    );
  }
}
