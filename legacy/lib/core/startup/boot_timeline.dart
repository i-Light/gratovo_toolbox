import 'dart:developer' as developer;
import 'dart:io';

/// How long each step before the first frame took, written down once per
/// launch.
///
/// "The app is slow to start" has to become a number before it can be fixed,
/// and the only launch that counts is the real one: the installed build, the
/// real database, this machine's disk and network. `main()` marks each step;
/// after the first frame the line goes to `gratovo_boot_log.txt` beside the
/// crash log, one line per launch, the newest [_keepLines] kept:
///
///     2026-09-30T09:12:03.120 firstFrame=812ms window=40 crashLog=3 tz=31 ...
///
/// Never throws: timing a launch must not be what breaks one.
class BootTimeline {
  BootTimeline() : _watch = Stopwatch()..start();

  static const fileName = 'gratovo_boot_log.txt';
  static const _keepLines = 50;

  final Stopwatch _watch;
  final List<(String, int)> _steps = [];
  int _last = 0;

  /// Records how long the step that just finished took.
  void mark(String step) {
    final now = _watch.elapsedMilliseconds;
    _steps.add((step, now - _last));
    _last = now;
  }

  int get elapsedMilliseconds => _watch.elapsedMilliseconds;

  /// One line: when, time to first frame, then each step in order.
  String describe({required int firstFrameMs, DateTime? at}) {
    final stamp = (at ?? DateTime.now()).toIso8601String();
    final steps = [for (final (name, ms) in _steps) '$name=$ms'].join(' ');
    return '$stamp firstFrame=${firstFrameMs}ms $steps';
  }

  /// Appends [line] to the log in [directory], keeping the newest lines only.
  static void append(String directory, String line) {
    try {
      final file = File('$directory${Platform.pathSeparator}$fileName');
      final previous = file.existsSync() ? file.readAsLinesSync() : <String>[];
      final lines = [...previous, line];
      final kept = lines.length > _keepLines
          ? lines.sublist(lines.length - _keepLines)
          : lines;
      file
        ..parent.createSync(recursive: true)
        ..writeAsStringSync('${kept.join('\n')}\n');
    } catch (error) {
      developer.log('Could not write the boot timeline.',
          name: 'gratovo.boot', level: 800, error: error);
    }
  }
}
