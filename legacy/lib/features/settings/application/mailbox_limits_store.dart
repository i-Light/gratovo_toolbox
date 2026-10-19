import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';

/// Where one mailbox's daily cap (house choice HC-02) and warm-up start date
/// (HC-03) are kept: this machine's `settings.local.json`, which the mailbox
/// tool reads on every send. Per machine, like the mailbox itself.
abstract class MailboxLimitsStore {
  Future<void> save(
    String account, {
    required int dailyCap,
    required DateTime? warmupStartedOn,
  });
}

/// The real store, through the pipeline's settings files. A no-op where there
/// is no local pipeline (web).
class LocalFileMailboxLimitsStore implements MailboxLimitsStore {
  const LocalFileMailboxLimitsStore();

  @override
  Future<void> save(
    String account, {
    required int dailyCap,
    required DateTime? warmupStartedOn,
  }) async {
    final paths = ScraperProcess.resolvePaths();
    if (paths == null) return;
    final local = await PipelineSettings.readLocalSettings(paths);
    final merged = mergeMailboxLimits(
      local,
      account,
      dailyCap: dailyCap,
      warmupStartedOn: warmupStartedOn,
    );
    await PipelineSettings.writeLocalSettings(
        paths, {'mailboxes': merged['mailboxes']});
  }
}

final mailboxLimitsStoreProvider = Provider<MailboxLimitsStore>(
  (ref) => const LocalFileMailboxLimitsStore(),
);

/// Today, for counting warm-up days. A provider so a test can fix the date.
final mailboxLimitsClockProvider =
    Provider<DateTime Function()>((ref) => DateTime.now);
