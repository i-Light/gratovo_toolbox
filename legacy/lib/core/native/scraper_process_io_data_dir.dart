part of 'scraper_process_io.dart';

/// The pipeline's writable `data/` folder: creating it, seeding it from what
/// the install shipped, moving legacy databases into place, and quarantining
/// files a new build's `reset_manifest.json` retires (see pipeline_reset.dart).
/// Every method is best-effort and safe to call on each launch.
class PipelineDataDir {
  const PipelineDataDir._();

  /// Creates [ScraperProcessPaths.dataDir] and [ScraperProcessPaths.databaseDir],
  /// moves any database left over from the flat layout, and copies in anything
  /// the install shipped that is not there yet (`.env`, `settings.json`).
  ///
  /// Copy-if-absent, never overwrite: the per-user folder is where the team's
  /// own edited settings and their `gratovo.db` live, and an app upgrade must
  /// not reset either. The shipped files are a starting point for a machine
  /// that has none, not a source of truth.
  ///
  /// Because this never overwrites, a build that ships a *changed* bundled
  /// database (a restructured `email_library.db`, say) cannot get it onto a
  /// machine that already has the old one through here. That is what
  /// [applyPendingResets] and `data/reset_manifest.json` are for: run before
  /// this, they move the stale file aside so the copy below lands in its place.
  ///
  /// Cheap and safe to call on every launch; does nothing once seeded.
  static Future<void> ensureDataDir(ScraperProcessPaths paths) async {
    final target = Directory(paths.dataDir);
    if (!target.existsSync()) await target.create(recursive: true);

    final databases = Directory(paths.databaseDir);
    if (!databases.existsSync()) await databases.create(recursive: true);
    _moveLegacyDatabases(paths);

    final seed = Directory(_join(_executableDir(), _seedDirName));
    if (!seed.existsSync()) return;
    await _copyMissing(seed, target);
    await _mergeSeedEnv(seed, target);
  }

  /// The one exception to copy-if-absent: keys the build's `.env` has and
  /// the machine's does not are added to it (see `env_merge.dart`). This is
  /// how an upgrade hands every existing install the R2 credentials without
  /// touching anything a person set by hand.
  static Future<void> _mergeSeedEnv(Directory seed, Directory target) async {
    final seedEnv = File(_join(seed.path, '.env'));
    final localEnv = File(_join(target.path, '.env'));
    if (!seedEnv.existsSync() || !localEnv.existsSync()) return;
    try {
      final merged = mergeEnvText(
        await localEnv.readAsString(),
        await seedEnv.readAsString(),
      );
      if (merged != null) await localEnv.writeAsString(merged);
    } on FileSystemException catch (error, stackTrace) {
      developer.log(
        "Could not merge the build's .env into ${localEnv.path}.",
        name: 'gratovo.pipeline',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  /// Name(s) inside `pipeline_data_seed/` that [_copyMissing] must leave in the
  /// seed folder rather than copy into the writable data dir. `reset_manifest.json`
  /// is read straight from the seed on every launch (see [applyPendingResets]);
  /// a copy-if-absent duplicate in the data dir would just go stale and confuse.
  static const Set<String> _seedFilesReadInPlace = {kResetManifestFileName};

  /// Applies any [ResetAction] in `reset_manifest.json` this machine has not
  /// applied yet, by MOVING the files it names into
  /// `data/database/_needs_merge/` -- never deleting them -- so a new build can
  /// retire a stale bundled database without the person losing whatever local
  /// edits that file held. See pipeline_reset.dart's library comment for the
  /// why, and [ScraperProcess] callers run this once at boot, BEFORE
  /// [ensureDataDir], so the fresh copy from the seed lands in the space the
  /// stale one just vacated.
  ///
  /// Best-effort in the same way as everything else here: a manifest that
  /// cannot be read, an id ledger that cannot be written, a file another
  /// process is holding open -- each is logged and stepped over, never thrown,
  /// because this runs before the first frame. Returns the resulting quarantine
  /// index (empty when nothing was moved and nothing was ever moved before) so
  /// the caller can publish the count to the team board.
  static Future<MergeQuarantineIndex> applyPendingResets(
      ScraperProcessPaths paths) async {
    final quarantineDir =
        Directory(_join(paths.databaseDir, kNeedsMergeDirName));
    final indexFile = File(_join(quarantineDir.path, kQuarantineIndexFileName));
    final appliedFile = File(_join(paths.dataDir, kAppliedResetsFileName));

    var index = MergeQuarantineIndex.empty;
    if (indexFile.existsSync()) {
      try {
        index = MergeQuarantineIndex.decode(await indexFile.readAsString());
      } catch (error) {
        developer.log(
            'Could not read the merge quarantine index; starting a '
            'fresh one.',
            name: 'gratovo.scraper.process',
            level: 900,
            error: error);
      }
    }

    final manifestText = _readResetManifest(paths);
    if (manifestText == null) return index;

    final actions = ResetAction.parseManifest(manifestText);
    if (actions.isEmpty) return index;

    var applied = <String>{};
    if (appliedFile.existsSync()) {
      try {
        applied = parseAppliedResetIds(await appliedFile.readAsString());
      } catch (_) {
        /* treated as "nothing applied" -- see parseAppliedResetIds */
      }
    }

    final pending = actions.where((a) => !applied.contains(a.id)).toList();
    if (pending.isEmpty) return index;

    var changed = false;
    for (final action in pending) {
      for (final relPath in action.paths) {
        final moved = _quarantineOne(
          paths: paths,
          quarantineDir: quarantineDir,
          relPath: relPath,
          action: action,
        );
        if (moved != null) {
          index = index.withFile(moved);
          changed = true;
        }
      }
      // Recorded whether or not any file was actually there: the instruction
      // has been carried out, and a machine that never had the file should not
      // keep re-checking every launch.
      applied.add(action.id);
      changed = true;
    }

    if (changed) {
      try {
        if (!quarantineDir.existsSync()) {
          quarantineDir.createSync(recursive: true);
        }
        await indexFile.writeAsString(index.encode());
        await appliedFile.writeAsString(encodeAppliedResetIds(applied));
      } catch (error, stackTrace) {
        // The moves already happened; failing to persist the ledger only means
        // the next launch re-applies, which is a no-op because the originals
        // are gone. Not worth failing a boot over.
        developer.log(
            'Could not persist the reset ledger after applying '
            '${pending.length} reset(s).',
            name: 'gratovo.scraper.process',
            level: 900,
            error: error,
            stackTrace: stackTrace);
      }
    }
    return index;
  }

  /// Moves one file (and its `-wal`/`-shm` siblings) named by [relPath] into
  /// [quarantineDir], returning the record for it, or null when the file is not
  /// there or cannot be moved.
  static QuarantinedFile? _quarantineOne({
    required ScraperProcessPaths paths,
    required Directory quarantineDir,
    required String relPath,
    required ResetAction action,
  }) {
    // Forward slashes in `relPath` resolve fine on Windows too -- its file APIs
    // accept them interchangeably (see ScraperProcessPaths.dbPath's note).
    final source = File(_join(paths.dataDir, relPath));
    if (!source.existsSync()) return null;

    final now = DateTime.now().toUtc();
    final baseName = relPath.split('/').last;
    final stem = QuarantinedFile.stemFor(now);
    // Two different paths ending in the same file name, quarantined in the same
    // second, would otherwise land on the same stored name; a counter keeps
    // them apart. Almost never hit -- the stem is second-resolution and reset
    // targets are rarely same-named -- but a silent overwrite here would lose
    // one of the files this whole feature exists to preserve.
    var storedName = '$stem$baseName';
    for (var n = 2;
        File(_join(quarantineDir.path, storedName)).existsSync();
        n++) {
      storedName = '$stem${n}_$baseName';
    }

    try {
      if (!quarantineDir.existsSync()) {
        quarantineDir.createSync(recursive: true);
      }
      source.renameSync(_join(quarantineDir.path, storedName));
      for (final suffix in kSqliteSiblingSuffixes) {
        final sibling = File('${source.path}$suffix');
        if (sibling.existsSync()) {
          sibling.renameSync(_join(quarantineDir.path, '$storedName$suffix'));
        }
      }
    } on FileSystemException catch (error, stackTrace) {
      developer.log(
        'Reset "${action.id}" could not move $relPath aside; it stays where it '
        'is and the reset is retried next launch.',
        name: 'gratovo.scraper.process',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
      return null;
    }

    return QuarantinedFile(
      resetId: action.id,
      originalRelPath: relPath,
      storedName: storedName,
      quarantinedAt: now,
      note: action.note,
    );
  }

  /// `reset_manifest.json` as text: from `pipeline_data_seed/` on an installed
  /// build, or from the data dir itself on a dev checkout (where that folder is
  /// the repo's own `data/`). Null when neither exists.
  static String? _readResetManifest(ScraperProcessPaths paths) {
    final candidates = [
      File(
          _join(_join(_executableDir(), _seedDirName), kResetManifestFileName)),
      File(_join(paths.dataDir, kResetManifestFileName)),
    ];
    for (final file in candidates) {
      if (file.existsSync()) {
        try {
          return file.readAsStringSync();
        } catch (error) {
          developer.log('Could not read ${file.path}.',
              name: 'gratovo.scraper.process', level: 900, error: error);
        }
      }
    }
    return null;
  }

  /// `data/database/_needs_merge/` — the folder holding files that resets have
  /// set aside. Handed to Settings' "open folder" button.
  static String needsMergeDirPath(ScraperProcessPaths paths) =>
      _join(paths.databaseDir, kNeedsMergeDirName);

  /// The quarantine index as it stands on disk right now. Empty when no reset
  /// has ever moved a file on this machine.
  static Future<MergeQuarantineIndex> readQuarantineIndex(
      ScraperProcessPaths paths) async {
    final file =
        File(_join(needsMergeDirPath(paths), kQuarantineIndexFileName));
    if (!file.existsSync()) return MergeQuarantineIndex.empty;
    try {
      return MergeQuarantineIndex.decode(await file.readAsString());
    } catch (error) {
      developer.log('Could not read the merge quarantine index.',
          name: 'gratovo.scraper.process', level: 900, error: error);
      return MergeQuarantineIndex.empty;
    }
  }

  /// Marks [storedName] resolved in the index and, when [deleteFile] is true,
  /// deletes the set-aside file (and its `-wal`/`-shm` siblings). Returns the
  /// updated index; a no-op — returning what is on disk — if the name is not
  /// found.
  ///
  /// The index entry is kept either way: "resolved 3 of 4" stays honest, and a
  /// resolve made by mistake can be seen. Only the bytes optionally go.
  static Future<MergeQuarantineIndex> resolveQuarantinedFile({
    required ScraperProcessPaths paths,
    required String storedName,
    required bool deleteFile,
  }) async {
    final dir = needsMergeDirPath(paths);
    final indexFile = File(_join(dir, kQuarantineIndexFileName));
    final current = await readQuarantineIndex(paths);
    if (!current.files.any((f) => f.storedName == storedName)) return current;

    final updated = current.markResolved(storedName);
    try {
      await indexFile.writeAsString(updated.encode());
    } catch (error, stackTrace) {
      developer.log(
          'Could not update the merge quarantine index after '
          'resolving $storedName.',
          name: 'gratovo.scraper.process',
          level: 900,
          error: error,
          stackTrace: stackTrace);
      return current;
    }

    if (deleteFile) {
      for (final suffix in ['', ...kSqliteSiblingSuffixes]) {
        final f = File(_join(dir, '$storedName$suffix'));
        try {
          if (f.existsSync()) f.deleteSync();
        } catch (error) {
          developer.log(
              'Marked $storedName resolved but could not delete '
              '${f.path}.',
              name: 'gratovo.scraper.process',
              level: 900,
              error: error);
        }
      }
    }
    return updated;
  }

  /// Moves databases left in `data/` by a build before they had a folder of
  /// their own.
  ///
  /// Without this the folder move is silently destructive on every machine
  /// that already has data: the new path is empty, so `search.py` would create
  /// a fresh `gratovo.db` and the person's local copy -- along with the Email
  /// Critique Library, which has no server copy at all -- would sit
  /// untouched in the old location, invisible to everything.
  ///
  /// Moved rather than copied, so there is exactly one file and no question
  /// later about which of two is current. Skipped for any name already present
  /// at the new path, which makes this safe to run on every launch forever and
  /// safe if it is interrupted half way.
  ///
  /// The `-wal` and `-shm` siblings move with their database: a `-wal` holds
  /// committed rows that have not been checkpointed into the main file yet, so
  /// moving the `.db` alone can lose the most recent writes.
  static void _moveLegacyDatabases(ScraperProcessPaths paths) {
    const names = ['gratovo.db', 'mailbox.db', 'email_library.db'];

    for (final name in names) {
      for (final suffix in const ['', '-wal', '-shm']) {
        final from = File(_join(paths.dataDir, '$name$suffix'));
        final to = _join(paths.databaseDir, '$name$suffix');
        if (!from.existsSync() || File(to).existsSync()) continue;
        try {
          from.renameSync(to);
        } on FileSystemException catch (error, stackTrace) {
          // A file another process has open -- most likely a search still
          // running from a previous launch. Left where it is and tried again
          // next launch; the alternative, copying, would leave two databases
          // and no way to tell which one anybody is writing to.
          developer.log(
            'Could not move $name$suffix into ${paths.databaseDir}; it stays '
            'in ${paths.dataDir} until the next launch.',
            name: 'gratovo.scraper.process',
            level: 900,
            error: error,
            stackTrace: stackTrace,
          );
        }
      }
    }
  }

  /// Copies everything under [from] that [to] does not already have, keeping
  /// the folder structure (`gemini skills/` is a folder, not a file).
  static Future<void> _copyMissing(Directory from, Directory to) async {
    for (final entity in from.listSync()) {
      final name =
          entity.uri.pathSegments.lastWhere((segment) => segment.isNotEmpty);
      if (entity is File && _seedFilesReadInPlace.contains(name)) continue;
      final destination = _join(to.path, name);
      try {
        if (entity is Directory) {
          final child = Directory(destination);
          if (!child.existsSync()) await child.create(recursive: true);
          await _copyMissing(entity, child);
        } else if (entity is File && !File(destination).existsSync()) {
          await entity.copy(destination);
        }
      } on FileSystemException catch (error, stackTrace) {
        // One unseedable file should not stop a launch -- the pipeline reports
        // a missing key far more clearly than a copy failure would.
        developer.log(
          'Could not seed $name into ${to.path}.',
          name: 'gratovo.scraper.process',
          level: 900,
          error: error,
          stackTrace: stackTrace,
        );
      }
    }
  }
}
