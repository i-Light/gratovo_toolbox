import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/responsive.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/activity_log_repository.dart';
import 'package:gratovo_toolbox/features/logs/application/activity_log_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Every action anyone has taken, newest first.
///
/// The page exists because of one specific requirement: the history has to
/// survive the person. An account that is deleted, or whose authority changes,
/// must not take its entries with it or retroactively rewrite what authority
/// they were made under. So every row shows the name and the authority as they
/// were recorded, and a row whose account has since been removed says so
/// rather than showing a blank where a person used to be.
class LogsScreen extends ConsumerStatefulWidget {
  const LogsScreen({super.key, this.onClose});

  /// Set when the screen is hosted inside [showAsDialog] rather than a route —
  /// draws a close button in the app bar's leading slot.
  final VoidCallback? onClose;

  /// Opens the full Logs screen in a centered modal. Used from the Dashboard's
  /// Logs peek card and the influencer activity card now that Logs is no
  /// longer a nav destination.
  static Future<void> showAsDialog(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1100, maxHeight: 820),
          child: LogsScreen(onClose: () => Navigator.of(ctx).pop()),
        ),
      ),
    );
  }

  @override
  ConsumerState<LogsScreen> createState() => _LogsScreenState();
}

class _LogsScreenState extends ConsumerState<LogsScreen> {
  final _scrollController = ScrollController();

  /// Same threshold as the influencer list: near the end rather than at it, so
  /// the next page is usually already there by the time it is scrolled to.
  static const _loadMoreThreshold = 600.0;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    if (position.pixels < position.maxScrollExtent - _loadMoreThreshold) return;
    ref
        .read(activityLogPageProvider(ref.read(activityLogFilterProvider))
            .notifier)
        .loadMore();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final query = ref.watch(activityLogFilterProvider);
    final pageAsync = ref.watch(activityLogPageProvider(query));
    final fmt = ref.watch(instantFormatterProvider);
    // How many of the results now on screen were recorded today. Counted over
    // the loaded (and filtered) entries, so applying a filter narrows it too;
    // the log is newest-first, so today's entries are all in the first page.
    final todayCount = pageAsync.maybeWhen(
      data: (state) =>
          state.items.where((e) => fmt.daysUntil(e.at) == 0).length,
      orElse: () => 0,
    );

    return Scaffold(
      appBar: GradientAppBar(
        leading: widget.onClose == null
            ? null
            : IconButton(
                icon: const Icon(Icons.close),
                onPressed: widget.onClose,
              ),
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child:
                  GradientText(l10n.navLogs, overflow: TextOverflow.ellipsis),
            ),
            if (todayCount > 0) ...[
              const SizedBox(width: 12),
              _Pill(
                text: l10n.logsNewCount(todayCount),
                color: Theme.of(context).colorScheme.primary,
              ),
            ],
          ],
        ),
        actions: [
          IconButton(
            tooltip: l10n.commonRetry,
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(activityLogPageProvider(query));
              ref.invalidate(activityActorsProvider);
            },
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: Column(
        children: [
          _FilterBar(query: query, l10n: l10n),
          Expanded(
            child: pageAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stackTrace) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(l10n.commonError),
                    TextButton(
                      onPressed: () =>
                          ref.invalidate(activityLogPageProvider(query)),
                      child: Text(l10n.commonRetry),
                    ),
                  ],
                ),
              ),
              data: (state) {
                if (state.items.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(32),
                      child: Text(
                        // Two different situations with two different fixes:
                        // nothing has ever been recorded (do something), or
                        // these filters match nothing (loosen one).
                        query.isUnfiltered
                            ? l10n.logsEmpty
                            : l10n.logsNoMatches,
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: () => ref
                      .read(activityLogPageProvider(query).notifier)
                      .refresh(),
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: state.items.length + 1,
                    itemBuilder: (context, index) {
                      if (index == state.items.length) {
                        return _ListFooter(state: state, l10n: l10n);
                      }
                      return _LogTile(entry: state.items[index], l10n: l10n);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Search, person, action, record type and date range.
class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.query, required this.l10n});

  final ActivityLogQuery query;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(activityLogFilterProvider.notifier);
    final actorsAsync = ref.watch(activityActorsProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 260,
            child: _SearchField(
              initial: query.search,
              hint: l10n.logsSearchHint,
              onChanged: notifier.setSearch,
            ),
          ),
          // The actor list comes from the log, not from `profiles`, so someone
          // who has left still appears here — which is exactly when you most
          // want to ask what they did.
          //
          // Keyed on the ActivityActor rather than on its id, because a
          // deleted account's id is null and two menu items sharing a value is
          // something DropdownButton asserts against. ActivityActor carries
          // value equality for exactly this.
          actorsAsync.maybeWhen(
            // Bounded and expanded, unlike the three fixed-label dropdowns
            // beside it. A DropdownButton sizes itself to its WIDEST menu item,
            // and these labels are user data — a display name plus "(account
            // deleted)" ran 199 pixels past a phone-width window. A fixed width
            // with ellipsis keeps a long name from deciding the layout, and the
            // full name is still readable in the open menu.
            data: (actors) => SizedBox(
              width: 190,
              child: DropdownButton<ActivityActor?>(
                value: _selectedActor(actors, query),
                isExpanded: true,
                underline: const SizedBox.shrink(),
                hint: Text(l10n.logsFilterActor),
                items: [
                  DropdownMenuItem(
                    value: null,
                    child: Text(l10n.logsFilterAllPeople),
                  ),
                  for (final actor in actors)
                    DropdownMenuItem(
                      value: actor,
                      child: Text(
                        actor.isDeleted
                            ? '${actor.name} (${l10n.logsDeletedAccount})'
                            : actor.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: notifier.setActor,
              ),
            ),
            orElse: () => const SizedBox.shrink(),
          ),
          // The action filter's longest label outruns a narrow window once
          // the font slider is up — the Wrap around this can give it its own
          // line but not make it narrower, so it ran 48px over. Capped and
          // ellipsised below the mobile breakpoint, natural width above it.
          ConstrainedBox(
            constraints: BoxConstraints(
              maxWidth: context.isMobile ? 220 : double.infinity,
            ),
            child: DropdownButton<ActivityAction?>(
              isExpanded: context.isMobile,
              value: query.action,
              underline: const SizedBox.shrink(),
              hint: Text(l10n.logsFilterAction),
              items: [
                DropdownMenuItem(
                  value: null,
                  child: Text(l10n.logsFilterAllActions),
                ),
                for (final action in ActivityAction.values)
                  if (action != ActivityAction.unknown)
                    DropdownMenuItem(
                      value: action,
                      child: Text(action.label(l10n)),
                    ),
              ],
              onChanged: notifier.setAction,
            ),
          ),
          DropdownButton<String?>(
            value: query.entityType,
            underline: const SizedBox.shrink(),
            hint: Text(l10n.logsFilterEntity),
            items: [
              DropdownMenuItem(
                value: null,
                child: Text(l10n.logsFilterAllEntities),
              ),
              for (final type in const [
                'channel',
                'deal',
                'brand',
                'thread',
                'run',
              ])
                DropdownMenuItem(
                  value: type,
                  child: Text(activityEntityLabel(type, l10n)),
                ),
            ],
            onChanged: notifier.setEntityType,
          ),
          // A dropdown rather than a segmented button. Three chips reading
          // "Today / Last 7 days / Last 30 days" cannot shrink below their
          // labels, and a Wrap cannot make them — at phone width they
          // overflowed the row by about 200 pixels. A dropdown is as wide as
          // whichever option is selected, and it matches the three filters
          // beside it.
          DropdownButton<int?>(
            value: _selectedRange(query),
            underline: const SizedBox.shrink(),
            items: [
              DropdownMenuItem(value: null, child: Text(l10n.logsRangeAny)),
              DropdownMenuItem(value: 1, child: Text(l10n.logsRangeToday)),
              DropdownMenuItem(value: 7, child: Text(l10n.logsRange7Days)),
              DropdownMenuItem(value: 30, child: Text(l10n.logsRange30Days)),
            ],
            onChanged: (days) {
              if (days == null) {
                notifier.setRange();
              } else {
                notifier.setLastDays(days);
              }
            },
          ),
          if (query.activeFilterCount > 0)
            TextButton.icon(
              onPressed: notifier.clear,
              icon: const Icon(Icons.clear),
              label: Text(l10n.logsClearFilters),
            ),
        ],
      ),
    );
  }

  /// The actor the query is currently pinned to, as an instance from [actors]
  /// so it is `==` to exactly one menu item.
  ///
  /// Derived rather than stored, so there is one source of truth: clearing the
  /// filters clears the dropdown with nothing extra to remember.
  ActivityActor? _selectedActor(
    List<ActivityActor> actors,
    ActivityLogQuery query,
  ) {
    if (query.actorId == null && query.actorName == null) return null;
    for (final actor in actors) {
      if (query.actorId != null && actor.id == query.actorId) return actor;
      if (query.actorId == null &&
          actor.id == null &&
          actor.name == query.actorName) {
        return actor;
      }
    }
    // The filter names somebody who is not in the current actor list — which
    // happens for a moment after a refresh. Falling back to "everyone" would
    // silently widen the results; showing the hint leaves the rows filtered
    // and the control merely unset until the list arrives.
    return null;
  }

  /// Which range is selected, derived from the query rather than held
  /// separately — one source of truth, so clearing the filters clears the
  /// dropdown too with nothing extra to remember.
  ///
  /// A range set some other way (a future custom picker) resolves to null,
  /// which shows "Any time" while the rows stay filtered. That is the honest
  /// failure: the control cannot represent the constraint, so it does not
  /// pretend to.
  int? _selectedRange(ActivityLogQuery query) {
    final from = query.from;
    final to = query.to;
    if (from == null || to == null) return null;
    final days = to.difference(from).inDays;
    return const {1, 7, 30}.contains(days) ? days : null;
  }
}

/// The search box. Its own widget with its own controller so typing does not
/// rebuild from the provider on every keystroke, which is what moves the
/// cursor to the end of the field mid-word.
class _SearchField extends StatefulWidget {
  const _SearchField({
    required this.initial,
    required this.hint,
    required this.onChanged,
  });

  final String? initial;
  final String hint;
  final ValueChanged<String?> onChanged;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initial ?? '');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: widget.hint,
        isDense: true,
        prefixIcon: const Icon(Icons.search),
        border: const OutlineInputBorder(),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.clear),
                onPressed: () {
                  _controller.clear();
                  setState(() {});
                  widget.onChanged(null);
                },
              ),
      ),
      // Submitted rather than per-keystroke: each change is a new query
      // against a leading-wildcard match, and firing one per letter queues a
      // request the next letter has already invalidated.
      onSubmitted: widget.onChanged,
      onChanged: (_) => setState(() {}),
    );
  }
}

/// One recorded action.
class _LogTile extends ConsumerWidget {
  const _LogTile({required this.entry, required this.l10n});

  final ActivityLogEntry entry;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final destination = _destinationFor(entry);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                entry.action.icon,
                size: 20,
                color: entry.action.color(context),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Who, then what. A Wrap rather than a Row because the name,
                  // the authority chip and the action do not fit on one line at
                  // phone width, and a Row cannot shrink a Text below its label.
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        entry.actorName,
                        style: theme.textTheme.titleSmall,
                      ),
                      if (entry.actorIsGone)
                        Tooltip(
                          message: l10n.logsDeletedAccountTooltip,
                          child: _Pill(
                            text: l10n.logsDeletedAccount,
                            color: theme.colorScheme.error,
                          ),
                        ),
                      // The authority held AT THE TIME. Rendered quietly, but
                      // rendered: it is the difference between "someone with
                      // full access did this" and "someone who has full access
                      // now did this", and only the first is a fact.
                      _Pill(
                        text: l10n.logsActorRole(entry.actorRole.label(l10n)),
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                      Text(
                        entry.action.label(l10n),
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _subjectLine(l10n),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  if (_changeLine(l10n) case final change?) ...[
                    const SizedBox(height: 2),
                    Text(change, style: theme.textTheme.bodySmall),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    fmt.dateTime(entry.at),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (destination != null)
              IconButton(
                tooltip: l10n.logsOpenRecord,
                icon: const Icon(Icons.open_in_new, size: 18),
                onPressed: () => context.go(destination),
              ),
          ],
        ),
      ),
    );
  }

  /// "Channel · @handle", falling back to the type alone when the entry
  /// carries no label (a settings change, a run with no keywords).
  String _subjectLine(AppLocalizations l10n) {
    final type = activityEntityLabel(entry.entityType, l10n);
    final label = entry.entityLabel;
    final field = entry.field;
    final parts = <String>[
      type,
      if (label != null && label.isNotEmpty) label,
      if (field != null && field.isNotEmpty) field,
    ];
    return parts.join('  ·  ');
  }

  /// What actually changed, when the entry says.
  ///
  /// Notes are the deliberate exception: they are recorded by length, never by
  /// content, so this renders the lengths and says plainly that the text was
  /// not kept. See [ActivityLogger.channelNotesChanged].
  String? _changeLine(AppLocalizations l10n) {
    if (entry.action == ActivityAction.notesChanged) {
      final detail = entry.detail;
      final before = detail?['lengthBefore'];
      final after = detail?['lengthAfter'];
      if (before is int && after is int) {
        return '${l10n.logsNotesLengthChange(before, after)}'
            '  ·  ${l10n.logsContentNotRecorded}';
      }
      return l10n.logsContentNotRecorded;
    }
    final from = entry.oldValue;
    final to = entry.newValue;
    if (from != null && to != null) return l10n.logsValueChange(from, to);
    if (to != null) return to;
    return null;
  }

  /// Where the "open" button goes, or null when the entry points at something
  /// with no page of its own (a search run, a settings change).
  static String? _destinationFor(ActivityLogEntry entry) {
    final id = entry.entityId;
    if (id == null || id.isEmpty) return null;
    return switch (entry.entityType) {
      'channel' => AppRoutes.influencerDetail(id),
      'deal' => AppRoutes.dealDetail(id),
      'brand' => AppRoutes.brandDetail(id),
      'thread' => AppRoutes.outreach,
      _ => null,
    };
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        border: Border.all(color: color.withValues(alpha: 0.6)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
      ),
    );
  }
}

/// A spinner while more is loading, a retry when appending failed, or a quiet
/// confirmation that this is the whole log.
class _ListFooter extends ConsumerWidget {
  const _ListFooter({required this.state, required this.l10n});

  final ActivityLogListState state;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (state.loadMoreError != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Column(
            children: [
              Text(l10n.commonError),
              TextButton(
                onPressed: () => ref
                    .read(activityLogPageProvider(
                            ref.read(activityLogFilterProvider))
                        .notifier)
                    .loadMore(),
                child: Text(l10n.commonRetry),
              ),
            ],
          ),
        ),
      );
    }
    if (state.isLoadingMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: Column(
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.logsLoadingMore,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20),
      child: Center(
        child: Text(
          state.hasMore
              ? l10n.logsShowingCount(state.items.length)
              : l10n.logsEndOfList,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}
