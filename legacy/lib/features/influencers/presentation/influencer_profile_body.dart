import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/widgets/notes_card.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_history_card.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/archive_pending_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_activity_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/channel_header_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/conflict_banner_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/creator_prescreen_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/crm_calculator_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_contacts_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/influencer_emails_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/manual_engagement_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/media_kit_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/pipeline_stage_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/provided_data_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/rate_history_card.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/recent_videos_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The scrolling stack of channel-detail cards, with no [Scaffold] chrome of
/// its own.
///
/// Split out of [InfluencerProfileScreen] so the exact same page can render in
/// two places: the standalone route, and docked beside the composer on the
/// Outreach page. The standalone screen keeps the [AppBar] and passes
/// [withEditingScope] `true`; the Outreach pane passes `false` so it does not
/// raise a *second* [EditingScope] claim on `('channel', influencerId)` while
/// the routed screen is still alive in its branch's `IndexedStack`.
///
/// Presence is announced ONCE, for the whole channel, by the [EditingScope]
/// wrapping the body — and shown once, as a border around the header card and
/// as avatars beside the channel name. It used to be announced at field level
/// on the notes box and drawn as a border around that box, which said the wrong
/// thing twice: it made the notes field look like the contested resource when
/// the contested resource is the channel, and a colored rectangle around a
/// text field reads as a validation error rather than as a colleague.
class InfluencerProfileBody extends ConsumerWidget {
  const InfluencerProfileBody({
    super.key,
    required this.influencerId,
    this.withEditingScope = true,
    this.padding = const EdgeInsets.all(20),
  });

  final String influencerId;

  /// Whether to announce channel-level editing presence from here. `true` for
  /// the standalone screen; `false` anywhere the same channel is already scoped
  /// by a live [InfluencerProfileScreen] elsewhere in the widget tree.
  final bool withEditingScope;

  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final influencerAsync = ref.watch(influencerByIdProvider(influencerId));

    return influencerAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stackTrace) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.commonError),
            TextButton(
              onPressed: () =>
                  ref.invalidate(influencerByIdProvider(influencerId)),
              child: Text(l10n.commonRetry),
            ),
          ],
        ),
      ),
      data: (influencer) {
        if (influencer == null) {
          return Center(child: Text(l10n.influencerNotFound));
        }
        final body = SingleChildScrollView(
          padding: padding,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ChannelHeaderCard(influencer: influencer, l10n: l10n),
              // Above everything editable, because it is a warning about what
              // editing means right now: somebody's version of one of these
              // fields was refused and is still waiting. Renders to nothing
              // when there is no open conflict, which is the usual case — and
              // carries its own leading gap, so a page with no conflict has no
              // stray space where it would have been.
              ConflictBannerCard(influencerId: influencer.id, l10n: l10n),
              // A channel scheduled for deletion is the next most important
              // thing on the page, and likewise renders to nothing when there
              // is no such schedule.
              if (influencer.isPendingArchive) ...[
                const SizedBox(height: 16),
                ArchivePendingCard(influencer: influencer, l10n: l10n),
              ],
              const SizedBox(height: 16),
              PipelineStageCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              // Is this creator worth reaching out to: views against the
              // house bar, uploads, sponsorships, the creator flag, gold mine.
              CreatorPrescreenCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              // How to reach them sits high: on most visits the question is
              // "can I contact this person", and an address found three
              // scrolls down is an address someone gives up looking for.
              InfluencerContactsCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              // Audience, rates, and whether they may go into a brand pitch.
              MediaKitCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              // Expanded by default — this is the page's evidence.
              RecentVideosCard(
                influencerId: influencerId,
                handle: influencer.handle,
                l10n: l10n,
                detailsPending: influencer.detailsPending,
              ),
              const SizedBox(height: 16),
              // Folded by default, and it now carries the "pull more
              // videos" action that used to be its own card above it.
              CrmCalculatorCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              // Wave 2: manual engagement stats
              ManualEngagementCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              ProvidedDataCard(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              _RelevanceCriteriaEditor(influencer: influencer, l10n: l10n),
              const SizedBox(height: 16),
              NotesCard(
                initialText: influencer.notes,
                hintText: l10n.influencerProfileNotesHint,
                // On failure the typed text is deliberately left in the field
                // rather than reverted. It is unsaved, the message says so, and
                // discarding what someone just wrote because the network dropped
                // would be the worse of the two wrongs. Before the guard existed
                // this path reported nothing at all, so the text staying put
                // read as a successful save.
                onSave: (after) {
                  final before = influencer.notes;
                  return guardInfluencerMutation(
                    context,
                    ref,
                    influencer,
                    action: () =>
                        ref.read(influencerRepositoryProvider).updateNotes(
                              influencer.id,
                              after,
                              base: before,
                            ),
                    // The log records that the notes changed and by how many
                    // characters — never what they now say. See
                    // ActivityLogger.channelNotesChanged.
                    log: (logger) => logger.channelNotesChanged(
                      influencer,
                      before: before,
                      after: after,
                    ),
                    successMessage: l10n.influencerProfileNotesSaved,
                  );
                },
              ),
              const SizedBox(height: 16),
              InfluencerEmailsCard(influencerId: influencerId, l10n: l10n),
              const SizedBox(height: 16),
              ChannelActivityCard(influencerId: influencerId, l10n: l10n),
              const SizedBox(height: 16),
              DealHistoryCard.forInfluencer(influencerId),
              const SizedBox(height: 16),
              // What this channel has actually gone for before, for pricing
              // the next proposal — see RateHistoryCard's own doc comment.
              RateHistoryCard(channelId: influencerId),
            ],
          ),
        );
        if (!withEditingScope) return body;
        return EditingScope(
          target: EditingTarget(type: 'channel', id: influencerId),
          child: body,
        );
      },
    );
  }
}

class _RelevanceCriteriaEditor extends ConsumerStatefulWidget {
  const _RelevanceCriteriaEditor({
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  ConsumerState<_RelevanceCriteriaEditor> createState() =>
      _RelevanceCriteriaEditorState();
}

class _RelevanceCriteriaEditorState
    extends ConsumerState<_RelevanceCriteriaEditor> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save(List<String> updated) {
    final influencer = widget.influencer;
    final before = influencer.relevanceCriteria;
    return guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () => ref
          .read(influencerRepositoryProvider)
          .updateRelevanceCriteria(influencer.id, updated, base: before),
      log: (logger) => logger.channelRelevanceCriteriaChanged(
        influencer,
        before: before,
        after: updated,
      ),
    );
  }

  Future<void> _addCriterion() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    await _save([...widget.influencer.relevanceCriteria, text]);
  }

  Future<void> _removeCriterion(String criterion) {
    return _save([
      for (final existing in widget.influencer.relevanceCriteria)
        if (existing != criterion) existing,
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.influencerProfileRelevanceCriteriaTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final criterion in widget.influencer.relevanceCriteria)
                  Chip(
                    label: Text(criterion),
                    onDeleted: () => _removeCriterion(criterion),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      hintText: l10n.influencerProfileRelevanceCriteriaHint,
                      isDense: true,
                    ),
                    onSubmitted: (_) => _addCriterion(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _addCriterion,
                  child: Text(l10n.influencerProfileAddCriterion),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Free-text notes about the channel.
///
/// No presence border and no field-level announcement here any more — both
/// moved to the header card. See [InfluencerProfileBody]'s doc comment.
