import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/report_page_export.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/native/video_stats_protocol.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_deliverables_controller.dart';
import 'package:gratovo_toolbox/features/deals/application/video_stats_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';

/// Saves a report page under [fileName] and returns where, or null.
typedef ReportPageWriter = Future<String?> Function(
    String fileName, String html);

/// Writes into this machine's `data/reports/` (git-ignored: the pages carry
/// brand names and prices).
final reportPageWriterProvider = Provider<ReportPageWriter>((ref) {
  return (fileName, html) async {
    final env = ref.read(pythonEnvironmentProvider);
    final override = env.projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) return null;
    return writeReportPage(
      directory: '${paths.dataDir}/reports',
      fileName: fileName,
      content: html,
    );
  };
});

/// What the 30-day report's buttons do (plan step 7). The views are read
/// once and kept; nothing here sends anything to anyone.
class ThirtyDayReportActions {
  ThirtyDayReportActions(this._ref);

  final Ref _ref;

  /// Reads the video's views and keeps them as the report's snapshot. Null
  /// when it worked (or a snapshot was already taken), else why not.
  Future<VideoStatsError?> takeSnapshot(Deliverable deliverable) async {
    if (deliverable.hasReport) return null;
    final link = deliverable.publishedUrl?.trim() ?? '';
    if (link.isEmpty) {
      return const VideoStatsError(code: 'no_link', message: '');
    }
    final result = await _ref.read(videoStatsGatewayProvider).fetch(link);
    final views = result.views;
    if (views == null) {
      return result.error ??
          const VideoStatsError(code: 'unavailable', message: '');
    }
    await _record(
      deliverable,
      views: views,
      at: result.fetchedAt ?? DateTime.now().toUtc(),
    );
    return null;
  }

  /// Clicks on the deal's tracking link, as a person read them.
  Future<void> saveClicks(Deliverable deliverable, int clicks) =>
      _record(deliverable, clicks: clicks);

  /// HC-19 (after results are in and good): a reminder on the deal, due
  /// tomorrow, to pitch the brand its next creator.
  Future<void> remindPitch({
    required Deal deal,
    required String title,
    DateTime? now,
  }) async {
    final at = now ?? DateTime.now();
    await _ref.read(reminderRepositoryProvider).create(FollowUpReminder(
          id: '',
          title: title,
          dueAt: at.add(const Duration(days: 1)),
          kind: ReminderKind.custom,
          dealId: deal.id,
          createdAt: at,
        ));
    _ref.bumpData(const {DataDomain.reminders});
  }

  /// Saves [html] as this deliverable's report page and opens it, so it can
  /// be printed or saved as PDF from the browser. The path, or null.
  Future<String?> savePage({
    required Deliverable deliverable,
    required String html,
  }) async {
    final path = await _ref.read(reportPageWriterProvider)(
      '30-day-report-${deliverable.id}.html',
      html,
    );
    if (path != null) await _ref.read(urlLauncherProvider)(Uri.file(path));
    return path;
  }

  Future<void> _record(
    Deliverable deliverable, {
    int? views,
    DateTime? at,
    int? clicks,
  }) async {
    final provider = dealDeliverablesProvider(deliverable.dealId);
    await _ref.read(provider.future);
    await _ref
        .read(provider.notifier)
        .recordReport(deliverable.id, views: views, at: at, clicks: clicks);
    _ref.bumpData(const {DataDomain.deals});
  }
}

final thirtyDayReportActionsProvider =
    Provider<ThirtyDayReportActions>(ThirtyDayReportActions.new);
