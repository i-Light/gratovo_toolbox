import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What a person checks before reaching out to a creator (fix #10): views
/// against the house bar (HC-18), recent uploads, sponsorships seen in the
/// stored videos, country, the creator flag (HC-08), and whether this is a
/// gold mine (HC-04) or has an agent (INF-MGR-05).
///
/// Every status line is an icon AND words, never colour alone.
class CreatorPrescreenCard extends ConsumerWidget {
  const CreatorPrescreenCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  Future<void> _setFlag(
    BuildContext context,
    WidgetRef ref,
    CreatorGender? next,
  ) async {
    final before = influencer.creatorGender;
    if (next == before) return;
    await guardInfluencerMutation(
      context,
      ref,
      influencer,
      action: () => ref
          .read(influencerRepositoryProvider)
          .updateCreatorGender(influencer.id, next, base: before),
      log: (logger) => logger.record(
        ActivityDraft(
          action: ActivityAction.updated,
          entityType: 'channel',
          entityId: influencer.id,
          entityLabel: influencer.handle,
          field: 'creator_gender',
          oldValue: before?.name,
          newValue: next?.name,
        ),
      ),
      successMessage: l10n.creatorFlagSaved,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final locale = l10n.localeName;
    final views = influencer.medianViewsLast30;
    final ratio = influencer.sponsoredRatio;
    final gender = influencer.creatorGender;
    final goldMine = isGoldMine(influencer);
    final agent = hasAgent(influencer);
    final good = theme.colorScheme.primary;
    final warn = theme.colorScheme.error;
    final muted = theme.colorScheme.onSurfaceVariant;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: 8,
          children: [
            Text(l10n.creatorPrescreenTitle,
                style: theme.textTheme.titleMedium),
            if (goldMine) _GoldMine(l10n: l10n),
            if (views == null)
              _Line(
                  Icons.help_outline, muted, l10n.creatorPrescreenViewsUnknown)
            else if (meetsViewBar(influencer))
              _Line(
                Icons.check_circle_outline,
                good,
                l10n.creatorPrescreenViewsMet(
                    formatCompact(views, locale: locale)),
              )
            else
              _Line(
                Icons.trending_down,
                warn,
                l10n.creatorPrescreenViewsBelow(
                    formatCompact(views, locale: locale)),
              ),
            _Line(
              influencer.videosLast30 > 0
                  ? Icons.video_library_outlined
                  : Icons.videocam_off_outlined,
              influencer.videosLast30 > 0 ? muted : warn,
              l10n.creatorPrescreenUploads(influencer.videosLast30),
            ),
            if (ratio == null)
              _Line(Icons.help_outline, muted,
                  l10n.creatorPrescreenSponsorUnknown)
            else if (ratio > 0)
              _Line(
                Icons.handshake_outlined,
                good,
                l10n.creatorPrescreenSponsored((ratio * 100).round()),
              )
            else
              _Line(Icons.handshake_outlined, muted,
                  l10n.creatorPrescreenNotSponsored),
            if (influencer.seenBrands.isNotEmpty)
              _Line(
                Icons.sell_outlined,
                muted,
                l10n.creatorPrescreenBrands(influencer.seenBrands.join(', ')),
              ),
            _Line(
              Icons.public,
              muted,
              (influencer.country ?? '').isEmpty
                  ? l10n.creatorPrescreenCountryUnknown
                  : l10n.creatorPrescreenCountry(influencer.country!),
            ),
            if (agent)
              _Line(Icons.badge_outlined, muted, l10n.creatorPrescreenAgent),
            const SizedBox(height: 4),
            DropdownButtonFormField<CreatorGender?>(
              key: const ValueKey('creator-flag'),
              initialValue: gender,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.creatorFlagLabel,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
              items: [
                DropdownMenuItem(
                    value: null, child: Text(l10n.creatorFlagNotRecorded)),
                DropdownMenuItem(
                    value: CreatorGender.male,
                    child: Text(l10n.creatorFlagMale)),
                DropdownMenuItem(
                    value: CreatorGender.female,
                    child: Text(l10n.creatorFlagFemale)),
                DropdownMenuItem(
                    value: CreatorGender.couple,
                    child: Text(l10n.creatorFlagCouple)),
                DropdownMenuItem(
                    value: CreatorGender.unknown,
                    child: Text(l10n.creatorFlagUnknown)),
              ],
              onChanged: (value) => _setFlag(context, ref, value),
            ),
            if (gender?.outOfScope ?? false)
              _Line(Icons.block, warn, l10n.creatorFlagOutOfScope),
          ],
        ),
      ),
    );
  }
}

/// One status line: an icon that says the same as the words beside it.
class _Line extends StatelessWidget {
  const _Line(this.icon, this.color, this.text);

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(child: Icon(icon, size: 18, color: color)),
        const SizedBox(width: 8),
        Expanded(
          child: Text(text, style: Theme.of(context).textTheme.bodyMedium),
        ),
      ],
    );
  }
}

/// HC-04's highlight: a rare, unmanaged creator worth more than one deal.
class _GoldMine extends StatelessWidget {
  const _GoldMine({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ExcludeSemantics(
            child: Icon(Icons.workspace_premium,
                color: theme.colorScheme.onTertiaryContainer),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.creatorGoldMine,
                  style: theme.textTheme.titleSmall
                      ?.copyWith(color: theme.colorScheme.onTertiaryContainer),
                ),
                const SizedBox(height: 2),
                Text(
                  l10n.creatorGoldMineHelp,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onTertiaryContainer),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
