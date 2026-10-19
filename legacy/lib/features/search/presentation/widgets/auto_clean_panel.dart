import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/features/search/application/auto_clean_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The standing rule for what a finished run is allowed to throw away.
///
/// Shaped like [SearchSettingsPanel] — a collapsed card whose header says what
/// the current setting is — but the header carries more weight here. The
/// settings panel summarises something you are about to do on purpose; this
/// summarises something that will happen without you, so the collapsed line has
/// to be enough to notice a rule you did not mean to leave on.
///
/// Full authority only, and the caller hides it entirely for everyone else. The
/// database refuses the sweep regardless, so a rule a `basic` account could
/// switch on would be a switch that quietly does nothing.
class AutoCleanPanel extends ConsumerStatefulWidget {
  const AutoCleanPanel({super.key});

  @override
  ConsumerState<AutoCleanPanel> createState() => _AutoCleanPanelState();
}

class _AutoCleanPanelState extends ConsumerState<AutoCleanPanel> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final rule = ref.watch(autoCleanRuleProvider);
    final report = ref.watch(autoCleanRunnerProvider);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          InkWell(
            onTap: () => setState(() => _expanded = !_expanded),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  // Filled and colored while the rule is live. This is the one
                  // control on the page that acts on its own, and "on" has to
                  // be readable at a glance from the collapsed header.
                  Icon(
                    rule.isActive
                        ? Icons.auto_delete
                        : Icons.auto_delete_outlined,
                    size: 20,
                    color: rule.isActive
                        ? theme.colorScheme.error
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.searchAutoCleanTitle,
                            style: theme.textTheme.titleMedium),
                        Text(
                          autoCleanSummary(l10n, rule),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: rule.isActive
                                ? theme.colorScheme.error
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 180),
                    child: const Icon(Icons.expand_more),
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            firstChild: const SizedBox(width: double.infinity, height: 0),
            secondChild: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: _RuleFields(rule: rule),
            ),
            crossFadeState: _expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 180),
            sizeCurve: Curves.easeOutCubic,
          ),
          // Outside the fold: what the last run actually did. An action nobody
          // authorised in the moment has to leave a trace on the screen it was
          // configured on, or the only evidence it happened is channels quietly
          // missing from a list somewhere else.
          if (report != null) _LastRunLine(report: report, l10n: l10n),
        ],
      ),
    );
  }
}

/// The collapsed line. Says what will happen in words, not as a set of
/// fields — "off" and "under 1,000 subscribers and under 500 average views"
/// are the two things worth reading without opening anything.
///
/// Top-level so other surfaces can show the same words rather than a generic
/// "auto-clean is on" — see [autoCleanCompactSummary] for the shorter form
/// the search-settings AppBar button uses.
String autoCleanSummary(AppLocalizations l10n, AutoCleanRule rule) {
  if (!rule.enabled) return l10n.searchAutoCleanOff;
  if (!rule.hasBounds) return l10n.searchAutoCleanNoBounds;

  // Both ranges are keep bands — a channel outside either one is cleaned.
  final keep = <String>[
    if (rule.hasSubscriberRange)
      _autoCleanRange(l10n, l10n.searchAutoCleanSubscribersWord,
          rule.minSubscribers, rule.maxSubscribers),
    if (rule.minMedianViews != null || rule.maxMedianViews != null)
      _autoCleanRange(l10n, l10n.searchAutoCleanAvgViewsWord,
          rule.minMedianViews, rule.maxMedianViews),
  ];

  // A videos-floor-only rule has no band to keep; it reads the way the whole
  // rule used to.
  if (keep.isEmpty) {
    return l10n.searchAutoCleanRejectsSummary(
        l10n.searchAutoCleanFewerVideos(rule.minVideosLast30!));
  }

  final parts = <String>[
    l10n.searchAutoCleanKeepSummary(keep.join(l10n.searchAutoCleanAnd)),
  ];
  if (rule.minSubscribers != null) {
    parts.add(l10n.searchAutoCleanGateBelow(
        _autoCleanActionWord(l10n, rule.belowMinAction)));
  }
  if (rule.maxSubscribers != null) {
    parts.add(l10n.searchAutoCleanGateAbove(
        _autoCleanActionWord(l10n, rule.aboveMaxAction)));
  }
  if (rule.minVideosLast30 != null) {
    parts.add(l10n.searchAutoCleanAlsoRejects(
        l10n.searchAutoCleanFewerVideos(rule.minVideosLast30!)));
  }
  return parts.join(' · ');
}

/// The collapsed line shown elsewhere (the search-settings button in the
/// AppBar) when this rule is live: just the keep-band ranges, joined by
/// "&" — none of the gate/reject wording [autoCleanSummary] carries, because
/// that button has no room for more than the ranges themselves. Empty when
/// there is nothing worth showing (off, or on with no bounds set).
String autoCleanCompactSummary(AppLocalizations l10n, AutoCleanRule rule) {
  if (!rule.enabled || !rule.hasBounds) return '';
  final keep = <String>[
    if (rule.hasSubscriberRange)
      _autoCleanRange(l10n, l10n.searchAutoCleanSubscribersWord,
          rule.minSubscribers, rule.maxSubscribers),
    if (rule.minMedianViews != null || rule.maxMedianViews != null)
      _autoCleanRange(l10n, l10n.searchAutoCleanAvgViewsWord,
          rule.minMedianViews, rule.maxMedianViews),
  ];
  return keep.join(' & ');
}

String _autoCleanActionWord(
        AppLocalizations l10n, AutoCleanBandAction action) =>
    switch (action) {
      AutoCleanBandAction.sweep => l10n.searchAutoCleanActionSweep,
      AutoCleanBandAction.delay => l10n.searchAutoCleanActionDelay,
      AutoCleanBandAction.off => l10n.searchAutoCleanActionOff,
    };

String _autoCleanActionOption(
        AppLocalizations l10n, AutoCleanBandAction action) =>
    switch (action) {
      AutoCleanBandAction.sweep => l10n.searchAutoCleanActionSweepOption,
      AutoCleanBandAction.delay => l10n.searchAutoCleanActionDelayOption,
      AutoCleanBandAction.off => l10n.searchAutoCleanActionOffOption,
    };

String _autoCleanRange(AppLocalizations l10n, String what, int? min, int? max) {
  if (min != null && max != null) {
    return l10n.searchAutoCleanBetween(what, min, max);
  }
  if (max != null) return l10n.searchAutoCleanUnder(what, max);
  return l10n.searchAutoCleanOver(what, min!);
}

class _RuleFields extends ConsumerWidget {
  const _RuleFields({required this.rule});

  final AutoCleanRule rule;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final notifier = ref.read(autoCleanRuleProvider.notifier);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.searchAutoCleanBody,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 12),
        SwitchListTile(
          value: rule.enabled,
          onChanged: notifier.setEnabled,
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: Text(l10n.searchAutoCleanEnable),
          subtitle: Text(
            l10n.searchAutoCleanEnableHint,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        const SizedBox(height: 12),

        // ---- Subscriber range (a keep band) ----
        _SectionTitle(l10n.searchAutoCleanSubsSectionTitle,
            theme: theme, tooltip: l10n.searchAutoCleanKeepBandTip),
        const SizedBox(height: 8),
        _BoundRow(
          minLabel: l10n.searchAutoCleanKeepMinLabel,
          maxLabel: l10n.searchAutoCleanKeepMaxLabel,
          min: rule.minSubscribers,
          max: rule.maxSubscribers,
          onMinChanged: notifier.setMinSubscribers,
          onMaxChanged: notifier.setMaxSubscribers,
        ),
        const SizedBox(height: 12),
        // What the run does with a channel on each side of that band.
        Row(
          children: [
            Expanded(
              child: _BandActionField(
                label: l10n.searchAutoCleanBelowMinLabel,
                value: rule.belowMinAction,
                onChanged: notifier.setBelowMinAction,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _BandActionField(
                label: l10n.searchAutoCleanAboveMaxLabel,
                value: rule.aboveMaxAction,
                onChanged: notifier.setAboveMaxAction,
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        // Spells out, line by line, what each action actually does.
        _Note(text: l10n.searchAutoCleanActionSweepNote, theme: theme),
        const SizedBox(height: 4),
        _Note(text: l10n.searchAutoCleanActionDelayNote, theme: theme),
        const SizedBox(height: 4),
        _Note(text: l10n.searchAutoCleanActionOffNote, theme: theme),
        const SizedBox(height: 16),

        // ---- Average-views range (also a keep band) ----
        _SectionTitle(l10n.searchAutoCleanAvgSectionTitle,
            theme: theme, tooltip: l10n.searchAutoCleanKeepBandTip),
        const SizedBox(height: 8),
        _BoundRow(
          minLabel: l10n.searchAutoCleanKeepAvgMinLabel,
          maxLabel: l10n.searchAutoCleanKeepAvgMaxLabel,
          min: rule.minMedianViews,
          max: rule.maxMedianViews,
          onMinChanged: notifier.setMinMedianViews,
          onMaxChanged: notifier.setMaxMedianViews,
        ),
        const SizedBox(height: 8),
        _Note(text: l10n.searchAutoCleanAvgNote, theme: theme),
        // House choice HC-18: the owner's standing answer, one press away.
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton.icon(
            onPressed: notifier.applyHouseViewBar,
            icon: const Icon(Icons.rule),
            label: Text(l10n.searchAutoCleanHousePreset),
          ),
        ),
        const SizedBox(height: 16),

        // ---- Activity floor ----
        _BoundField(
          label: l10n.searchAutoCleanMinVideosLabel,
          value: rule.minVideosLast30,
          onChanged: notifier.setMinVideosLast30,
        ),
        const SizedBox(height: 6),
        Text(
          l10n.searchAutoCleanMinVideosHint,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          // Said outright, because a rule that runs by itself cannot rely on
          // anyone re-reading it: with no range set there is nothing to keep,
          // so nothing to clean.
          rule.hasBounds
              ? l10n.searchAutoCleanBoundsHint
              : l10n.searchAutoCleanNeedsBound,
          style: theme.textTheme.bodySmall?.copyWith(
            color: rule.hasBounds
                ? theme.colorScheme.onSurfaceVariant
                : theme.colorScheme.error,
          ),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<ChannelTag>(
          initialValue: rule.label,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: l10n.archiveBulkCleanLabelLabel,
            isDense: true,
            border: const OutlineInputBorder(),
          ),
          // Only the rejecting tags — the archive's own check constraint allows
          // nothing else.
          items: [
            for (final tag in ChannelTag.rejecting)
              DropdownMenuItem(
                value: tag,
                child: Text(tag.label(l10n), overflow: TextOverflow.ellipsis),
              ),
          ],
          onChanged: (tag) {
            if (tag != null) notifier.setLabel(tag);
          },
        ),
        const SizedBox(height: 12),
        // The two limits worth stating, because they are what makes an
        // unattended sweep defensible rather than reckless.
        _Note(text: l10n.searchAutoCleanScopeNote, theme: theme),
        const SizedBox(height: 6),
        _Note(text: l10n.searchAutoCleanGraceNote, theme: theme),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {required this.theme, this.tooltip});

  final String text;
  final ThemeData theme;

  /// The one-line "what does this range mean" tip, shown on an info icon beside
  /// the heading.
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final title = Text(
      text,
      style: theme.textTheme.labelLarge?.copyWith(
        color: theme.colorScheme.onSurface,
        fontWeight: FontWeight.w600,
      ),
    );
    if (tooltip == null) return title;
    return Row(
      children: [
        Flexible(child: title),
        const SizedBox(width: 6),
        Tooltip(
          message: tooltip,
          triggerMode: TooltipTriggerMode.tap,
          showDuration: const Duration(seconds: 8),
          child: Icon(Icons.info_outline,
              size: 15, color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.text, required this.theme});

  final String text;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline,
            size: 14, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}

/// What the last automatic sweep did.
class _LastRunLine extends StatelessWidget {
  const _LastRunLine({required this.report, required this.l10n});

  final AutoCleanReport report;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final failed = report.failed;
    final outcome = report.outcome;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
      color: failed
          ? theme.colorScheme.errorContainer
          : theme.colorScheme.surfaceContainerHighest,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            failed ? Icons.error_outline : Icons.check_circle_outline,
            size: 16,
            color: failed
                ? theme.colorScheme.onErrorContainer
                : theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  failed || outcome == null
                      ? l10n.searchAutoCleanFailed
                      : l10n.searchAutoCleanRan(outcome.tagged),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: failed
                        ? theme.colorScheme.onErrorContainer
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                // The count that explains a disappointing first number.
                //
                // `avg_views_last_30` is null for any channel whose recent
                // uploads have never been read, and the RPC treats a channel
                // missing a number the bounds need as unknown-size rather than
                // out of range — so an average-views bound silently declines to
                // tag it. With most of a fresh roster unmeasured, "0 channels
                // tagged" reads as a broken rule when it is really the rule
                // saying it cannot answer the question yet. It carried this
                // number all along and never showed it.
                if (!failed &&
                    outcome != null &&
                    outcome.skippedUnknownSize > 0)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      l10n.searchAutoCleanSkippedUnknown(
                        outcome.skippedUnknownSize,
                      ),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// What the run does with a channel in one out-of-range band.
class _BandActionField extends StatelessWidget {
  const _BandActionField({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final AutoCleanBandAction value;
  final ValueChanged<AutoCleanBandAction> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return DropdownButtonFormField<AutoCleanBandAction>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      items: [
        for (final action in AutoCleanBandAction.values)
          DropdownMenuItem(
            value: action,
            child: Text(_autoCleanActionOption(l10n, action),
                overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: (action) {
        if (action != null) onChanged(action);
      },
    );
  }
}

/// One range: two bounds side by side.
class _BoundRow extends StatelessWidget {
  const _BoundRow({
    required this.minLabel,
    required this.maxLabel,
    required this.min,
    required this.max,
    required this.onMinChanged,
    required this.onMaxChanged,
  });

  final String minLabel;
  final String maxLabel;
  final int? min;
  final int? max;
  final ValueChanged<int?> onMinChanged;
  final ValueChanged<int?> onMaxChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _BoundField(
            label: minLabel,
            value: min,
            onChanged: onMinChanged,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _BoundField(
            label: maxLabel,
            value: max,
            onChanged: onMaxChanged,
          ),
        ),
      ],
    );
  }
}

/// A bound where an empty box means "no limit on this side".
///
/// Stateful with its own controller rather than rebuilt from [value] every
/// frame: the value is written back to persistent storage as you type, and
/// feeding the parsed number back into the field is what makes a text field
/// jump the cursor to the end after every keystroke.
class _BoundField extends StatefulWidget {
  const _BoundField({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final int? value;
  final ValueChanged<int?> onChanged;

  @override
  State<_BoundField> createState() => _BoundFieldState();
}

class _BoundFieldState extends State<_BoundField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value?.toString() ?? '');

  @override
  void didUpdateWidget(_BoundField oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Only follow a change that came from somewhere else — the rule being
    // loaded from disk on a cold start. A value that already matches what is
    // typed is left alone, cursor intact.
    final incoming = widget.value?.toString() ?? '';
    if (widget.value != oldWidget.value && incoming != _controller.text) {
      _controller.text = incoming;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      keyboardType: TextInputType.number,
      // Digits only at the keystroke, not validated afterwards: a bound with a
      // stray character in it is the exact input whose silent reinterpretation
      // a rule that runs unattended cannot afford.
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(
        labelText: widget.label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: (text) {
        final trimmed = text.trim();
        widget.onChanged(trimmed.isEmpty ? null : int.tryParse(trimmed));
      },
    );
  }
}
