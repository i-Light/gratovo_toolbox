import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/edit_conflict.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/conflicts/application/conflict_controller.dart';
import 'package:gratovo_toolbox/features/conflicts/presentation/conflict_field_label.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Where two edits that diverged get settled by a person.
///
/// Reached from a badge rather than the nav rail, and it is worth saying why:
/// this is not a place anyone goes. A healthy week produces nothing here. It is
/// a page you are sent to, by the message you get when a save is refused or by
/// the banner on the channel's own profile — which is also where most of these
/// should actually be dealt with, in the context of the channel they are about.
class ConflictsScreen extends ConsumerWidget {
  const ConflictsScreen({super.key, this.channelId});

  /// When set, only this channel's conflicts — the profile banner's "Review".
  final String? channelId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final open = channelId == null
        ? ref.watch(openConflictsProvider)
        : ref.watch(conflictsForChannelProvider(channelId!));
    final resolved = ref.watch(resolvedConflictsProvider);

    return Scaffold(
      appBar: GradientAppBar(
        title: GradientText(l10n.conflictsTitle),
        actions: [
          IconButton(
            tooltip: l10n.commonRefresh,
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref.invalidate(openConflictsProvider);
              ref.invalidate(resolvedConflictsProvider);
              if (channelId != null) {
                ref.invalidate(conflictsForChannelProvider(channelId!));
              }
            },
          ),
        ],
      ),
      body: open.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(l10n.commonError)),
        data: (conflicts) {
          final settled = resolved.value ?? const <EditConflict>[];
          if (conflicts.isEmpty && settled.isEmpty) {
            return _Empty(l10n: l10n);
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              // Said up front, because the single most likely misreading of
              // this page is "the app flags it whenever two of us touch the
              // same channel". It does not, and someone who believes it does
              // will start avoiding the channels their colleagues are on.
              Text(
                l10n.conflictsExplanation,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
              ),
              const SizedBox(height: 16),
              if (conflicts.isNotEmpty) ...[
                _SectionHeader(text: l10n.conflictsOpenSection),
                for (final conflict in conflicts)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _ConflictCard(conflict: conflict, l10n: l10n),
                  ),
              ] else
                _Empty(l10n: l10n, compact: true),
              if (settled.isNotEmpty) ...[
                const SizedBox(height: 24),
                _SectionHeader(text: l10n.conflictsResolvedSection),
                for (final conflict in settled)
                  _ResolvedRow(conflict: conflict, l10n: l10n),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(text, style: Theme.of(context).textTheme.titleSmall),
      );
}

class _Empty extends StatelessWidget {
  const _Empty({required this.l10n, this.compact = false});

  final AppLocalizations l10n;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final body = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.conflictsNone, style: theme.textTheme.titleSmall),
        const SizedBox(height: 8),
        Text(
          l10n.conflictsNoneHint,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
    return compact
        ? Padding(
            padding: const EdgeInsets.symmetric(vertical: 24), child: body)
        : Center(
            child: Padding(padding: const EdgeInsets.all(32), child: body));
  }
}

/// One disagreement, with all three values and the three ways out.
class _ConflictCard extends ConsumerStatefulWidget {
  const _ConflictCard({required this.conflict, required this.l10n});

  final EditConflict conflict;
  final AppLocalizations l10n;

  @override
  ConsumerState<_ConflictCard> createState() => _ConflictCardState();
}

class _ConflictCardState extends ConsumerState<_ConflictCard> {
  bool _busy = false;
  bool _merging = false;
  late final TextEditingController _merged = TextEditingController(
    // Seeded with both versions rather than blank. For free text the usual
    // right answer is that both people's additions survive, and starting from
    // an empty box makes the easy case as much work as the hard one.
    text: _seedMerge(),
  );

  String _seedMerge() {
    final mine = _asText(widget.conflict.mineValue);
    final theirs = _asText(widget.conflict.theirsValue);
    if (mine.isEmpty) return theirs;
    if (theirs.isEmpty) return mine;
    if (mine == theirs) return mine;
    return '$theirs\n\n$mine';
  }

  @override
  void dispose() {
    _merged.dispose();
    super.dispose();
  }

  Future<void> _resolve(ConflictResolution resolution, Object? value) async {
    setState(() => _busy = true);
    try {
      await ref
          .read(conflictRepositoryProvider)
          .resolve(widget.conflict.id, resolution, value);
      // Both lists on this page, and — because settling a conflict writes the
      // winning value into the channel — everything anywhere that shows that
      // channel.
      ref.bumpData(const {DataDomain.conflicts, DataDomain.channels});
    } catch (_) {
      if (mounted) {
        AppToast.error(context, widget.l10n.conflictResolveFailed);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = widget.l10n;
    final conflict = widget.conflict;
    final fmt = ref.watch(instantFormatterProvider);
    // Only free text can be usefully hand-merged. Offering a text box for a
    // tag array or a JSON blob would invite somebody to type something the
    // column cannot hold.
    final mergeable = conflict.field == 'notes';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The button sizes to its label, and its label grows with the
            // font slider: in a narrow window at the top of the slider the
            // pair ran 31px past the card. Both sides give ground now, and
            // the heading — which is the longer of the two — gives it first.
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.conflictOnChannel(
                      conflictFieldLabel(l10n, conflict.field),
                      conflict.channelLabel,
                    ),
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                Flexible(
                  child: TextButton(
                    onPressed: () => context.go(
                      AppRoutes.influencerDetail(conflict.channelId),
                    ),
                    child: Text(
                      l10n.conflictOpenChannel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
              ],
            ),
            Text(
              l10n.conflictDetectedAt(fmt.dateTime(conflict.detectedAt)),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),

            // Both versions, then what they started from. The shared base is
            // shown last and quietly: it is the explanation, not the choice.
            _Version(
              title: conflict.theirsActorName == null
                  ? l10n.conflictTheirsUnknown
                  : l10n.conflictTheirsBy(conflict.theirsActorName!),
              value: _asText(conflict.theirsValue),
              l10n: l10n,
              onKeep: _busy
                  ? null
                  : () => _resolve(
                        ConflictResolution.theirs,
                        conflict.theirsValue,
                      ),
              keepLabel: l10n.conflictKeepTheirs,
            ),
            const SizedBox(height: 8),
            _Version(
              title: l10n.conflictMineBy(conflict.mineActorName),
              value: _asText(conflict.mineValue),
              l10n: l10n,
              onKeep: _busy
                  ? null
                  : () => _resolve(ConflictResolution.mine, conflict.mineValue),
              keepLabel: l10n.conflictKeepMine,
            ),
            const SizedBox(height: 12),
            Text(
              '${l10n.conflictBaseWas}: ${_asText(conflict.baseValue)}',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),

            if (mergeable) ...[
              const Divider(height: 24),
              if (!_merging)
                TextButton.icon(
                  onPressed:
                      _busy ? null : () => setState(() => _merging = true),
                  icon: const Icon(Icons.merge, size: 18),
                  label: Text(l10n.conflictMerge),
                )
              else ...[
                Text(l10n.conflictMergeTitle,
                    style: theme.textTheme.labelLarge),
                const SizedBox(height: 4),
                Text(
                  l10n.conflictMergeHint,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _merged,
                  maxLines: 6,
                  decoration: const InputDecoration(
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: FilledButton(
                    onPressed: _busy
                        ? null
                        : () => _resolve(
                              ConflictResolution.merged,
                              _merged.text,
                            ),
                    child: Text(l10n.conflictMergeSave),
                  ),
                ),
              ],
            ],
            if (_busy)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: LinearProgressIndicator(),
              ),
          ],
        ),
      ),
    );
  }
}

class _Version extends StatelessWidget {
  const _Version({
    required this.title,
    required this.value,
    required this.l10n,
    required this.onKeep,
    required this.keepLabel,
  });

  final String title;
  final String value;
  final AppLocalizations l10n;
  final VoidCallback? onKeep;
  final String keepLabel;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: theme.textTheme.labelMedium),
          const SizedBox(height: 6),
          // Selectable: half of resolving one of these is copying a phrase out
          // of one version into the merged one.
          SelectableText(
            value.isEmpty ? l10n.conflictEmptyValue : value,
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: OutlinedButton(onPressed: onKeep, child: Text(keepLabel)),
          ),
        ],
      ),
    );
  }
}

class _ResolvedRow extends ConsumerWidget {
  const _ResolvedRow({required this.conflict, required this.l10n});

  final EditConflict conflict;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final how = switch (conflict.resolution) {
      ConflictResolution.mine =>
        l10n.conflictResolutionMine(conflict.mineActorName),
      ConflictResolution.theirs =>
        l10n.conflictResolutionTheirs(conflict.theirsActorName ?? '—'),
      ConflictResolution.merged => l10n.conflictResolutionMerged,
      null => '',
    };
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(Icons.check_circle_outline,
          size: 18, color: theme.colorScheme.primary),
      title: Text(
        l10n.conflictOnChannel(
          conflictFieldLabel(l10n, conflict.field),
          conflict.channelLabel,
        ),
        style: theme.textTheme.bodyMedium,
      ),
      subtitle: Text(
        '${l10n.conflictResolvedBy(conflict.resolvedByName ?? '—')} · $how'
        '${conflict.resolvedAt == null ? '' : ' · ${fmt.date(conflict.resolvedAt!)}'}',
        style: theme.textTheme.bodySmall,
      ),
    );
  }
}

/// A jsonb value as something readable.
///
/// The values arrive in whatever shape their column has: a String for notes, a
/// List for tags and criteria, a Map for provided data. Rendering them here
/// rather than storing a pre-formatted string keeps the original available to
/// hand straight back to `resolve_edit_conflict`.
String _asText(Object? value) {
  if (value == null) return '';
  if (value is String) return value;
  if (value is List) return value.map(_asText).join(', ');
  if (value is Map) {
    return value.entries.map((e) => '${e.key}: ${_asText(e.value)}').join('\n');
  }
  return value.toString();
}
