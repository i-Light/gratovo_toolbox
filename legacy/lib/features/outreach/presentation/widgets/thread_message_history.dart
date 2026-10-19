import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/status/contact_method_presentation.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/access_level_notice.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/confirm_delete_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What has been said in one conversation, rendered underneath that
/// conversation's row in the thread list.
///
/// It used to live at the top of the detail panel, above the composer. That
/// put the history and the reply in one column and made them compete: a
/// thread with three sent emails in it opened on a screenful of things
/// already said, with the box for the next one somewhere below the fold.
/// Under the list row, the history sits beside the composer instead of on top
/// of it — the channel you selected, and everything you have already sent it,
/// in the column that is about picking a conversation.
///
/// Each body shows two lines. That is enough to tell which message a row is,
/// which is the question the list answers; the whole of one is a tap away.
class ThreadMessageHistory extends ConsumerWidget {
  const ThreadMessageHistory({super.key, required this.threadId});

  final String threadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final messagesAsync = ref.watch(messagesByThreadProvider(threadId));
    final fmt = ref.watch(instantFormatterProvider);
    final seesNames = ref.watch(accessLevelProvider).seesSensitiveData;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 12, 12),
      child: messagesAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (messages) {
          if (messages.isEmpty) {
            return Text(
              l10n.outreachNoMessages,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!seesNames) ...[
                Text(
                  l10n.emailsRedactedNote,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: 16),
              ],
              const SizedBox(height: 12),
              for (final message in messages)
                _MessageTile(
                  message: message,
                  formattedDate: fmt.dateTime(message.at),
                  onDelete: seesNames
                      ? () => _deleteMessage(context, ref, message)
                      : null,
                  // Classifying is only meaningful on a reply that came in —
                  // see [MessageClassification] — and, like deleting, is not
                  // offered to a reader who cannot see who it is from.
                  onClassify:
                      seesNames && message.direction == MessageDirection.inbound
                          ? (classification) =>
                              _classifyMessage(ref, message, classification)
                          : null,
                ),
            ],
          );
        },
      ),
    );
  }
}

/// Removes one recorded message, after asking.
///
/// Worth being blunt about what this does and does not do: an outbound message
/// that really left cannot be unsent, and deleting the record only stops the
/// CRM claiming it is still out there. It is for a reply logged against the
/// wrong thread, or a draft marked sent twice.
Future<void> _deleteMessage(
  BuildContext context,
  WidgetRef ref,
  OutreachMessage message,
) async {
  final l10n = AppLocalizations.of(context);

  final confirmed = await confirmDelete(
    context,
    title: l10n.outreachDeleteMessage,
    body: l10n.outreachDeleteMessageConfirm,
  );
  if (!confirmed) return;

  await ref.read(outreachRepositoryProvider).deleteMessage(message.id);
  ref.bumpData(const {
    DataDomain.outreach,
    DataDomain.channels,
    DataDomain.activity,
  });
  if (!context.mounted) return;
  AppToast.success(context, l10n.outreachMessageDeleted);
}

/// Tags (or clears the tag on) one inbound message with what it actually
/// said. No confirmation — unlike deleting, this is reversible from the same
/// menu, so asking first would only slow down triaging a stack of replies.
Future<void> _classifyMessage(
  WidgetRef ref,
  OutreachMessage message,
  MessageClassification? classification,
) async {
  await ref
      .read(outreachRepositoryProvider)
      .updateMessageClassification(message.id, classification);
  ref.bumpData(const {DataDomain.outreach});
}

/// One recorded message, shown two lines deep until asked otherwise.
class _MessageTile extends StatefulWidget {
  const _MessageTile({
    required this.message,
    required this.formattedDate,
    required this.onDelete,
    required this.onClassify,
  });

  final OutreachMessage message;
  final String formattedDate;
  final VoidCallback? onDelete;

  /// Tags (or clears) this message's [MessageClassification]. Null when the
  /// message is outbound, or the reader cannot mutate it — see the call site
  /// in [ThreadMessageHistory.build].
  final ValueChanged<MessageClassification?>? onClassify;

  @override
  State<_MessageTile> createState() => _MessageTileState();
}

class _MessageTileState extends State<_MessageTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final onDelete = widget.onDelete;
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final outbound = message.direction == MessageDirection.outbound;
    final peer = message.peerAddress;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: outbound
            ? colorScheme.primary.withValues(alpha: 0.08)
            : colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                outbound ? Icons.call_made : Icons.call_received,
                size: 14,
                color: outbound
                    ? colorScheme.primary
                    : colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 4),
              Icon(
                contactMethodIcon(message.method),
                size: 13,
                color: colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: RedactableText(
                  message.subject.trim().isEmpty ? '—' : message.subject,
                  style: theme.textTheme.labelMedium,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (message.isAiDrafted)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Icon(
                    Icons.auto_awesome,
                    size: 13,
                    color: colorScheme.secondary,
                  ),
                ),
              if (message.classification != null)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: StatusBadge(
                    label: message.classification!.label(
                      AppLocalizations.of(context),
                    ),
                    color: message.classification!.color(context),
                  ),
                ),
              Text(
                widget.formattedDate,
                style: theme.textTheme.bodySmall,
              ),
              if (widget.onClassify != null)
                _ClassifyButton(
                  current: message.classification,
                  onSelect: widget.onClassify!,
                ),
              if (onDelete != null)
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.only(left: 4),
                  constraints: const BoxConstraints(),
                  iconSize: 15,
                  tooltip: AppLocalizations.of(context).outreachDeleteMessage,
                  icon: const Icon(Icons.delete_outline),
                  color: colorScheme.onSurfaceVariant,
                  onPressed: onDelete,
                ),
            ],
          ),
          if (peer != null && peer.isNotEmpty) ...[
            const SizedBox(height: 2),
            Padding(
              padding: const EdgeInsets.only(left: 24),
              child: RedactableText(
                peer,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
          const SizedBox(height: 4),
          // Whole-body tap rather than a "show more" link: the body is the
          // only thing in here that can be hidden, and a two-line block of
          // clipped text is its own affordance.
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Tooltip(
              message: _expanded
                  ? AppLocalizations.of(context).commonCollapse
                  : AppLocalizations.of(context).commonExpand,
              child: RedactableText(
                message.body,
                style: theme.textTheme.bodySmall,
                maxLines: _expanded ? null : 2,
                overflow: _expanded ? null : TextOverflow.ellipsis,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The small "tag this reply" menu: every [MessageClassification], plus a
/// "clear" entry once one is already set. Modelled on
/// [_OutreachViewSwitcher] in outreach_screen.dart — same builder/menuChildren
/// shape, just triggered from an icon rather than the page title.
class _ClassifyButton extends StatelessWidget {
  const _ClassifyButton({required this.current, required this.onSelect});

  final MessageClassification? current;
  final ValueChanged<MessageClassification?> onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colorScheme = Theme.of(context).colorScheme;

    return MenuAnchor(
      builder: (context, controller, _) => IconButton(
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.only(left: 4),
        constraints: const BoxConstraints(),
        iconSize: 15,
        tooltip: l10n.outreachClassifyMessage,
        icon: const Icon(Icons.label_outline),
        color: colorScheme.onSurfaceVariant,
        onPressed: () =>
            controller.isOpen ? controller.close() : controller.open(),
      ),
      menuChildren: [
        for (final option in MessageClassification.values)
          MenuItemButton(
            trailingIcon:
                option == current ? const Icon(Icons.check, size: 16) : null,
            onPressed: () => onSelect(option),
            child: Text(option.label(l10n)),
          ),
        if (current != null)
          MenuItemButton(
            onPressed: () => onSelect(null),
            child: Text(l10n.outreachClassificationClear),
          ),
      ],
    );
  }
}
