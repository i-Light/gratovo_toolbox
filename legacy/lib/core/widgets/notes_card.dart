import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The free-text notes card on a profile page (influencer, brand, deal): a
/// title, a four-line field seeded with what is stored, and a Save button.
///
/// Saving is the caller's: each record type has its own repository, its own
/// data domain to bump and, for influencers, an activity-log entry and a
/// conflict guard. [onSave] gets the text and does whatever that is. Whether
/// the field keeps the typed text after a failed save is also the caller's
/// call — nothing here resets it.
class NotesCard extends StatefulWidget {
  const NotesCard({
    super.key,
    required this.initialText,
    required this.hintText,
    required this.onSave,
  });

  final String? initialText;
  final String hintText;
  final Future<void> Function(String text) onSave;

  @override
  State<NotesCard> createState() => _NotesCardState();
}

class _NotesCardState extends State<NotesCard> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialText ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.influencerProfileNotesTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _controller,
              maxLines: 4,
              decoration: InputDecoration(
                hintText: widget.hintText,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: () => widget.onSave(_controller.text),
                child: Text(l10n.influencerProfileSaveNotes),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
