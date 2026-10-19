import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/email_library_screen.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_inbox_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_layout_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/access_level_notice.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/comms_queue_page.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/outreach_profile_pane.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/setup_dialogs.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/thread_detail_panel.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/thread_list_panel.dart';
import 'package:gratovo_toolbox/features/scratchpad/presentation/scratchpad_screen.dart';
import 'package:gratovo_toolbox/features/skills/presentation/skills_library_view.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// What the Outreach page is showing: the conversation cockpit (the default,
/// every time the page is opened), the Comms queue (everything waiting on us,
/// drafted by the engine on a click), the email critique library, the team
/// scratchpad, or the Skills page — the email critique library and
/// scratchpad were folded in here after each lost its own nav-rail
/// destination; Skills starts here directly, since it is the same kind of
/// occasional, page-level configuration tool for the Gemini skill files in
/// `data/gemini skills/`.
enum _OutreachView {
  conversations,
  comms,
  critiqueLibrary,
  scratchpad,
  skills;

  IconData get icon => switch (this) {
        _OutreachView.conversations => Icons.forum_outlined,
        _OutreachView.comms => Icons.fact_check_outlined,
        _OutreachView.critiqueLibrary => Icons.drafts_outlined,
        _OutreachView.scratchpad => Icons.sticky_note_2_outlined,
        _OutreachView.skills => Icons.auto_awesome_outlined,
      };

  String label(AppLocalizations l10n) => switch (this) {
        _OutreachView.conversations => l10n.navOutreach,
        _OutreachView.comms => l10n.navComms,
        _OutreachView.critiqueLibrary => l10n.navEmailLibrary,
        _OutreachView.scratchpad => l10n.navScratchpad,
        _OutreachView.skills => l10n.navSkills,
      };
}

/// The Outreach cockpit: a list of conversations, an open conversation with a
/// method-aware composer, and — on the widest layout — the channel's full
/// profile docked beside it for reference.
///
/// Selection is URL state: `/outreach` (list), `/outreach/thread/:id` (that
/// thread open), `/outreach/compose/:influencerId` (resolve-or-create the
/// thread, then redirect). The three widths are `<720` (one pane at a time),
/// `720–1200` (list + detail), `>1200` (list + detail + profile).
///
/// From 720px up the conversation list is a dockable side panel: draggable to
/// any width between [OutreachThreadListWidthNotifier.minWidth] and half the
/// page, and collapsible to a slim rail when somebody wants the whole width
/// for one thread. Both are session state — see outreach_layout_controller.
class OutreachScreen extends ConsumerStatefulWidget {
  const OutreachScreen({
    super.key,
    this.threadId,
    this.composeForInfluencerId,
    this.focusCompose = false,
  });

  final String? threadId;
  final String? composeForInfluencerId;
  final bool focusCompose;

  @override
  ConsumerState<OutreachScreen> createState() => _OutreachScreenState();
}

class _OutreachScreenState extends ConsumerState<OutreachScreen> {
  bool _resolvingCompose = false;

  /// Which of the two views is on screen. Not persisted anywhere: the page
  /// always opens on the conversation cockpit, never on the critique library.
  _OutreachView _view = _OutreachView.conversations;

  @override
  void initState() {
    super.initState();
    final composeFor = widget.composeForInfluencerId;
    if (composeFor != null) {
      _resolvingCompose = true;
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _resolveCompose(composeFor));
    }
  }

  Future<void> _resolveCompose(String influencerId) async {
    final router = GoRouter.of(context);
    try {
      final thread = await ref
          .read(outreachRepositoryProvider)
          .getOrCreateThreadForInfluencer(influencerId);
      ref
        ..invalidate(allOutreachThreadsProvider)
        ..invalidate(threadByInfluencerProvider(influencerId));
      if (!mounted) return;
      // pushReplacement keeps the URL canonical so "back" returns to the list
      // rather than re-running the create.
      unawaited(
        router.pushReplacement(
          '${AppRoutes.outreachThread(thread.id)}?focus=compose',
        ),
      );
    } catch (_) {
      if (mounted) {
        setState(() => _resolvingCompose = false);
      }
    }
  }

  Future<void> _startNewMessage() async {
    final chosen = await showDialog<String>(
      context: context,
      builder: (_) => const _PickInfluencerDialog(),
    );
    if (chosen != null && mounted) {
      context.go(AppRoutes.outreachCompose(chosen));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final accessLevel = ref.watch(accessLevelProvider);

    if (!accessLevel.isAuthorized) {
      return Scaffold(
        appBar: GradientAppBar(title: GradientText(l10n.navOutreach)),
        body: const EmailsAccessDenied(),
      );
    }

    final canCompose = accessLevel.seesSensitiveData;

    // The template library and the writing rules are settings for the whole
    // page, not part of any one conversation, and they used to sit as two
    // full-width collapsed cards above the list — permanently spending a strip
    // of the page on two things somebody opens once a month. They are icon
    // buttons in the app bar now, beside the other page-level actions, and
    // open in dialogs.
    //
    // The outer LayoutBuilder is what lets the app bar know whether the
    // conversation list is a pane beside the thread or the whole page: the
    // show/hide action only means something in the first case, and the width
    // it has to test is the same one `_OutreachPanes` splits on — this page's
    // width less its own padding, not the window's.
    return LayoutBuilder(
      builder: (context, constraints) {
        final paneWidth = constraints.maxWidth - 32;
        final splitLayout = paneWidth >= 720;

        final library = _view == _OutreachView.critiqueLibrary;
        final scratchpad = _view == _OutreachView.scratchpad;
        final skills = _view == _OutreachView.skills;
        final conversations = _view == _OutreachView.conversations;
        final comms = _view == _OutreachView.comms && canCompose;

        return Scaffold(
          appBar: GradientAppBar(
            title: _OutreachViewSwitcher(
              view: _view,
              // The Comms queue drafts and sends: only for accounts that can
              // write, like the composer.
              views: [
                for (final view in _OutreachView.values)
                  if (view != _OutreachView.comms || canCompose) view,
              ],
              onChanged: (view) => setState(() => _view = view),
            ),
            actions: [
              // The conversation actions have nothing to act on while the
              // Comms queue, the critique library, the scratchpad or Skills is
              // the view, so
              // they step aside for those.
              if (conversations) ...[
                // First, because it is the one action here that changes the
                // shape of the page rather than acting on a conversation.
                if (splitLayout) const _ThreadListToggleAction(),
                if (canCompose) const _CheckRepliesAction(),
                if (canCompose)
                  IconButton(
                    tooltip: l10n.outreachNewMessage,
                    icon: const Icon(Icons.add_comment_outlined),
                    onPressed: _startNewMessage,
                  ),
                if (canCompose)
                  IconButton(
                    tooltip: l10n.outreachTemplatesTitle,
                    icon: const Icon(Icons.library_books_outlined),
                    onPressed: () => showTemplateLibraryDialog(context),
                  ),
                if (canCompose)
                  IconButton(
                    tooltip: l10n.outreachWritingRulesTitle,
                    icon: const Icon(Icons.rule),
                    onPressed: () => showWritingRulesDialog(context),
                  ),
              ],
            ],
          ),
          // The library's own "new record" affordance — a FAB, as it was when
          // the library had its own screen. Skills supplies its own FABs
          // (new skill / new card) from within its nested Scaffold instead of
          // through this one, since which action makes sense there depends on
          // whether a deck is open.
          floatingActionButton: library ? const NewEmailRecordButton() : null,
          body: GradientBackdrop(
            colors: const [
              AppColors.brandNavy,
              AppColors.primaryDark,
              AppColors.info
            ],
            fade: false,
            strength: 0.2,
            from: Alignment.topCenter,
            extent: 1,
            child: comms
                ? const CommsQueuePage()
                : library
                    ? const EmailLibraryView()
                    : scratchpad
                        ? const ScratchpadView()
                        : skills
                            ? const SkillsLibraryView()
                            : (_resolvingCompose
                                ? _OpeningConversation(
                                    label: l10n.outreachComposeOpening)
                                : Padding(
                                    padding: const EdgeInsets.all(16),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: [
                                        AccessLevelNotice(
                                            accessLevel: accessLevel),
                                        if (!accessLevel.seesSensitiveData)
                                          const SizedBox(height: 12),
                                        Expanded(
                                          child: _OutreachPanes(
                                            width: paneWidth,
                                            threadId: widget.threadId,
                                            focusCompose: widget.focusCompose,
                                          ),
                                        ),
                                      ],
                                    ),
                                  )),
          ),
        );
      },
    );
  }
}

/// Show or hide the conversation list, from the app bar.
///
/// It used to be two different controls in two different places — a chevron on
/// the drag handle to close the list, and another one on the slim rail left
/// behind to reopen it — which meant the way back was a button that only
/// existed once the list was already gone. One toggle, in the row where every
/// other page-level action already lives, is the same job with nothing to
/// find.
class _ThreadListToggleAction extends ConsumerWidget {
  const _ThreadListToggleAction();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final visible = ref.watch(outreachThreadListVisibleProvider);
    return IconButton(
      isSelected: visible,
      tooltip:
          visible ? l10n.outreachHideThreadList : l10n.outreachShowThreadList,
      icon: Icon(visible ? Icons.forum : Icons.forum_outlined),
      onPressed: () =>
          ref.read(outreachThreadListVisibleProvider.notifier).toggle(),
    );
  }
}

/// The Outreach page's app-bar title: the current view's icon and name with a
/// dropdown caret. Tapping it opens a menu of all three views — the
/// conversation cockpit, the email critique library and the scratchpad — and
/// picking one swaps the body.
///
/// Modelled on `RosterSectionSwitcher`, which does the same job for the three
/// Roster sections. Nothing here is persisted — [_OutreachScreenState._view]
/// resets to [_OutreachView.conversations] every time the page is built, so
/// the page always opens on the conversations.
class _OutreachViewSwitcher extends StatelessWidget {
  const _OutreachViewSwitcher({
    required this.view,
    required this.views,
    required this.onChanged,
  });

  final _OutreachView view;
  final List<_OutreachView> views;
  final ValueChanged<_OutreachView> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return MenuAnchor(
      builder: (context, controller, _) => InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => controller.isOpen ? controller.close() : controller.open(),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(view.icon, size: 20),
              const SizedBox(width: 8),
              Flexible(
                child: GradientText(
                  view.label(l10n),
                  style: theme.textTheme.titleLarge,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(Icons.arrow_drop_down),
            ],
          ),
        ),
      ),
      menuChildren: [
        for (final option in views)
          MenuItemButton(
            leadingIcon: Icon(
              option.icon,
              color: option == view ? theme.colorScheme.primary : null,
            ),
            trailingIcon:
                option == view ? const Icon(Icons.check, size: 18) : null,
            onPressed: () => onChanged(option),
            child: Text(option.label(l10n)),
          ),
      ],
    );
  }
}

class _OpeningConversation extends StatelessWidget {
  const _OpeningConversation({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 16),
          Text(label),
        ],
      ),
    );
  }
}

class _OutreachPanes extends ConsumerWidget {
  const _OutreachPanes({
    required this.width,
    required this.threadId,
    required this.focusCompose,
  });

  final double width;
  final String? threadId;
  final bool focusCompose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final tint = Theme.of(context).colorScheme.primary.withValues(alpha: 0.1);

    Widget listCard() => Card(
          clipBehavior: Clip.antiAlias,
          color: tint,
          elevation: 0,
          child: ThreadListPanel(selectedThreadId: threadId),
        );

    Widget detailCard({required bool showProfileToggle}) => Card(
          clipBehavior: Clip.antiAlias,
          color: tint,
          elevation: 0,
          child: threadId == null
              ? Center(child: Text(l10n.outreachSelectThreadHint))
              : ThreadDetailPanel(
                  key: ValueKey(threadId),
                  threadId: threadId!,
                  focusCompose: focusCompose,
                  showProfileToggle: showProfileToggle,
                ),
        );

    // Narrow: one pane at a time.
    if (width < 720) {
      if (threadId == null) return listCard();
      return Card(
        clipBehavior: Clip.antiAlias,
        color: Colors.white.withValues(alpha: 0.15),
        elevation: 0,
        child: ThreadDetailPanel(
          key: ValueKey(threadId),
          threadId: threadId!,
          focusCompose: focusCompose,
          onBack: () => context.go(AppRoutes.outreach),
        ),
      );
    }

    final listVisible = ref.watch(outreachThreadListVisibleProvider);
    // Never more than half the page: past that the list is no longer a sidebar
    // beside the thread, it is competing with it. Clamped against the CURRENT
    // width rather than only when dragged, so shrinking the window narrows the
    // list instead of squeezing the thread out of existence.
    final listWidth = ref
        .watch(outreachThreadListWidthProvider)
        .clamp(OutreachThreadListWidthNotifier.minWidth, width / 2)
        .toDouble();

    final sidePanel = listVisible
        ? [
            SizedBox(width: listWidth, child: listCard()),
            const _ThreadListDragHandle(),
          ]
        : const <Widget>[];

    // Medium: list + detail.
    if (width <= 1200) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ...sidePanel,
          Expanded(child: detailCard(showProfileToggle: false)),
        ],
      );
    }

    // Wide: list + detail + docked profile.
    final paneVisible = ref.watch(outreachProfilePaneVisibleProvider);
    final showProfile = threadId != null && paneVisible;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ...sidePanel,
        Expanded(flex: 3, child: detailCard(showProfileToggle: true)),
        if (showProfile) ...[
          const SizedBox(width: 16),
          Expanded(
            flex: 3,
            child: OutreachProfilePane(
              key: ValueKey('profile-$threadId'),
              threadId: threadId!,
            ),
          ),
        ],
      ],
    );
  }
}

/// The grab strip between the conversation list and the open thread: drag to
/// resize.
///
/// It occupies the gap that used to be a plain `SizedBox(width: 16)`, so the
/// layout spends nothing extra on it. The cursor change is what makes it
/// discoverable — a divider nobody knows is draggable is a divider. Closing
/// the list is no longer one of its jobs: that lives in the app bar now, next
/// to every other action that belongs to the page rather than to a
/// conversation.
class _ThreadListDragHandle extends ConsumerWidget {
  const _ThreadListDragHandle();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return MouseRegion(
      cursor: SystemMouseCursors.resizeLeftRight,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        // `nudge` takes the delta rather than an absolute width because a
        // gesture delivers several updates per frame and a width read back
        // from the provider inside the callback is already stale by the
        // second one.
        onHorizontalDragUpdate: (details) => ref
            .read(outreachThreadListWidthProvider.notifier)
            .nudge(details.delta.dx),
        child: SizedBox(
          width: 16,
          child: Center(
            child: Container(
              width: 3,
              decoration: BoxDecoration(
                color: theme.colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A search-as-you-type picker over every channel, for starting a brand-new
/// conversation. Pops the chosen influencer id.
///
/// The search runs in the database, one page at a time. It used to fetch every
/// channel through `allInfluencersProvider` and filter the list in Dart on each
/// keystroke — which is fine at eight rows and untenable at a hundred thousand:
/// the dialog could not open until the whole table had arrived and been decoded
/// into `Influencer` objects, to show at most a screenful of them.
///
/// [InfluencerQuery.search] matches name and handle case-insensitively, which
/// is exactly what the in-memory filter did, so what the user sees is unchanged
/// apart from arriving sooner.
class _PickInfluencerDialog extends ConsumerStatefulWidget {
  const _PickInfluencerDialog();

  @override
  ConsumerState<_PickInfluencerDialog> createState() =>
      _PickInfluencerDialogState();
}

class _PickInfluencerDialogState extends ConsumerState<_PickInfluencerDialog> {
  /// Long enough that ordinary typing produces one query rather than one per
  /// letter, short enough that a pause before reading the results is not
  /// noticeable.
  static const _debounce = Duration(milliseconds: 250);

  /// One screenful and a little more. This is a picker, not a browser: someone
  /// who cannot see their channel types another letter, and a longer list would
  /// only make that less obvious.
  static const _limit = 40;

  Timer? _timer;
  List<Influencer>? _results;
  Object? _error;

  /// Which request the visible results belong to.
  ///
  /// Responses can land out of order — a short needle matches more rows and can
  /// take longer than the longer needle typed after it. Without this, the
  /// slower earlier answer overwrites the newer one and the list stops
  /// agreeing with the box.
  int _requestId = 0;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _onChanged(String value) {
    _timer?.cancel();
    _timer = Timer(_debounce, () => _search(value));
  }

  Future<void> _search(String raw) async {
    final needle = raw.trim();
    final id = ++_requestId;
    setState(() {
      _results = null;
      _error = null;
    });

    try {
      final page = await ref.read(influencerRepositoryProvider).getPage(
            offset: 0,
            limit: _limit,
            query: InfluencerQuery(
              search: needle.isEmpty ? null : needle,
              // Subscribers descending, so an empty box opens on the channels
              // most likely to be worth contacting rather than on whichever
              // rows the database happened to return first.
              sortBy: InfluencerSortBy.subscribers,
            ),
          );
      if (!mounted || id != _requestId) return;
      setState(() => _results = page.items);
    } catch (error) {
      if (!mounted || id != _requestId) return;
      setState(() => _error = error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return AlertDialog(
      title: Text(l10n.outreachPickInfluencerTitle),
      content: SizedBox(
        width: 420,
        height: 460,
        child: Column(
          children: [
            TextField(
              autofocus: true,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: l10n.outreachPickInfluencerHint,
                isDense: true,
              ),
              onChanged: _onChanged,
            ),
            const SizedBox(height: 8),
            Expanded(child: _buildResults(l10n)),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
      ],
    );
  }

  Widget _buildResults(AppLocalizations l10n) {
    if (_error != null) return Center(child: Text(l10n.commonError));

    final matches = _results;
    if (matches == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (matches.isEmpty) {
      return Center(child: Text(l10n.outreachPickInfluencerEmpty));
    }

    return ListView.builder(
      itemCount: matches.length,
      itemBuilder: (context, index) {
        final influencer = matches[index];
        return ListTile(
          dense: true,
          title: Text(influencer.displayName),
          subtitle: Text(influencer.handle),
          onTap: () => Navigator.of(context).pop(influencer.id),
        );
      },
    );
  }
}

/// "Check for replies", for the person who does not want to wait for the timer.
///
/// Sweeps WITHOUT sending: the automatic loop is what pushes follow-ups out,
/// and somebody asking about incoming mail has not asked to fire a batch of
/// outgoing messages. That distinction is [OutreachInboxController.sweep]'s
/// `checkOnly`, and it is the whole reason this is not just a call to the same
/// thing the timer calls.
///
/// Shown only where a mailbox could exist — on a machine with none, the button
/// is absent rather than present-and-failing.
class _CheckRepliesAction extends ConsumerWidget {
  const _CheckRepliesAction();

  Future<void> _check(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final report =
        await ref.read(outreachInboxProvider.notifier).sweep(checkOnly: true);
    if (!context.mounted) return;

    final error = report.error;
    if (error != null) {
      AppToast.error(context, l10n.outreachSweepFailed(error.message));
      return;
    }
    if (report.replies == 0) {
      AppToast.info(context, l10n.outreachNoNewReplies);
      return;
    }
    AppToast.success(
      context,
      report.followUpsCancelled > 0
          ? l10n.outreachRepliesAppliedWithCancels(
              report.replies, report.followUpsCancelled)
          : l10n.outreachRepliesApplied(report.replies),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mailbox = ref.watch(gmailStatusProvider).value;
    if (mailbox == null || !mailbox.canSend) return const SizedBox.shrink();

    final sweeping =
        ref.watch(outreachInboxProvider.select((state) => state.isSweeping));
    return IconButton(
      tooltip:
          sweeping ? l10n.outreachCheckingReplies : l10n.outreachCheckReplies,
      icon: sweeping
          ? const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Icon(Icons.mark_email_unread_outlined),
      onPressed: sweeping ? null : () => _check(context, ref),
    );
  }
}
