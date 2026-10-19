import 'dart:async';
import 'dart:collection';
import 'dart:convert';
import 'dart:developer' as developer;

import 'package:supabase_flutter/supabase_flutter.dart'
    show AuthException, PostgrestException;

/// The sync's own flight recorder.
///
/// Every failure this subsystem can have looks identical from the outside: a
/// red line in Settings reading "Sync problem: TimeoutException after
/// 0:00:45". That sentence is true and useless. It does not say which table was
/// being downloaded, how big the page was, how long the healthy pages before it
/// took, whether the server was reachable at all a second later, or whether
/// this is the first failure in a month or the two hundredth this morning —
/// and by the time anybody looks, the pass that failed is gone and the next one
/// has usually succeeded.
///
/// So the mirror keeps its own log, on this machine, and keeps it whether
/// anything failed or not. The healthy passes are the important half: a
/// timeout only means something next to the ten pages before it that took four
/// seconds each.
///
/// Three properties this has to have, all of which shape the code below:
///
///  * **It cannot fail the thing it is watching.** Every method swallows its
///    own errors. A log that can throw is a log that turns a recoverable sync
///    failure into an unrecoverable one.
///  * **It has to survive a restart.** The failure people report is one they
///    noticed an hour later, usually after closing the app in frustration.
///    An in-memory buffer alone would be empty by the time it is read, which is
///    why there is a [SyncLogSink] writing to a file beside the mirror.
///  * **It has to be readable by somebody who did not write it.** One line per
///    event, timestamp first, `key=value` fields after the message — greppable
///    from a terminal and pasteable into a bug report.
class SyncDiagnostics {
  SyncDiagnostics({SyncLogSink? sink, int memoryLimit = 600})
      : _sink = sink,
        _memoryLimit = memoryLimit;

  final SyncLogSink? _sink;
  final int _memoryLimit;

  /// The last [_memoryLimit] entries, newest last.
  ///
  /// Kept alongside the file so the Settings dialog can show the log without
  /// reading anything off disk — and so the log still works on a machine where
  /// the file could not be opened at all.
  final Queue<SyncLogEntry> _entries = Queue<SyncLogEntry>();

  /// How many events of each level have been recorded since launch.
  ///
  /// The one number that answers "is this constant or did it happen once?"
  /// without anybody reading a single line.
  final Map<SyncLogLevel, int> _counts = {
    for (final level in SyncLogLevel.values) level: 0,
  };

  int _passes = 0;
  int _failedPasses = 0;

  int get passCount => _passes;
  int get failedPassCount => _failedPasses;
  int countOf(SyncLogLevel level) => _counts[level] ?? 0;

  /// Where the durable copy is being written, for the "the full log is here"
  /// line in the UI. Null when there is no file.
  String? get filePath => _sink?.describe();

  UnmodifiableListView<SyncLogEntry> get entries =>
      UnmodifiableListView(_entries);

  /// The most recent entry, or null before anything has been recorded.
  ///
  /// For the one-line "what is the sync doing right now" the Settings row shows
  /// while a pass runs — a milestone, not the whole log.
  SyncLogEntry? get latest => _entries.isEmpty ? null : _entries.last;

  final StreamController<void> _changes = StreamController<void>.broadcast();

  /// Fires after a milestone entry ([SyncLogLevel.info] or louder) is recorded
  /// — a table finished, an upload started, a pass ended, a page went slow.
  ///
  /// Deliberately NOT every entry: the healthy per-page lines are
  /// [SyncLogLevel.debug] and land several times a second during a full
  /// re-sync, which is a rebuild rate a status line has no use for. A listener
  /// reads [latest] when this fires.
  Stream<void> get changes => _changes.stream;

  /// Releases the broadcast stream. The engine owns this object for the life of
  /// the app, so this only matters to tests that build many.
  void dispose() {
    _changes.close();
  }

  /// Records one thing that happened.
  ///
  /// [event] is a dotted, machine-stable name (`pull.page`, `pass.end`) that
  /// survives message rewording, because the messages are for people and the
  /// event names are what somebody greps for. [fields] carries the numbers.
  void log(
    String event,
    String message, {
    SyncLogLevel level = SyncLogLevel.info,
    Map<String, Object?> fields = const {},
    Object? error,
    StackTrace? stackTrace,
  }) {
    try {
      final merged = <String, Object?>{
        ...fields,
        if (error != null) ...describeError(error),
      };
      final entry = SyncLogEntry(
        at: DateTime.now().toUtc(),
        level: level,
        event: event,
        message: message,
        fields: merged,
      );

      _entries.addLast(entry);
      while (_entries.length > _memoryLimit) {
        _entries.removeFirst();
      }
      _counts[level] = (_counts[level] ?? 0) + 1;
      if (event == 'pass.end') {
        _passes++;
        if (level != SyncLogLevel.info) _failedPasses++;
      }

      // Nudge the Settings activity line, but only on the entries it would
      // actually show — see [changes]. Guarded like everything else here: a
      // closed controller (a disposed test double) must not throw into a sync.
      if (level.index >= SyncLogLevel.info.index && !_changes.isClosed) {
        _changes.add(null);
      }

      _sink?.write(entry.format());

      // Also to the ordinary developer log, so a run under `flutter run` shows
      // the same story in the console without anybody knowing this file exists.
      // Warnings and errors only: the per-page lines would drown it.
      if (level.index >= SyncLogLevel.warn.index) {
        developer.log(
          entry.format(),
          name: 'gratovo.mirror',
          level: level == SyncLogLevel.error ? 1000 : 900,
          error: error,
          stackTrace: stackTrace,
        );
      }
    } catch (_) {
      // Deliberately empty. See the class comment: this must never be the
      // reason a sync fails.
    }
  }

  /// The whole in-memory log as text, newest last, ready to paste.
  ///
  /// Headed by the counts, because the first question anybody asks of a log
  /// they have just been sent is how much of it matters.
  String render({int? limit}) {
    final buffer = StringBuffer()
      ..writeln('# gratovo sync log')
      ..writeln('# rendered ${DateTime.now().toUtc().toIso8601String()}')
      ..writeln('# passes=$_passes failed=$_failedPasses '
          'warnings=${countOf(SyncLogLevel.warn)} '
          'errors=${countOf(SyncLogLevel.error)}');
    final path = filePath;
    if (path != null) buffer.writeln('# full history: $path');
    buffer.writeln('#');

    final all = _entries.toList();
    final from = limit == null || limit >= all.length ? 0 : all.length - limit;
    for (var i = from; i < all.length; i++) {
      buffer.writeln(all[i].format());
    }
    return buffer.toString();
  }

  /// Takes an error apart into fields, so the log records what the exception
  /// *is* rather than only what its `toString` chose to reveal.
  ///
  /// The distinctions here are the ones that change what somebody does next.
  /// A [PostgrestException] with code 42501 is a permissions problem and no
  /// amount of waiting fixes it; a `SocketException` with a `errno = 11001` is
  /// DNS and means the machine is not really online; a [TimeoutException] means
  /// the server took the request and never answered, which is a different
  /// problem again from one that was refused.
  ///
  /// The `dart:io` types are matched by name rather than by `is`, so this file
  /// stays importable from the web build, which has no `dart:io`.
  static Map<String, Object?> describeError(Object error) {
    final fields = <String, Object?>{'errorType': error.runtimeType.toString()};

    if (error is TimeoutException) {
      fields['errorKind'] = 'timeout';
      fields['waitedMs'] = error.duration?.inMilliseconds;
      fields['error'] = error.message;
      return fields;
    }
    if (error is PostgrestException) {
      fields['errorKind'] = 'postgrest';
      fields['code'] = error.code;
      fields['error'] = error.message;
      fields['details'] = error.details?.toString();
      fields['hint'] = error.hint;
      return fields;
    }
    if (error is AuthException) {
      fields['errorKind'] = 'auth';
      fields['code'] = error.statusCode;
      fields['error'] = error.message;
      return fields;
    }

    final name = error.runtimeType.toString();
    final text = error.toString();
    fields['errorKind'] = switch (name) {
      'SocketException' => 'socket',
      'HandshakeException' => 'tls',
      'HttpException' => 'http',
      'ClientException' => 'http',
      'TlsException' => 'tls',
      'FileSystemException' => 'file',
      _ => 'other',
    };
    // `SocketException: … (OS Error: …, errno = 11001), address = …` — the
    // errno is the part worth pulling out, because it is the difference between
    // "no DNS" and "connection reset" and both print as one long sentence.
    final errno = RegExp(r'errno = (-?\d+)').firstMatch(text);
    if (errno != null) fields['errno'] = errno.group(1);
    fields['error'] = text;
    return fields;
  }
}

enum SyncLogLevel { debug, info, warn, error }

/// One line of the log.
class SyncLogEntry {
  const SyncLogEntry({
    required this.at,
    required this.level,
    required this.event,
    required this.message,
    this.fields = const {},
  });

  final DateTime at;
  final SyncLogLevel level;
  final String event;
  final String message;
  final Map<String, Object?> fields;

  /// `<iso8601> <LEVEL> <event> <message> | k=v k=v`
  ///
  /// The pipe is what makes this parseable without making it unreadable: a
  /// person reads up to it, a script splits on it.
  String format() {
    final buffer = StringBuffer()
      ..write(at.toIso8601String())
      ..write(' ')
      ..write(level.name.toUpperCase().padRight(5))
      ..write(' ')
      ..write(event.padRight(20))
      ..write(' ')
      ..write(message);

    final rendered = [
      for (final entry in fields.entries)
        if (entry.value != null) '${entry.key}=${_value(entry.value!)}',
    ];
    if (rendered.isNotEmpty) {
      buffer
        ..write(' | ')
        ..write(rendered.join(' '));
    }
    return buffer.toString();
  }

  @override
  String toString() => format();

  /// Quotes anything with a space or a pipe in it, so one field cannot swallow
  /// the next, and clips values that would otherwise be a paragraph.
  static String _value(Object value) {
    var text = value is String ? value : jsonEncode(value);
    text = text.replaceAll('\n', '\\n').replaceAll('\r', '');
    if (text.length > 400) text = '${text.substring(0, 400)}…';
    if (text.isEmpty) return '""';
    if (text.contains(' ') || text.contains('|') || text.contains('"')) {
      return '"${text.replaceAll('"', r'\"')}"';
    }
    return text;
  }
}

/// Where the durable copy of the log goes.
///
/// An interface rather than a `File` because this file has to compile on the
/// web, where there is no file system and the in-memory half of
/// [SyncDiagnostics] is the whole of it — and because a test wants to read what
/// was written without touching a disk.
abstract class SyncLogSink {
  void write(String line);

  /// A human-readable location, shown in the UI as "the full log is here".
  String? describe();
}

/// Collects lines in memory. For tests, and for any build with no file system.
class MemorySyncLogSink implements SyncLogSink {
  final List<String> lines = [];

  @override
  void write(String line) => lines.add(line);

  @override
  String? describe() => null;
}
