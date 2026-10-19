import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_deliverables_controller.dart';
import 'package:gratovo_toolbox/features/deals/application/thirty_day_report.dart';
import 'package:gratovo_toolbox/features/deals/application/thirty_day_report_actions.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Opens one deliverable's 30-day report (plan step 7).
Future<void> showThirtyDayReport(
  BuildContext context, {
  required String dealId,
  required String deliverableId,
}) {
  return showDialog<void>(
    context: context,
    builder: (_) =>
        ThirtyDayReportDialog(dealId: dealId, deliverableId: deliverableId),
  );
}

/// Reads the video's views once (kept as the report's snapshot), then shows
/// views, the CPM those views cost the brand, and clicks when the deal has a
/// tracking link. The report goes to the brand, so what is copied or saved
/// is in English whatever language the app is in.
class ThirtyDayReportDialog extends ConsumerStatefulWidget {
  const ThirtyDayReportDialog({
    super.key,
    required this.dealId,
    required this.deliverableId,
  });

  final String dealId;
  final String deliverableId;

  @override
  ConsumerState<ThirtyDayReportDialog> createState() =>
      _ThirtyDayReportDialogState();
}

class _ThirtyDayReportDialogState extends ConsumerState<ThirtyDayReportDialog> {
  final _clicks = TextEditingController();
  bool _busy = false;
  VideoStatsError? _error;
  bool _reminderSet = false;

  static final _english = lookupAppLocalizations(const Locale('en'));

  @override
  void dispose() {
    _clicks.dispose();
    super.dispose();
  }

  /// The display zone's dates, in English, for what goes to the brand.
  InstantFormatter get _englishDates => InstantFormatter(
        locale: 'en',
        clock: ref.read(instantFormatterProvider).clock,
      );

  ThirtyDayReportActions get _actions =>
      ref.read(thirtyDayReportActionsProvider);

  Future<void> _readViews(Deliverable deliverable) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final error = await _actions.takeSnapshot(deliverable);
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _saveClicks(Deliverable deliverable) async {
    final clicks = int.tryParse(_clicks.text.trim());
    if (clicks == null) return;
    await _actions.saveClicks(deliverable, clicks);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final deliverable = ref
        .watch(dealDeliverablesProvider(widget.dealId))
        .value
        ?.where((d) => d.id == widget.deliverableId)
        .firstOrNull;
    final deal = ref.watch(dealByIdProvider(widget.dealId)).value;
    final brand = deal == null
        ? null
        : ref.watch(brandByIdProvider(deal.brandId)).value?.name;
    final creator = deal == null
        ? null
        : ref.watch(influencerByIdProvider(deal.influencerId)).value?.handle;
    final count =
        ref.watch(dealDeliverablesProvider(widget.dealId)).value?.length ?? 1;

    final Widget body;
    if (deliverable == null || deal == null) {
      body = const Center(child: CircularProgressIndicator());
    } else {
      final names = (
        creator: creator ?? deal.influencerId,
        brand: brand ?? deal.brandId,
      );
      body = deliverable.hasReport
          ? _report(
              context,
              ThirtyDayReport.of(
                deal: deal,
                deliverable: deliverable,
                deliverableCount: count,
                creator: names.creator,
                brand: names.brand,
              ),
              deal,
              deliverable,
            )
          : _beforeSnapshot(context, deliverable, names);
    }

    return AlertDialog(
      title: Text(l10n.reportTitle),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 560),
        child: SingleChildScrollView(child: body),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonClose),
        ),
      ],
    );
  }

  Widget _beforeSnapshot(
    BuildContext context,
    Deliverable deliverable,
    ({String creator, String brand}) names,
  ) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final fmt = ref.watch(instantFormatterProvider);
    final due = deliverable.reportDueAt;
    final hasLink = (deliverable.publishedUrl?.trim() ?? '').isNotEmpty;
    final error = _error;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 12,
      children: [
        Text(
          l10n.reportTextHeading(names.creator, names.brand),
          style: theme.textTheme.titleMedium,
        ),
        if (!hasLink) Text(l10n.reportNeedsLink),
        if (hasLink && due != null && due.isAfter(DateTime.now()))
          _Note(
            icon: Icons.info_outline,
            text: l10n.reportEarly(fmt.date(due)),
          ),
        if (hasLink)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.icon(
              key: const ValueKey('report-read-views'),
              onPressed: _busy ? null : () => _readViews(deliverable),
              icon: const Icon(Icons.visibility_outlined),
              label: Text(l10n.reportFetchViews),
            ),
          ),
        if (_busy) ...[
          const LinearProgressIndicator(),
          Text(l10n.reportFetching, style: theme.textTheme.bodySmall),
        ],
        if (error != null)
          _Note(
            icon: Icons.error_outline,
            color: theme.colorScheme.error,
            text: error.code == 'no_link'
                ? l10n.reportNeedsLink
                : l10n.reportFetchFailed(error.message),
          ),
      ],
    );
  }

  Widget _report(
    BuildContext context,
    ThirtyDayReport report,
    Deal deal,
    Deliverable deliverable,
  ) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: 12,
      children: [
        Text(report.heading(l10n), style: theme.textTheme.titleMedium),
        for (final line
            in report.lines(l10n, ref.watch(instantFormatterProvider)))
          SelectableText(line),
        if (deal.trackingLink != null) ...[
          TextField(
            controller: _clicks,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: l10n.reportClicksLabel,
              helperText: l10n.reportClicksHelper,
              helperMaxLines: 2,
              border: const OutlineInputBorder(),
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              onPressed: () => _saveClicks(deliverable),
              child: Text(l10n.reportSaveClicks),
            ),
          ),
        ],
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              key: const ValueKey('report-copy'),
              onPressed: () async {
                await Clipboard.setData(
                    ClipboardData(text: report.text(_english, _englishDates)));
                if (context.mounted) {
                  AppToast.success(context, l10n.reportCopied);
                }
              },
              icon: const Icon(Icons.copy_outlined),
              label: Text(l10n.reportCopy),
            ),
            OutlinedButton.icon(
              onPressed: () async {
                final path = await _actions.savePage(
                  deliverable: deliverable,
                  html: report.html(_english, _englishDates),
                );
                if (!context.mounted) return;
                if (path == null) {
                  AppToast.error(context, l10n.reportPageFailed);
                } else {
                  AppToast.success(context, l10n.reportPageSaved(path));
                }
              },
              icon: const Icon(Icons.print_outlined),
              label: Text(l10n.reportSavePage),
            ),
          ],
        ),
        if (_reminderSet)
          _Note(icon: Icons.alarm_on_outlined, text: l10n.reportReminderSet)
        else
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton.icon(
              onPressed: () async {
                await _actions.remindPitch(
                  deal: deal,
                  title: l10n.reportPitchReminder(report.brand),
                );
                if (mounted) setState(() => _reminderSet = true);
              },
              icon: const Icon(Icons.alarm_add_outlined),
              label: Text(l10n.reportRemindPitch(report.brand)),
            ),
          ),
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.icon, required this.text, this.color});

  final IconData icon;
  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(child: Icon(icon, size: 18, color: color)),
        const SizedBox(width: 8),
        Expanded(
          child:
              Text(text, style: color == null ? null : TextStyle(color: color)),
        ),
      ],
    );
  }
}
