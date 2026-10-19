import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/panel_button_style.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/features/scratchpad/application/scratchpad_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The team scratchpad: one shared text box per person, one tab each — as a
/// page body, with no Scaffold of its own.
///
/// You edit only your own box (autosaved a moment after you stop typing) and
/// read everyone else's live. Each box shows when its owner last saved and
/// when this device last pulled it — and a collapsible per-device sync log —
/// so a stuck sync is easy to spot.
///
/// It no longer has its own nav destination — it is one of the views on the
/// Outreach page, reached from the switcher at the top of that page (see
/// `EmailLibraryView`'s doc comment for the same move) — so what used to be
/// the app bar's sync-log action now sits inline, above the tab strip.
class ScratchpadView extends ConsumerStatefulWidget {
  const ScratchpadView({super.key});

  @override
  ConsumerState<ScratchpadView> createState() => _ScratchpadViewState();
}

class _ScratchpadViewState extends ConsumerState<ScratchpadView> {
  final TextEditingController _mine = TextEditingController();
  final FocusNode _focus = FocusNode();

  /// Captured in [build] so [dispose] and the focus listener never touch `ref`
  /// after the element is deactivated.
  ScratchpadBoardController? _controller;

  /// The tab currently open.
  String? _selectedId;

  /// Whether [_mine] has been filled from the server at least once.
  bool _seeded = false;

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus) {
        unawaited(_controller?.flush());
      }
    });
  }

  @override
  void dispose() {
    // Best-effort final save when leaving the page.
    unawaited(_controller?.flush());
    _focus.dispose();
    _mine.dispose();
    super.dispose();
  }

  /// Bring the server's copy of *my* box into the field — on first load, and
  /// afterwards only when I am not typing (covers the same person editing on
  /// another device).
  void _adoptMine(ScratchpadBoard board, String? myId) {
    if (myId == null) return;
    final serverBody = board.noteFor(myId)?.body ?? '';
    if (!_seeded) {
      _mine.text = serverBody;
      _seeded = true;
      return;
    }
    if (!_focus.hasFocus && serverBody != _mine.text) {
      _mine.value = TextEditingValue(
        text: serverBody,
        selection: TextSelection.collapsed(offset: serverBody.length),
      );
    }
  }

  List<TeamMember> _ordered(Iterable<TeamMember> members, String? myId) {
    final list = members.toList()
      ..sort((a, b) => a.displayName.toLowerCase().compareTo(
            b.displayName.toLowerCase(),
          ));
    if (myId == null) return list;
    final mineIndex = list.indexWhere((m) => m.id == myId);
    if (mineIndex <= 0) return list;
    final mine = list.removeAt(mineIndex);
    return [mine, ...list];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final myId = ref.watch(currentProfileProvider).value?.id;
    final membersAsync = ref.watch(teamMembersProvider);
    final boardAsync = ref.watch(scratchpadBoardControllerProvider);
    _controller = ref.read(scratchpadBoardControllerProvider.notifier);

    ref.listen<AsyncValue<ScratchpadBoard>>(
      scratchpadBoardControllerProvider,
      (_, next) {
        final board = next.value;
        if (board != null) _adoptMine(board, myId);
      },
    );

    return membersAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => _centeredMessage(l10n.scratchpadNoTeammates, theme),
      data: (membersById) {
        final members = _ordered(membersById.values, myId);
        if (members.isEmpty) {
          return _centeredMessage(l10n.scratchpadNoTeammates, theme);
        }

        _selectedId ??= members.first.id;
        if (!members.any((m) => m.id == _selectedId)) {
          _selectedId = members.first.id;
        }
        final selected = members.firstWhere((m) => m.id == _selectedId);
        final isMine = selected.id == myId;
        final board = boardAsync.value;
        // First load may already be cached before `ref.listen` sees a
        // change — seed my box from it here so the field is never wrongly
        // blank.
        if (board != null && !_seeded) _adoptMine(board, myId);
        final note = board?.noteFor(selected.id);
        final pulledAt = board?.pulledAt[selected.id] ?? board?.lastSyncedAt;
        final fmt = ref.watch(instantFormatterProvider);

        return Padding(
          padding: const EdgeInsetsGeometry.all(25),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (boardAsync.hasError) _errorBar(l10n, theme),
              Align(
                alignment: Alignment.centerRight,
                child: _SyncLogButton(title: l10n.scratchpadSyncLog),
              ),
              _TabStrip(
                members: members,
                selectedId: _selectedId!,
                myId: myId,
                note: isMine
                    ? l10n.scratchpadHint
                    : l10n.scratchpadOthersReadOnly,
                youLabel: l10n.scratchpadYouTab,
                onSelected: (id) => setState(() => _selectedId = id),
              ),
              Expanded(
                flex: 1,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (isMine)
                        _MyBox(
                          controller: _mine,
                          focusNode: _focus,
                          onChanged: (v) => _controller?.edit(v),
                        )
                      else
                        _TheirBox(
                          body: note?.body ?? '',
                          emptyLabel: l10n.scratchpadEmptyBox,
                          readOnlyNote: l10n.scratchpadOthersReadOnly,
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                direction: Axis.horizontal,
                crossAxisAlignment: WrapCrossAlignment.start,
                alignment: WrapAlignment.center,
                spacing: 200,
                runSpacing: 10,
                children: [
                  _MetaLine(
                    label: l10n.scratchpadLastSaved,
                    value: note == null
                        ? l10n.scratchpadNever
                        : '${fmt.dateTime(note.updatedAt)} · ${_relative(note.updatedAt)}',
                  ),
                  _MetaLine(
                    label: l10n.scratchpadLastSyncedHere,
                    value: pulledAt == null
                        ? l10n.scratchpadNever
                        : '${fmt.dateTime(pulledAt)} · ${_relative(pulledAt)}',
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _centeredMessage(String text, ThemeData theme) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      );

  Widget _errorBar(AppLocalizations l10n, ThemeData theme) => Material(
        color: theme.colorScheme.errorContainer,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.scratchpadLoadFailed,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.onErrorContainer),
                ),
              ),
              TextButton(
                onPressed: () =>
                    ref.invalidate(scratchpadBoardControllerProvider),
                style: TextButton.styleFrom(
                  foregroundColor: theme.colorScheme.onErrorContainer,
                ),
                child: Text(l10n.scratchpadRetry),
              ),
            ],
          ),
        ),
      );
}

String _relative(DateTime instant) {
  final d = DateTime.now().difference(instant);
  if (d.isNegative || d.inSeconds < 45) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes}m ago';
  if (d.inHours < 24) return '${d.inHours}h ago';
  return '${d.inDays}d ago';
}

String _hms(DateTime t) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
}

class _TabStrip extends StatelessWidget {
  const _TabStrip({
    required this.members,
    required this.selectedId,
    required this.myId,
    required this.note,
    required this.youLabel,
    required this.onSelected,
  });

  final List<TeamMember> members;
  final String selectedId;
  final String? myId;
  final String note;
  final String youLabel;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SizedBox(
        height: 50,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: members.length,
          separatorBuilder: (_, __) => const SizedBox(width: 8),
          itemBuilder: (context, i) {
            final m = members[i];
            final isSelected = m.id == selectedId;
            final isMine = m.id == myId;
            return ChoiceChip(
              selected: isSelected,
              onSelected: (_) => onSelected(m.id),
              avatar: CircleAvatar(backgroundColor: m.color, radius: 6),
              label:
                  Text(isMine ? '${m.displayName} · $youLabel' : m.displayName),
              labelStyle: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              ),
            );
          },
        ),
      ),
    ]);
  }
}

class _MyBox extends StatelessWidget {
  const _MyBox({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      focusNode: focusNode,
      onChanged: onChanged,
      minLines: 12,
      maxLines: null,
      keyboardType: TextInputType.multiline,
      textInputAction: TextInputAction.newline,
      decoration: const InputDecoration(
        border: OutlineInputBorder(),
      ),
    );
  }
}

class _TheirBox extends StatelessWidget {
  const _TheirBox({
    required this.body,
    required this.emptyLabel,
    required this.readOnlyNote,
  });

  final String body;
  final String emptyLabel;
  final String readOnlyNote;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          constraints: const BoxConstraints(minHeight: 220),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            border: Border.all(color: theme.colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(4),
          ),
          child: body.isEmpty
              ? Text(
                  emptyLabel,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                )
              : SelectableText(body, style: theme.textTheme.bodyMedium),
        ),
        const SizedBox(height: 6),
        Text(
          readOnlyNote,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          child: Text(
            label,
            style: theme.textTheme.labelMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
        const SizedBox(width: 25),
        SizedBox(
          child: Text(
            value,
            style: theme.textTheme.bodySmall
                ?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
          ),
        ),
      ],
    );
  }
}

/// Opens the per-device sync log in a popup dialog. Used to sit as an app-bar
/// action on the Scratchpad's own Scaffold; now placed inline, above the tab
/// strip, since the page shares Outreach's app bar.
class _SyncLogButton extends StatelessWidget {
  const _SyncLogButton({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
        padding: const EdgeInsetsGeometry.symmetric(horizontal: 16),
        child: ElevatedButton.icon(
          icon: const Icon(Icons.history, size: 20),
          label: Text(title, style: theme.textTheme.bodyMedium),
          style: panelButtonStyle(theme),
          onPressed: () => showDialog<void>(
            context: context,
            builder: (_) => _SyncLogDialog(title: title),
          ),
        ));
  }
}

class _SyncLogDialog extends ConsumerWidget {
  const _SyncLogDialog({required this.title});

  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final events =
        ref.watch(scratchpadBoardControllerProvider).value?.log ?? const [];
    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 420,
        child: Container(
          constraints: const BoxConstraints(maxHeight: 320),
          decoration: BoxDecoration(
            border: Border.all(color: theme.colorScheme.outlineVariant),
            borderRadius: BorderRadius.circular(4),
          ),
          child: events.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text('—', style: theme.textTheme.bodySmall),
                )
              : ListView.builder(
                  shrinkWrap: true,
                  itemCount: events.length,
                  itemBuilder: (context, i) {
                    final e = events[i];
                    return Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 5,
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _hms(e.at),
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                              fontFeatures: const [
                                FontFeature.tabularFigures()
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              e.message,
                              style: theme.textTheme.bodySmall,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(MaterialLocalizations.of(context).closeButtonLabel),
        ),
      ],
    );
  }
}
