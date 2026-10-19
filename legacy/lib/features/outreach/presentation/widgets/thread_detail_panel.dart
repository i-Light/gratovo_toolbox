import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/start_deal_dialog.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_layout_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/access_level_notice.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/confirm_delete_dialog.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/follow_ups_card.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/log_reply_dialog.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/method_aware_composer.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/recent_uploads_reference.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// One outreach conversation: what is open on this channel, and the composer
/// for the next message. Which thread is open comes from the route
/// (`/outreach/thread/:id`), not a provider — see thread_list_panel.dart.
///
/// The messages already sent are not here. They render under the selected row
/// in the thread list ([ThreadMessageHistory]), so the history and the reply
/// sit side by side instead of stacked, and this panel is about the one
/// message that has not been sent yet.
class ThreadDetailPanel extends ConsumerStatefulWidget {
  const ThreadDetailPanel({
    super.key,
    required this.threadId,
    this.onBack,
    this.showProfileToggle = false,
    this.focusCompose = false,
  });

  final String threadId;

  /// Set on narrow layouts so this panel can show a back button.
  final VoidCallback? onBack;

  /// Set on the widest layout, where a "show/hide profile" toggle in the
  /// header flips the docked profile pane.
  final bool showProfileToggle;

  /// Deep-linked from "Contact" — scroll the composer into view on first
  /// build.
  final bool focusCompose;

  @override
  ConsumerState<ThreadDetailPanel> createState() => _ThreadDetailPanelState();
}

class _ThreadDetailPanelState extends ConsumerState<ThreadDetailPanel> {
  final _scrollController = ScrollController();
  final _composerKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    if (widget.focusCompose) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _revealComposer());
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _revealComposer() {
    final target = _composerKey.currentContext;
    if (target != null) {
      Scrollable.ensureVisible(
        target,
        duration: const Duration(milliseconds: 250),
        alignment: 0.1,
      );
    }
  }

  Future<void> _markReplied(
      OutreachThread thread, Influencer? influencer) async {
    final l10n = AppLocalizations.of(context);
    await ref
        .read(outreachRepositoryProvider)
        .updateThreadStatus(thread.id, ThreadStatus.replied);
    if (influencer != null) {
      await ref
          .read(followUpSchedulerProvider)
          .clearAllForInfluencer(influencer.id);
    }
    ref
      ..invalidate(allOutreachThreadsProvider)
      ..invalidate(threadByIdProvider(thread.id));
    if (mounted) {
      AppToast.success(context, l10n.outreachThreadMarkedReplied);
    }
  }

  /// Removes the conversation and everything in it, after asking.
  ///
  /// Asking is not ceremony here. The thread id is the conversation key the
  /// mailbox matches incoming replies against, so deleting a thread also means
  /// a later reply to that email arrives with nothing to attach itself to —
  /// which is the intended outcome for a conversation that should not exist,
  /// and a bad surprise for one that should.
  Future<void> _deleteThread(OutreachThread thread) async {
    final l10n = AppLocalizations.of(context);
    final router = GoRouter.of(context);

    final confirmed = await confirmDelete(
      context,
      title: l10n.outreachDeleteThread,
      body: l10n.outreachDeleteThreadConfirm,
    );
    if (!confirmed) return;

    await ref.read(outreachRepositoryProvider).deleteThread(thread.id);
    // `allOutreachThreadsProvider` re-reads on invalidation rather than off a
    // revision counter, so the list needs telling directly; the bump is for
    // everything else that counts messages on a channel.
    ref
      ..invalidate(allOutreachThreadsProvider)
      ..invalidate(threadByIdProvider(thread.id))
      ..bumpData(const {
        DataDomain.outreach,
        DataDomain.channels,
        DataDomain.activity,
      });

    if (mounted) {
      AppToast.success(context, l10n.outreachThreadDeleted);
    }
    // Back to the list: the route still names a thread that no longer exists,
    // and leaving it there renders "select a conversation" at a URL that reads
    // like something is still open.
    router.go(AppRoutes.outreach);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final threadAsync = ref.watch(threadByIdProvider(widget.threadId));

    return threadAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stackTrace) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.commonError),
            TextButton(
              onPressed: () =>
                  ref.invalidate(threadByIdProvider(widget.threadId)),
              child: Text(l10n.commonRetry),
            ),
          ],
        ),
      ),
      data: (thread) {
        if (thread == null) {
          return Center(child: Text(l10n.outreachSelectThreadHint));
        }
        final seesNames = ref.watch(accessLevelProvider).seesSensitiveData;
        final influencerAsync = seesNames
            ? ref.watch(influencerByIdProvider(thread.influencerId))
            : null;
        final influencer = influencerAsync?.asData?.value;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _HeaderBar(
              thread: thread,
              influencer: influencer,
              seesNames: seesNames,
              onBack: widget.onBack,
              showProfileToggle: widget.showProfileToggle,
              onMarkReplied: () => _markReplied(thread, influencer),
              onLogReply: influencer == null
                  ? null
                  : () => showDialog<void>(
                        context: context,
                        builder: (_) => LogReplyDialog(
                          thread: thread,
                          influencer: influencer,
                        ),
                      ),
              onDelete: seesNames ? () => _deleteThread(thread) : null,
            ),
            const Divider(height: 1),
            Expanded(
              child: SingleChildScrollView(
                controller: _scrollController,
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // A basic account can compose nothing here — there is no
                    // address to compose to — so say why the panel is bare
                    // rather than leaving it looking broken. What was said on
                    // this thread is still readable, redacted, under the row
                    // in the list.
                    if (!seesNames || influencer == null)
                      Text(
                        l10n.emailsRedactedNote,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    if (seesNames && influencer != null) ...[
                      FollowUpsCard(
                        influencer: influencer,
                        threadId: thread.id,
                      ),
                      const SizedBox(height: 16),
                      RecentUploadsReference(influencerId: influencer.id),
                      const SizedBox(height: 16),
                      KeyedSubtree(
                        key: _composerKey,
                        child: MethodAwareComposer(
                          threadId: thread.id,
                          thread: thread,
                          influencer: influencer,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            // Docked, not scrolled: the send row belongs to the thread rather
            // than to the bottom of the composer card, so a long draft cannot
            // push it out of reach.
            if (seesNames && influencer != null)
              ComposerActionBar(
                threadId: thread.id,
                thread: thread,
                influencer: influencer,
              ),
          ],
        );
      },
    );
  }
}

/// Who this conversation is with, what state it is in, and everything that can
/// be done to it — one row.
///
/// It used to be two: a title row, and under it a wrapping strip of four
/// labelled buttons ("Log a reply", "Mark as replied", "Schedule follow-up",
/// "Delete conversation"). That strip cost a line and a half of the panel on
/// every thread and, being a Wrap, cost two or three at narrow widths — space
/// taken permanently from the messages and the composer, which are what the
/// panel is for. The actions are icons with tooltips now, in the space the
/// title row was already using.
///
/// Order is deliberate and matches how a thread actually moves: something came
/// in (log a reply), it counts as answered (mark replied), and — last, in the
/// error color — the one action nothing else here can undo. Scheduling a
/// follow-up is in the Follow-ups card under this row, beside the reminders
/// it creates.
class _HeaderBar extends StatelessWidget {
  const _HeaderBar({
    required this.thread,
    required this.influencer,
    required this.seesNames,
    required this.onMarkReplied,
    required this.onLogReply,
    required this.onDelete,
    required this.showProfileToggle,
    this.onBack,
  });

  final OutreachThread thread;
  final Influencer? influencer;
  final bool seesNames;
  final VoidCallback onMarkReplied;
  final VoidCallback? onLogReply;
  final VoidCallback? onDelete;
  final bool showProfileToggle;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final unavailableHint = seesNames ? null : l10n.emailsActionUnavailable;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 8, 6),
      child: Row(
        children: [
          if (onBack != null)
            IconButton(
              icon: const Icon(Icons.arrow_back),
              tooltip: l10n.outreachBackToList,
              onPressed: onBack,
            ),
          Expanded(
            child: RedactableText(
              influencer?.handle ??
                  (seesNames ? thread.influencerId : kRedactionMarker),
              style: Theme.of(context).textTheme.titleMedium,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          StatusBadge(
            label: thread.status.label(l10n),
            color: thread.status.color(context),
          ),
          const SizedBox(width: 4),
          _HeaderAction(
            icon: Icons.south_west,
            label: l10n.outreachLogReply,
            onPressed: onLogReply,
            unavailableHint: unavailableHint,
          ),
          if (thread.status != ThreadStatus.replied)
            _HeaderAction(
              icon: Icons.mark_email_read_outlined,
              label: l10n.outreachMarkReplied,
              onPressed: seesNames ? onMarkReplied : null,
              unavailableHint: unavailableHint,
            ),
          // The creator said yes: start the deal from the conversation.
          _HeaderAction(
            icon: Icons.handshake_outlined,
            label: l10n.dealStart,
            onPressed: influencer == null || !seesNames
                ? null
                : () => showStartDealDialog(context, creator: influencer!),
            unavailableHint: unavailableHint,
          ),
          _HeaderAction(
            icon: Icons.delete_outline,
            label: l10n.outreachDeleteThread,
            onPressed: onDelete,
            destructive: true,
            unavailableHint: unavailableHint,
          ),
          if (showProfileToggle) ...[
            const SizedBox(width: 4),
            const _ProfileToggleButton(),
          ],
        ],
      ),
    );
  }
}

class _ProfileToggleButton extends ConsumerWidget {
  const _ProfileToggleButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final visible = ref.watch(outreachProfilePaneVisibleProvider);
    return IconButton(
      isSelected: visible,
      visualDensity: VisualDensity.compact,
      tooltip: visible ? l10n.outreachHideProfile : l10n.outreachShowProfile,
      icon: Icon(
        visible ? Icons.chrome_reader_mode : Icons.chrome_reader_mode_outlined,
      ),
      onPressed: () =>
          ref.read(outreachProfilePaneVisibleProvider.notifier).toggle(),
    );
  }
}

/// One header action: an icon, its name as a tooltip, and — when it is
/// unavailable rather than merely idle — the reason why in place of the name.
///
/// A disabled [IconButton] swallows pointer events, tooltip included, so the
/// unavailable case is wrapped from outside. Without that, a basic account
/// gets a row of greyed-out glyphs and no way to find out what any of them
/// are, which is the failure mode icon-only rows are famous for.
class _HeaderAction extends StatelessWidget {
  const _HeaderAction({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.destructive = false,
    this.unavailableHint,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool destructive;
  final String? unavailableHint;

  @override
  Widget build(BuildContext context) {
    final disabledAndExplained = onPressed == null && unavailableHint != null;
    final button = IconButton(
      onPressed: onPressed,
      visualDensity: VisualDensity.compact,
      tooltip: disabledAndExplained ? null : label,
      color: destructive ? Theme.of(context).colorScheme.error : null,
      icon: Icon(icon),
    );
    if (disabledAndExplained) {
      return Tooltip(message: '$label — ${unavailableHint!}', child: button);
    }
    return button;
  }
}
