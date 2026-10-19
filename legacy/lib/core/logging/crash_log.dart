import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// Where an uncaught error goes so it can be read after the fact.
///
/// The framework already prints these to the console — but nobody is watching
/// the console of an installed build. Until this, a crash on a teammate's
/// machine left nothing behind: the app either carried on with a silently
/// broken widget or vanished, and the report was "it just closed". The file
/// lives beside the sync log in the app's support directory, so the same
/// "send me your logs" instruction covers both.
///
/// Best-effort in the same way as the sync log: a machine that cannot write
/// it runs exactly as before. Two files are kept, live and one previous, so a
/// widget that throws on every frame cannot fill the disk.
class CrashLog {
  CrashLog._(this._file, this._previous);

  final File _file;
  final File _previous;

  static const _fileName = 'gratovo_crash_log.txt';
  static const _maxBytes = 512 * 1024;
  static const _giveUpAfter = 5;

  int _failures = 0;
  int _bytes = 0;

  /// Opens the log in [directory] and points the framework's two error hooks
  /// at it. Never throws.
  ///
  /// [FlutterError.onError] receives build/layout/paint errors; the platform
  /// dispatcher's `onError` receives everything else that escapes to the root
  /// zone, including errors from `unawaited` futures. Both keep their default
  /// behaviour too: the details still reach the console in a debug run, and
  /// the dispatcher hook returns true so an async error is not also rethrown
  /// by the VM.
  static CrashLog? install(String directory) {
    final log = open(directory);
    if (log == null) return null;

    final previous = FlutterError.onError;
    FlutterError.onError = (details) {
      log.record(details.exceptionAsString(), details.stack,
          context: details.context?.toDescription(), library: details.library);
      previous?.call(details);
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      log.record(error.toString(), stack);
      if (kDebugMode) {
        debugPrint('Uncaught error: $error\n$stack');
      }
      return true;
    };
    return log;
  }

  static CrashLog? open(String directory) {
    try {
      final path = '$directory${Platform.pathSeparator}$_fileName';
      final file = File(path)..parent.createSync(recursive: true);
      final log = CrashLog._(file, File('$path.1'));
      log._bytes = file.existsSync() ? file.lengthSync() : 0;
      return log;
    } catch (_) {
      return null;
    }
  }

  String get path => _file.path;

  /// One entry: a timestamp line, the error, then the stack.
  void record(
    String error,
    StackTrace? stack, {
    String? context,
    String? library,
  }) {
    final buffer = StringBuffer()
      ..writeln()
      ..write('=== ${DateTime.now().toUtc().toIso8601String()}');
    if (library != null) buffer.write(' library=$library');
    buffer.writeln();
    if (context != null) buffer.writeln('while $context');
    buffer.writeln(error);
    if (stack != null) buffer.writeln(stack);
    _write(buffer.toString());
  }

  void _write(String text) {
    if (_failures >= _giveUpAfter) return;
    try {
      _rotateIfFull();
      _file.writeAsStringSync(text, mode: FileMode.append, encoding: utf8);
      _bytes += text.length;
      _failures = 0;
    } catch (_) {
      _failures++;
    }
  }

  void _rotateIfFull() {
    if (_bytes < _maxBytes) return;
    try {
      if (_previous.existsSync()) _previous.deleteSync();
      if (_file.existsSync()) _file.renameSync(_previous.path);
    } catch (_) {
      // Keep appending past the cap rather than lose the entry.
    }
    _bytes = 0;
  }
}
