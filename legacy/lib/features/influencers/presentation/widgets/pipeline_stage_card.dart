import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Where this channel stands, and what it is about — both editable.
///
/// The two live in one card because they are constantly confused for each
/// other, and putting them side by side is the clearest way to show they are
/// different questions: the stage is *how far we have got with this person*
/// and there is exactly one; the tags are *what the channel is about* and
/// there can be several.
class PipelineStageCard extends ConsumerWidget {
  const PipelineStageCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final repository = ref.read(influencerRepositoryProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.influencerProfileStageTitle,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            // Field-level presence: two people can work the same profile at
            // once, and this only warns where they would actually collide.
            PresenceBorder(
              type: 'channel',
              id: influencer.id,
              field: 'pipeline_stage',
              child: EditingScope(
                target: EditingTarget(
                  type: 'channel',
                  id: influencer.id,
                  field: 'pipeline_stage',
                ),
                child: DropdownButtonFormField<PipelineStage>(
                  initialValue: influencer.pipelineStage,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.influencerProfileStageLabel,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final stage in PipelineStage.values)
                      DropdownMenuItem(
                        value: stage,
                        child: Text(stage.label(l10n)),
                      ),
                  ],
                  onChanged: (stage) {
                    if (stage == null) return;
                    guardInfluencerMutation(
                      context,
                      ref,
                      influencer,
                      action: () => repository.updatePipelineStage(
                        influencer.id,
                        stage,
                        base: influencer.pipelineStage,
                      ),
                      log: (logger) => logger.channelStageChanged(
                        influencer,
                        before: influencer.pipelineStage,
                        after: stage,
                      ),
                    );
                  },
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              l10n.influencerProfileChannelTagsLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 8),
            _ChannelTagsEditor(
              influencer: influencer,
              l10n: l10n,
              onChanged: (tags) => guardInfluencerMutation(
                context,
                ref,
                influencer,
                action: () => repository.updateChannelTags(
                  influencer.id,
                  tags,
                  base: influencer.channelTags,
                ),
                log: (logger) => logger.channelTagsChanged(
                  influencer,
                  before: influencer.channelTags,
                  after: Influencer.normalizeChannelTags(tags),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A fixed, multi-select set of [ChannelTag] chips — not free text, since the
/// vocabulary is a closed set defined in code (see [ChannelTag]).
class _ChannelTagsEditor extends StatelessWidget {
  const _ChannelTagsEditor({
    required this.influencer,
    required this.l10n,
    required this.onChanged,
  });

  final Influencer influencer;
  final AppLocalizations l10n;
  final ValueChanged<List<ChannelTag>> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final tag in ChannelTag.values)
          FilterChip(
            label: Text(tag.label(l10n)),
            selected: influencer.channelTags.contains(tag),
            onSelected: (selected) => onChanged(
              selected
                  ? [...influencer.channelTags, tag]
                  : [
                      for (final existing in influencer.channelTags)
                        if (existing != tag) existing,
                    ],
            ),
          ),
      ],
    );
  }
}
