part of 'scraper_process_io.dart';

/// The JSON files the app and `config.py` share inside the pipeline's `data/`
/// folder: `settings.json`, `settings.local.json`, `aws_gateways.json`, and
/// the `skip_wait.signal` sentinel. Reads never throw; a missing or
/// unparsable file is `{}`.
class PipelineSettings {
  const PipelineSettings._();

  /// Reads `data/settings.json` as a raw map, exactly as `config.py` sees it
  /// -- `{}` if the file is missing or unparsable, never a throw: Settings ->
  /// Search Tuning reads through this to show the shared, real values instead
  /// of a mock's in-memory placeholders.
  static Future<Map<String, Object?>> readSharedSettings(
    ScraperProcessPaths paths,
  ) async {
    final file = File('${paths.dataDir}${Platform.pathSeparator}settings.json');
    if (!file.existsSync()) return {};
    try {
      final decoded = jsonDecode(await file.readAsString());
      return decoded is Map ? Map<String, Object?>.from(decoded) : {};
    } on FormatException {
      return {};
    }
  }

  /// Asks a wait `scrapetube._interruptible_wait` is currently sitting out to
  /// end early -- the Search screen's "Try again now" button. Writes the
  /// sentinel file `_skip_wait_requested` polls for and consumes; harmless to
  /// call when nothing is actually waiting, since nothing ever reads the file
  /// between waits.
  static Future<void> requestSkipWait(ScraperProcessPaths paths) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}skip_wait.signal');
    await file.parent.create(recursive: true);
    await file.writeAsString('');
  }

  /// Merges [updates] into `data/settings.json` and writes it back.
  ///
  /// A merge, not an overwrite: `config.py` reads several keys nothing in
  /// Settings edits (`channel_sweep_break`, `auto_clean`, the two `*_path`
  /// entries), and a plain overwrite of the whole file from whatever
  /// [SearchTuningSettings] models would silently drop them the first time
  /// anyone saved a pacing change.
  static Future<void> writeSharedSettings(
    ScraperProcessPaths paths,
    Map<String, Object?> updates,
  ) async {
    final file = File('${paths.dataDir}${Platform.pathSeparator}settings.json');
    final current = await readSharedSettings(paths);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert({...current, ...updates}),
    );
  }

  /// Reads `data/settings.local.json` as a raw map -- this machine's own
  /// overrides on top of the shared `settings.json`, mirroring `config.py`'s
  /// `LOCAL_SETTINGS_PATH` merge exactly (see that file's `Config.__init__`).
  /// Gitignored, unlike `settings.json` -- see `.gitignore`'s "per-person
  /// secrets/config" section. `{}` if the file is missing or unparsable, same
  /// convention as [readSharedSettings]: a machine that has never overridden
  /// anything just sees no local settings, not an error.
  static Future<Map<String, Object?>> readLocalSettings(
    ScraperProcessPaths paths,
  ) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}settings.local.json');
    if (!file.existsSync()) return {};
    try {
      final decoded = jsonDecode(await file.readAsString());
      return decoded is Map ? Map<String, Object?>.from(decoded) : {};
    } on FormatException {
      return {};
    }
  }

  /// Merges [updates] into `data/settings.local.json` and writes it back --
  /// the per-machine counterpart to [writeSharedSettings]. Used for values
  /// that are genuinely per-device (currently just the Auto-Clean rule, see
  /// `auto_clean_controller.dart`), so one teammate tuning their own rule
  /// never touches the shared, committed `settings.json` default everyone
  /// else's fallback comes from.
  static Future<void> writeLocalSettings(
    ScraperProcessPaths paths,
    Map<String, Object?> updates,
  ) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}settings.local.json');
    final current = await readLocalSettings(paths);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert({...current, ...updates}),
    );
  }

  /// Reads `data/aws_gateways.json` as a raw map -- see
  /// `config.load_aws_gateways`'s doc comment for why this is a separate
  /// file from `settings.json` (written by `tools/aws_gateway_setup.py`,
  /// embeds this AWS account's own ids, never committed). `{}` if the file
  /// is missing or unparsable, same convention as [readSharedSettings]: a
  /// machine that never ran the setup script just sees no gateways, not an
  /// error.
  static Future<Map<String, Object?>> readAwsGateways(
    ScraperProcessPaths paths,
  ) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}aws_gateways.json');
    if (!file.existsSync()) return {};
    try {
      final decoded = jsonDecode(await file.readAsString());
      return decoded is Map ? Map<String, Object?>.from(decoded) : {};
    } on FormatException {
      return {};
    }
  }

  /// Flips `aws_gateways.json`'s top-level "enabled" flag -- the only field
  /// this app ever writes there; the "gateways" list itself is entirely
  /// `tools/aws_gateway_setup.py`'s to manage. A no-op (not an error) if the
  /// file doesn't exist yet: nothing has been deployed, so there's nothing
  /// to enable.
  static Future<void> writeAwsGatewayEnabled(
    ScraperProcessPaths paths,
    bool enabled,
  ) async {
    final file =
        File('${paths.dataDir}${Platform.pathSeparator}aws_gateways.json');
    if (!file.existsSync()) return;
    final current = await readAwsGateways(paths);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ')
          .convert({...current, 'enabled': enabled}),
    );
  }
}
