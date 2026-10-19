import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/native/pipeline_reset.dart';
import 'package:gratovo_toolbox/core/native/scraper_process_types.dart';

export 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
export 'package:gratovo_toolbox/core/native/pipeline_reset.dart';
export 'package:gratovo_toolbox/core/native/scraper_process_types.dart';

/// The web build of [ScraperProcess] -- `dart:io`'s `Process` doesn't exist
/// on web at all, so this file (picked by the `dart.library.io` conditional
/// export in scraper_process.dart) exists purely so the app still compiles
/// there. Every method throws immediately rather than being implemented as
/// a no-op, since there's no code path that should ever reach this: the
/// Start button and the Influencer Profile Refresh action are both wrapped
/// in `DesktopOnly`, so nothing on web ever calls these.
class ScraperProcess {
  const ScraperProcess._();

  /// Unlike every other method here, this one doesn't throw: it's also
  /// called by [LocalSearchRepository] (which runs on every platform, not
  /// just behind `DesktopOnly`) to check whether a local pipeline install
  /// is even reachable. Null here just means "no", not an error.
  static ScraperProcessPaths? resolvePaths({String? projectRootOverride}) =>
      null;

  /// No bundled interpreter on web, so nothing overrides what Settings holds.
  static String resolveInterpreter(String configured) => configured;

  static String? bundledInterpreter() => null;

  static Future<PipelineLaunchResult> startSearch({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> keywords,
    required Map<String, Object?> runConfigJson,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> refetchHandle({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<PipelineLaunchResult> catchUpMissingVideos({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    int? limit,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<PipelineLaunchResult> backfillChannelVideos({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
    required int months,
    int maxApiCalls = 20,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<PipelineLaunchResult> reenrichHandleStreamed({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String handle,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> pushLocalStore({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> pullSharedState({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    bool force = false,
    void Function(String line)? onLine,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> archiveChannels({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<Map<String, Object?>> entries,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> restoreChannels({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> channelIds,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> videoStats({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String video,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }

  static Future<ProcessResultLite> refreshNewsFeeds({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) {
    throw UnsupportedError(
      'ScraperProcess is desktop-only (see DesktopOnly) — this stub should '
      'never actually be called on web.',
    );
  }
}

/// Web build of [PipelineDataDir]: there is no `data/` folder to create or
/// seed, so every method answers empty and nothing throws (main() calls
/// these on every platform before the first frame).
class PipelineDataDir {
  const PipelineDataDir._();

  /// Also non-throwing, and for the same reason: `main()` calls this on every
  /// platform before the first frame, and "there is no local pipeline here"
  /// is the answer on web rather than a failure.
  static Future<void> ensureDataDir(ScraperProcessPaths paths) async {}

  /// No pipeline data folder on web, so there is never a stale database to
  /// retire -- an empty quarantine index, same as a desktop machine that had
  /// nothing to move. The read/resolve helpers answer the same way rather than
  /// throwing: Settings' merge card is built for every platform and simply
  /// shows nothing local here.
  static Future<MergeQuarantineIndex> applyPendingResets(
          ScraperProcessPaths paths) async =>
      MergeQuarantineIndex.empty;

  static String needsMergeDirPath(ScraperProcessPaths paths) => '';

  static Future<MergeQuarantineIndex> readQuarantineIndex(
          ScraperProcessPaths paths) async =>
      MergeQuarantineIndex.empty;

  static Future<MergeQuarantineIndex> resolveQuarantinedFile({
    required ScraperProcessPaths paths,
    required String storedName,
    required bool deleteFile,
  }) async =>
      MergeQuarantineIndex.empty;
}

/// Web build of [PipelineSettings]: no files, so reads answer `{}` and
/// writes do nothing.
class PipelineSettings {
  const PipelineSettings._();

  /// No local `settings.json` on web -- Settings -> Search Tuning is itself
  /// desktop-only (`DesktopOnly`), so nothing calls this here in practice.
  static Future<Map<String, Object?>> readSharedSettings(
          ScraperProcessPaths paths) async =>
      const {};

  static Future<void> writeSharedSettings(
    ScraperProcessPaths paths,
    Map<String, Object?> updates,
  ) async {}

  /// No local `settings.local.json` on web either, same reasoning as
  /// [readSharedSettings].
  static Future<Map<String, Object?>> readLocalSettings(
          ScraperProcessPaths paths) async =>
      const {};

  static Future<void> writeLocalSettings(
    ScraperProcessPaths paths,
    Map<String, Object?> updates,
  ) async {}

  static Future<void> requestSkipWait(ScraperProcessPaths paths) async {}

  /// No local `aws_gateways.json` on web either, same reasoning as
  /// [readSharedSettings] -- always "nothing deployed" here.
  static Future<Map<String, Object?>> readAwsGateways(
          ScraperProcessPaths paths) async =>
      const {};

  static Future<void> writeAwsGatewayEnabled(
    ScraperProcessPaths paths,
    bool enabled,
  ) async {}
}

/// Web build of [GmailBridge]: no interpreter, so every command answers
/// the "no mailbox here" shape `gmail_gateway.dart` already handles.
class GmailBridge {
  const GmailBridge._();

  // ---- the outreach mailbox ----
  //
  // Unlike the search methods these are NOT unreachable on web: the Outreach
  // page is a normal part of the web build, and the reply watcher runs
  // wherever the app does. So they answer "there is no mailbox on this
  // platform" as data -- the same JSON the tool would print on an unconfigured
  // machine -- rather than throwing. The composer then shows the mailto
  // hand-off it has always had, which is exactly the right fallback: a browser
  // tab genuinely cannot send on the team's behalf.
  static const _noMailboxHere =
      '{"ok": false, "error": {"code": "not_configured", "message": '
      '"Sending is done by the installed desktop app, which runs the local '
      'mailbox tool. Use the mail-app hand-off here."}}';

  static Future<ProcessResultLite> gmailStatus({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailAuthorize({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailSignOut({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    String? account,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailSend({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required GmailSendRequest request,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailRunDue({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailAcknowledgeReplies({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required List<String> messageIds,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailCancelFollowUps({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    required String conversationKey,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);

  static Future<ProcessResultLite> gmailTestSend({
    required String pythonExecutable,
    required ScraperProcessPaths paths,
    String? to,
    String? account,
  }) async =>
      const ProcessResultLite(exitCode: 1, output: _noMailboxHere);
}
