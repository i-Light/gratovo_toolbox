import 'dart:convert';
import 'dart:io';

import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';

/// The durable half of [SyncDiagnostics]: a plain text file beside the mirror.
///
/// A text file rather than a table in the mirror database, for one reason that
/// decides it: the mirror is deleted and recreated whenever the schema version
/// moves or somebody signs out of a shared machine, and the log is at its most
/// valuable in exactly the situations where the database has just been thrown
/// away. It also means the file can be read while the app is shut, opened in
/// any editor, and attached to a message without anybody installing a SQLite
/// browser.
///
/// Two files are kept — the live one and one previous — so the log covers more
/// than the last few hours without being allowed to grow without bound on a
/// machine that has been failing every thirty seconds for a week.
class FileSyncLogSink implements SyncLogSink {
  FileSyncLogSink._(this._file, this._previous);

  final File _file;
  final File _previous;

  /// About a week of a healthy machine's logging, or a couple of days of a
  /// machine in a retry loop. Small enough to open in an editor and to paste
  /// the tail of into a message.
  static const _maxBytes = 1024 * 1024;

  /// How many consecutive write failures before this stops trying.
  ///
  /// A disk that is full or a file the antivirus has locked will not be fixed
  /// by the next line, and a sync pass that attempted a failing write for every
  /// page would spend longer in the exception handler than on the network.
  /// [SyncDiagnostics] keeps its in-memory copy either way.
  static const _giveUpAfter = 5;

  int _failures = 0;
  int _bytes = 0;

  /// Opens (creating if needed) the log in [directory].
  ///
  /// Never throws. A machine that cannot write the log is a machine that syncs
  /// exactly as it did before, with the in-memory log only — which is a much
  /// better failure than refusing to sync because the diagnostics would not
  /// open.
  static FileSyncLogSink? open(String directory) {
    try {
      final path = '$directory${Platform.pathSeparator}$_fileName';
      final file = File(path);
      final previous = File('$path.1');
      file.parent.createSync(recursive: true);
      final sink = FileSyncLogSink._(file, previous);
      sink._bytes = file.existsSync() ? file.lengthSync() : 0;
      return sink;
    } catch (_) {
      return null;
    }
  }

  static const _fileName = 'gratovo_sync_log.txt';

  /// Writes a session banner, so a reader can tell one run of the app from the
  /// next without guessing from the timestamps.
  ///
  /// The blank line before it is deliberate: it is what makes the boundary
  /// between two runs visible at a glance in a file that is otherwise a
  /// thousand identical-looking lines.
  void writeHeader(Map<String, Object?> facts) {
    final rendered = [
      for (final entry in facts.entries)
        if (entry.value != null) '${entry.key}=${entry.value}',
    ].join(' ');
    write('');
    write('=== sync session ${DateTime.now().toUtc().toIso8601String()} '
        '$rendered');
  }

  @override
  void write(String line) {
    if (_failures >= _giveUpAfter) return;
    try {
      _rotateIfFull();
      _file.writeAsStringSync(
        '$line\n',
        mode: FileMode.append,
        encoding: utf8,
        flush: false,
      );
      _bytes += line.length + 1;
      _failures = 0;
    } catch (_) {
      _failures++;
    }
  }

  /// Moves the live file aside once it is full, replacing whatever was there.
  ///
  /// Tracked with a counter rather than by asking the file system its length on
  /// every line: a `stat` per log line during a busy pass is a syscall for
  /// nothing, and the count only has to be right to within a line or two of a
  /// megabyte.
  void _rotateIfFull() {
    if (_bytes < _maxBytes) return;
    try {
      if (_previous.existsSync()) _previous.deleteSync();
      if (_file.existsSync()) _file.renameSync(_previous.path);
    } catch (_) {
      // A rename the OS refuses is not worth losing the log over. Fall through
      // and keep appending; the file grows past the cap until the next attempt
      // succeeds, which is strictly better than dropping the lines.
    }
    _bytes = 0;
  }

  @override
  String? describe() => _file.path;

  /// The tail of the durable log, for the "everything, not just this session"
  /// view in Settings.
  ///
  /// Reads the previous file too when the live one is short, so rotating does
  /// not make the last hour disappear from the screen.
  String readTail({int maxBytes = 256 * 1024}) {
    try {
      final buffer = StringBuffer();
      final live = _file.existsSync() ? _file.readAsStringSync() : '';
      if (live.length < maxBytes && _previous.existsSync()) {
        final older = _previous.readAsStringSync();
        buffer.write(_lastBytes(older, maxBytes - live.length));
      }
      buffer.write(_lastBytes(live, maxBytes));
      return buffer.toString();
    } catch (error) {
      return 'Could not read $_fileName: $error';
    }
  }

  /// Clips to whole lines, so a tail never starts mid-word.
  static String _lastBytes(String text, int limit) {
    if (text.length <= limit) return text;
    final clipped = text.substring(text.length - limit);
    final newline = clipped.indexOf('\n');
    return newline == -1 ? clipped : clipped.substring(newline + 1);
  }
}
