import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/core/widgets/collapsible_card.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/crm_calculator.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/widgets/pull_more_videos_card.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// What one video on this channel is worth, from a basis the user chooses.
///
/// The video list is the point of the card, not a detail of it. Which uploads
/// belong in the basis is a judgement — a viral outlier, a collaboration, a
/// video from before the channel changed direction — and the number is only
/// defensible to a brand if whoever quoted it can say what went into it. So
/// every video is listed with a checkbox and its three relevant facts (views,
/// date, a short title), and the figures above recompute as they are ticked.
///
/// Two things about this card were changed on the owner's instruction, and both
/// come from the same fact: a search stores roughly the last month of uploads,
/// so the basis is thin unless somebody widens it.
///
///   * It states what it is calculating from, in the header, in both the open
///     and folded states. A median with no stated basis is a number that gets
///     quoted; a median labelled "based on 4 stored uploads" is a number that
///     gets checked first.
///   * The action that widens the basis is INSIDE the card rather than in a
///     separate one above it. It used to be its own card, which put the fix for
///     the calculator's one real weakness somewhere you had to already know to
///     look.
///
/// Starts folded. It is a tool you reach for when a price comes up, not
/// something you read on the way past — and open, it is the tallest thing on
/// the page by a wide margin, pushing the notes and contacts below the fold on
/// every visit that was not about pricing.
class CrmCalculatorCard extends ConsumerStatefulWidget {
  const CrmCalculatorCard({
    super.key,
    required this.influencer,
    required this.l10n,
  });

  final Influencer influencer;
  final AppLocalizations l10n;

  @override
  ConsumerState<CrmCalculatorCard> createState() => _CrmCalculatorCardState();
}

class _CrmCalculatorCardState extends ConsumerState<CrmCalculatorCard> {
  /// Null until the video list first arrives, which is what distinguishes
  /// "not initialised yet" from "the user deliberately unticked everything".
  Set<String>? _included;

  /// Videos the user has explicitly unticked, remembered so that refreshing
  /// the list does not silently tick them again.
  final Set<String> _everDeselected = {};

  final _priceController = TextEditingController();
  final _cpmController = TextEditingController();

  /// The agency's commission, as a percentage of the deal price. Not part of
  /// the price/CPM two-way binding — it divides the price rather than deriving
  /// it, so typing here never moves either of the other two boxes.
  final _cutController = TextEditingController();

  /// Guards the two-way binding between price and CPM: writing one computes
  /// the other, and without this that write would bounce straight back.
  bool _syncing = false;

  /// Which row of the HC-05 table the slider moves within.
  NicheCpm _niche = kDefaultCpmNiche;

  @override
  void dispose() {
    _priceController.dispose();
    _cpmController.dispose();
    _cutController.dispose();
    super.dispose();
  }

  void _syncFromPrice(CrmEstimate estimate) {
    if (_syncing) return;
    _syncing = true;
    final price = double.tryParse(_priceController.text.trim());
    final cpm = price == null ? null : estimate.cpmAt(price);
    _cpmController.text = cpm == null ? '' : cpm.toStringAsFixed(2);
    _syncing = false;
  }

  void _syncFromCpm(CrmEstimate estimate) {
    if (_syncing) return;
    _syncing = true;
    final cpm = double.tryParse(_cpmController.text.trim());
    final price = cpm == null ? null : estimate.priceAtCpm(cpm);
    _priceController.text = price == null ? '' : price.toStringAsFixed(0);
    _syncing = false;
  }

  /// The commission split implied by whatever is currently in the price and
  /// cut boxes, or null while either is empty or nonsensical.
  CommissionSplit? get _split => computeCommissionSplit(
        price: double.tryParse(_priceController.text.trim()),
        percent: double.tryParse(_cutController.text.trim()),
      );

  /// The ticked set, grown to include usable videos that have arrived since.
  ///
  /// Refreshing the list (a backfill, a re-fetch) brings in videos this
  /// selection has never seen. Ticking the new usable ones — rather than
  /// rebuilding the whole selection — keeps the user's deselections intact
  /// while still counting what just arrived.
  Set<String> _selectionFor(List<Video> videos) {
    final selection = _included ??= defaultCrmSelection(videos);
    for (final video in videos) {
      if (video.viewCount != null &&
          !selection.contains(video.id) &&
          !_everDeselected.contains(video.id)) {
        selection.add(video.id);
      }
    }
    return selection;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = widget.l10n;
    final videosAsync =
        ref.watch(videosByInfluencerProvider(widget.influencer.id));

    // Computed here rather than inside the body builder, so the header and the
    // folded summary can say what the basis is WITHOUT the body having to have
    // been built once — which, on a card that starts folded, it never has.
    final videos =
        videosAsync.maybeWhen(data: (list) => list, orElse: () => null);
    final estimate = videos == null
        ? null
        : computeCrmEstimate(all: videos, includedIds: _selectionFor(videos));

    return CollapsibleCard(
      title: l10n.influencerProfileCrmTitle,
      initiallyExpanded: false,
      subtitle: estimate == null ? null : _basisLine(estimate, l10n),
      collapsedSummary: estimate == null || estimate.isEmpty
          ? null
          : Text(
              '${l10n.influencerProfileCrmMedian}: '
              '${formatCount(estimate.medianViews.round(), locale: l10n.localeName)}',
            ),
      child: videosAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (error, stackTrace) => Text(l10n.commonError),
        data: (videos) => _buildBody(context, videos, estimate!),
      ),
    );
  }

  /// "Based on 12 stored uploads · covering 34 days".
  ///
  /// The span matters as much as the count: twelve uploads across three weeks
  /// and twelve across two years describe very different channels, and only one
  /// of them predicts what the next video will do.
  String _basisLine(CrmEstimate estimate, AppLocalizations l10n) {
    final parts = <String>[
      l10n.influencerProfileCrmBasisCount(estimate.includedCount),
      if (estimate.spanDays != null)
        l10n.influencerProfileCrmSpanDays(estimate.spanDays!),
    ];
    return parts.join('  ·  ');
  }

  Widget _buildBody(
    BuildContext context,
    List<Video> videos,
    CrmEstimate estimate,
  ) {
    final l10n = widget.l10n;
    final selection = _selectionFor(videos);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // The split sits at the top, above everything the number is derived
        // from. Once a price is on the table this is the line the card is
        // actually opened for, and it should not be at the bottom of a list of
        // videos.
        _SplitBanner(split: _split, l10n: l10n),
        const SizedBox(height: 12),
        // Where the number comes from, stated before the number itself. This
        // is the owner's instruction made concrete: the calculator runs on the
        // videos gathered so far, which is about a month's worth, and the way
        // to widen it is right below.
        Text(
          l10n.influencerProfileCrmBasisWindow,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
        const SizedBox(height: 8),
        PullMoreVideosSection(
          influencer: widget.influencer,
          l10n: l10n,
        ),
        const Divider(height: 28),
        if (videos.isEmpty)
          Text(l10n.influencerProfileNoVideos)
        else ...[
          if (estimate.isEmpty)
            Text(
              l10n.influencerProfileCrmEmpty,
              style: Theme.of(context).textTheme.bodySmall,
            )
          else ...[
            _Figures(estimate: estimate, l10n: l10n),
            if (estimate.skew > 0.25) ...[
              const SizedBox(height: 8),
              _SkewWarning(text: l10n.influencerProfileCrmSkewWarning),
            ],
            const SizedBox(height: 16),
            _PriceRow(
              priceController: _priceController,
              cpmController: _cpmController,
              cutController: _cutController,
              // Each of these rebuilds the card as well as syncing, because
              // the banner at the top reads straight off the controllers.
              onPriceChanged: () => setState(() => _syncFromPrice(estimate)),
              onCpmChanged: () => setState(() => _syncFromCpm(estimate)),
              onCutChanged: () => setState(() {}),
              l10n: l10n,
            ),
            const SizedBox(height: 16),
            _NicheCpmPanel(
              niche: _niche,
              estimate: estimate,
              cpm: double.tryParse(_cpmController.text.trim()),
              l10n: l10n,
              onNiche: (niche) => setState(() => _niche = niche),
              onCpm: (cpm) => setState(() {
                _cpmController.text = cpm.toStringAsFixed(2);
                _syncFromCpm(estimate);
              }),
            ),
          ],
          const SizedBox(height: 16),
          // A Wrap, not a Row. The count and the two buttons do not fit on one
          // line at phone width, and a Row cannot shrink a TextButton below its
          // label — it overflows instead.
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                l10n.influencerProfileCrmIncluded(estimate.includedCount),
                style: Theme.of(context).textTheme.labelLarge,
              ),
              TextButton(
                onPressed: () => setState(() {
                  _everDeselected.clear();
                  _included = defaultCrmSelection(videos);
                }),
                child: Text(l10n.influencerProfileCrmSelectAll),
              ),
              TextButton(
                onPressed: () => setState(() {
                  _everDeselected.addAll(selection);
                  _included = <String>{};
                }),
                child: Text(l10n.influencerProfileCrmSelectNone),
              ),
            ],
          ),
          if (estimate.unusableCount > 0)
            Text(
              // Stated, not hidden: a basis of 4 videos out of 15 is a much
              // weaker number than one of 15, and the difference has to be
              // visible next to the figure it produced.
              l10n.influencerProfileCrmUnusable(estimate.unusableCount),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.error,
                  ),
            ),
          const SizedBox(height: 8),
          for (final video in videos)
            _VideoRow(
              video: video,
              selected: selection.contains(video.id),
              l10n: l10n,
              onChanged: (checked) => setState(() {
                if (checked) {
                  selection.add(video.id);
                  _everDeselected.remove(video.id);
                } else {
                  selection.remove(video.id);
                  _everDeselected.add(video.id);
                }
              }),
            ),
        ],
      ],
    );
  }
}

/// Who earns what out of the price, at the commission the user typed.
///
/// Shown whether or not it has an answer yet: the price and cut boxes are far
/// below the fold of an open card, and a banner that only materialises once
/// they are both filled gives no clue that filling them is possible.
class _SplitBanner extends StatelessWidget {
  const _SplitBanner({required this.split, required this.l10n});

  final CommissionSplit? split;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final split = this.split;
    final locale = l10n.localeName;

    if (split == null) {
      return Text(
        l10n.influencerProfileCrmSplitHint,
        style: theme.textTheme.bodySmall
            ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // A Wrap so the two halves stack instead of overflowing once the
          // figures get long — a six-figure deal in a narrow column otherwise
          // pushes the second one off the card.
          Wrap(
            spacing: 28,
            runSpacing: 10,
            children: [
              _SplitFigure(
                label: l10n.influencerProfileCrmSplitYours,
                value: formatCurrency(split.yours, locale: locale),
                emphasised: true,
              ),
              _SplitFigure(
                label: l10n.influencerProfileCrmSplitTheirs,
                value: formatCurrency(split.theirs, locale: locale),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // The inputs restated under the result, so the figures can be read
          // out to someone without scrolling back down to check what they were
          // calculated from.
          Text(
            l10n.influencerProfileCrmSplitOf(
              formatCurrency(split.price, locale: locale),
              formatMoney(split.percent, locale: locale),
            ),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onPrimaryContainer.withValues(
                alpha: 0.75,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _SplitFigure extends StatelessWidget {
  const _SplitFigure({
    required this.label,
    required this.value,
    this.emphasised = false,
  });

  final String label;
  final String value;
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onContainer = theme.colorScheme.onPrimaryContainer;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: onContainer.withValues(alpha: 0.75)),
        ),
        Text(
          value,
          style: (emphasised
                  ? theme.textTheme.headlineSmall
                  : theme.textTheme.titleLarge)
              ?.copyWith(color: onContainer),
        ),
      ],
    );
  }
}

class _Figures extends StatelessWidget {
  const _Figures({required this.estimate, required this.l10n});

  final CrmEstimate estimate;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final locale = l10n.localeName;
    return Wrap(
      spacing: 24,
      runSpacing: 12,
      children: [
        _Figure(
          label: l10n.influencerProfileCrmMedian,
          value: formatCount(estimate.medianViews.round(), locale: locale),
          emphasised: true,
        ),
        _Figure(
          label: l10n.influencerProfileCrmAverage,
          value: formatCount(estimate.averageViews.round(), locale: locale),
        ),
        _Figure(
          label: l10n.influencerProfileCrmRange,
          value: '${formatCompact(estimate.minViews, locale: locale)}'
              ' – ${formatCompact(estimate.maxViews, locale: locale)}',
        ),
        if (estimate.uploadsPerMonth != null)
          _Figure(
            label: l10n.influencerProfileCrmUploadRate,
            value: estimate.uploadsPerMonth!.toStringAsFixed(1),
          ),
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({
    required this.label,
    required this.value,
    this.emphasised = false,
  });

  final String label;
  final String value;
  final bool emphasised;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value,
          style: emphasised
              ? theme.textTheme.headlineSmall
                  ?.copyWith(color: theme.colorScheme.primary)
              : theme.textTheme.titleMedium,
        ),
        Text(label, style: theme.textTheme.bodySmall),
      ],
    );
  }
}

class _SkewWarning extends StatelessWidget {
  const _SkewWarning({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, size: 16, color: theme.colorScheme.tertiary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.tertiary),
          ),
        ),
      ],
    );
  }
}

/// House choice HC-05: the owner's niche CPM table, the prices its range
/// implies for this channel, and a slider to try numbers quickly — sliding
/// writes the CPM box, and the price follows it like a typed CPM would.
class _NicheCpmPanel extends StatelessWidget {
  const _NicheCpmPanel({
    required this.niche,
    required this.estimate,
    required this.cpm,
    required this.l10n,
    required this.onNiche,
    required this.onCpm,
  });

  final NicheCpm niche;
  final CrmEstimate estimate;
  final double? cpm;
  final AppLocalizations l10n;
  final ValueChanged<NicheCpm> onNiche;
  final ValueChanged<double> onCpm;

  String _label(NicheCpm niche) => switch (niche.key) {
        'tech' => l10n.cpmNicheTech,
        'finance' => l10n.cpmNicheFinance,
        'fitness' => l10n.cpmNicheFitness,
        'entertainment' => l10n.cpmNicheEntertainment,
        'gaming' => l10n.cpmNicheGaming,
        'beauty' => l10n.cpmNicheBeauty,
        'travel' => l10n.cpmNicheTravel,
        'education' => l10n.cpmNicheEducation,
        'food' => l10n.cpmNicheFood,
        _ => l10n.cpmNicheLuxury,
      };

  /// Whole dollars: a quote is never "$2,000.40".
  String _usd(double? value) =>
      value == null ? '—' : formatMoney(value.roundToDouble());

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final value =
        (cpm ?? niche.low.toDouble()).clamp(niche.low, niche.high).toDouble();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        DropdownButtonFormField<String>(
          key: const ValueKey('cpm-niche'),
          initialValue: niche.key,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: l10n.cpmNicheLabel,
            isDense: true,
            border: const OutlineInputBorder(),
          ),
          items: [
            for (final row in kNicheCpmRanges)
              DropdownMenuItem(value: row.key, child: Text(_label(row))),
          ],
          onChanged: (key) =>
              onNiche(kNicheCpmRanges.firstWhere((row) => row.key == key)),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.cpmNicheLine(
            _label(niche),
            '${niche.low}',
            '${niche.high}',
            _usd(estimate.priceAtCpm(niche.low)),
            _usd(estimate.priceAtCpm(niche.high)),
          ),
          style: theme.textTheme.bodyMedium,
        ),
        Slider(
          key: const ValueKey('cpm-slider'),
          min: niche.low.toDouble(),
          max: niche.high.toDouble(),
          divisions: niche.high - niche.low,
          value: value,
          label: '\$${value.round()}',
          onChanged: onCpm,
        ),
        Text(
          l10n.cpmSliderHelp,
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

/// Price and CPM, each computed from the other.
///
/// Two boxes rather than one, because the question is asked from both ends: a
/// brand offers a price and you want to know the CPM it implies, or you have a
/// target CPM and want the price to quote.
class _PriceRow extends StatelessWidget {
  const _PriceRow({
    required this.priceController,
    required this.cpmController,
    required this.cutController,
    required this.onPriceChanged,
    required this.onCpmChanged,
    required this.onCutChanged,
    required this.l10n,
  });

  final TextEditingController priceController;
  final TextEditingController cpmController;
  final TextEditingController cutController;
  final VoidCallback onPriceChanged;
  final VoidCallback onCpmChanged;
  final VoidCallback onCutChanged;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: priceController,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp('[0-9.]')),
                ],
                decoration: InputDecoration(
                  labelText: l10n.influencerProfileCrmPrice,
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => onPriceChanged(),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: cpmController,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp('[0-9.]')),
                ],
                decoration: InputDecoration(
                  labelText: l10n.influencerProfileCrmCpm,
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) => onCpmChanged(),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        // Its own row rather than a third box squeezed alongside the other
        // two: at phone width three fields leave no room for a label, and this
        // one is a different kind of number — a term of the deal, not a
        // property of the channel.
        TextField(
          controller: cutController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [
            FilteringTextInputFormatter.allow(RegExp('[0-9.]')),
          ],
          decoration: InputDecoration(
            labelText: l10n.influencerProfileCrmCut,
            isDense: true,
            border: const OutlineInputBorder(),
            suffixText: '%',
          ),
          onChanged: (_) => onCutChanged(),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.influencerProfileCrmCpmExplain,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

/// One selectable video: views, upload date, short title. Nothing else — the
/// card is for choosing a basis, not for browsing the channel. The thumbnails
/// and descriptions live on the Recent uploads card, which is what that card is
/// for.
class _VideoRow extends ConsumerWidget {
  const _VideoRow({
    required this.video,
    required this.selected,
    required this.onChanged,
    required this.l10n,
  });

  final Video video;
  final bool selected;
  final ValueChanged<bool> onChanged;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final usable = video.viewCount != null;
    final fmt = ref.watch(instantFormatterProvider);

    return CheckboxListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      value: usable && selected,
      // A video with no view count cannot contribute to any average, so its
      // checkbox is disabled rather than merely unticked — an unticked box
      // invites a click that would do nothing.
      onChanged: usable ? (checked) => onChanged(checked ?? false) : null,
      title: Text(
        video.title,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: theme.textTheme.bodyMedium,
      ),
      subtitle: Text(
        [
          usable
              ? formatCount(video.viewCount, locale: l10n.localeName)
              : l10n.influencerProfileCrmNoViewCount,
          video.publishedAt == null
              ? l10n.commonUnknown
              : fmt.date(video.publishedAt!),
        ].join('  ·  '),
        style: theme.textTheme.bodySmall?.copyWith(
          color: usable
              ? theme.colorScheme.onSurfaceVariant
              : theme.colorScheme.error,
        ),
      ),
    );
  }
}
