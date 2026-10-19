import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/contact_method_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/date_time_picker.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Records a reply that came in outside the app — there is no inbox
/// integration, so a reply is logged by hand. Writes an inbound message and
/// flips the thread to `replied`, which also clears any open follow-up nudges
/// for this channel.
class LogReplyDialog extends ConsumerStatefulWidget {
  const LogReplyDialog({
    super.key,
    required this.thread,
    required this.influencer,
  });

  final OutreachThread thread;
  final Influencer influencer;

  @override
  ConsumerState<LogReplyDialog> createState() => _LogReplyDialogState();
}

class _LogReplyDialogState extends ConsumerState<LogReplyDialog> {
  final _bodyController = TextEditingController();
  late ContactMethod _method;
  late DateTime _receivedLocal;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _method = ref.read(composeControllerProvider(widget.thread.id)).method;
    _receivedLocal = DateTime.now();
  }

  @override
  void dispose() {
    _bodyController.dispose();
    super.dispose();
  }

  Future<void> _pickReceived() async {
    final picked = await pickDateTime(context, initial: _receivedLocal);
    if (picked != null) setState(() => _receivedLocal = picked);
  }

  Future<void> _save() async {
    if (_saving || _bodyController.text.trim().isEmpty) return;
    final l10n = AppLocalizations.of(context);
    final navigator = Navigator.of(context);

    setState(() => _saving = true);
    await ref
        .read(composeControllerProvider(widget.thread.id).notifier)
        .logReply(
          thread: widget.thread,
          influencer: widget.influencer,
          body: _bodyController.text.trim(),
          method: _method,
          at: _receivedLocal.toUtc(),
        );

    navigator.pop();
    if (!mounted) return;
    AppToast.success(context, l10n.outreachReplyLogged);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fmt = ref.watch(instantFormatterProvider);

    return AlertDialog(
      title: Text(l10n.outreachLogReplyTitle),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _bodyController,
              maxLines: 6,
              minLines: 3,
              decoration: InputDecoration(
                labelText: l10n.outreachLogReplyBodyLabel,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Text(
                  l10n.outreachLogReplyMethodLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(width: 12),
                DropdownButton<ContactMethod>(
                  value: _method,
                  onChanged: (value) {
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
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  l10n.outreachLogReplyReceivedLabel,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    fmt.dateTime(_receivedLocal.toUtc()),
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                TextButton.icon(
                  onPressed: _pickReceived,
                  icon: const Icon(Icons.event_outlined),
                  label: Text(l10n.outreachFollowUpPickDateTime),
                ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: Text(l10n.commonSave),
        ),
      ],
    );
  }
}
