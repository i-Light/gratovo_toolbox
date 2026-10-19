import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/outreach/application/template_performance_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Read-only per-template stats, shown above the editable template list in
/// [TemplateLibraryCard]: how often each template was sent, what share of
/// those sends got a reply, and the average time a reply took.
///
/// Additive to the template library dialog, not a replacement for anything
/// in it — this only reads [templatePerformanceProvider]; adding, editing
/// and deleting templates stays exactly as it was.
class TemplatePerformanceSection extends ConsumerWidget {
  const TemplatePerformanceSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final statsAsync = ref.watch(templatePerformanceProvider);

    return statsAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(
          child: SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
      // A stats section that fails to load is not worth blocking the rest of
      // the dialog for — the template list above and the editor below both
      // work independently of this. Fail quiet and let those keep working.
      error: (error, stackTrace) => const SizedBox.shrink(),
      data: (stats) {
        if (stats.isEmpty) return const SizedBox.shrink();
        final textTheme = Theme.of(context).textTheme;
        final colorScheme = Theme.of(context).colorScheme;

        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.templatePerfSectionTitle,
                style: textTheme.labelLarge,
              ),
              const SizedBox(height: 4),
              for (final stat in stats)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          stat.templateName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: textTheme.bodyMedium,
                        ),
                      ),
                      Text(
                        _statsLine(l10n, stat),
                        style: textTheme.bodySmall?.copyWith(
                          color: colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              const Divider(height: 20),
            ],
          ),
        );
      },
    );
  }

  /// "Sent 4 times · 50% replied · Avg. reply: 2 days" — pieces omitted when
  /// they don't apply (never sent has no rate or reply time; sent-but-never
  /// replied has no reply time).
  String _statsLine(AppLocalizations l10n, TemplatePerformanceStats stat) {
    final parts = <String>[l10n.templatePerfUsage(stat.timesUsed)];
    if (stat.timesUsed > 0) {
      final percent = (stat.replyRate * 100).round().toString();
      parts.add(l10n.templatePerfReplyRate(percent));
      final average = stat.averageTimeToReply;
      if (average != null) {
        parts.add(_averageReplyLabel(l10n, average));
      } else {
        parts.add(l10n.templatePerfNoRepliesYet);
      }
    }
    return parts.join(' · ');
  }

  String _averageReplyLabel(AppLocalizations l10n, Duration average) {
    final bucket = templateReplyDurationBucket(average);
    return switch (bucket.unit) {
      'days' => l10n.templatePerfAvgReplyDays(bucket.value),
      'hours' => l10n.templatePerfAvgReplyHours(bucket.value),
      _ => l10n.templatePerfAvgReplyMinutes(bucket.value),
    };
  }
}
