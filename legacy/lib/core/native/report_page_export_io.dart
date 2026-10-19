import 'dart:developer' as developer;
import 'dart:io';

/// Writes [content] to `<directory>/<fileName>`, creating [directory] if
/// needed, and returns the file's path — null if it could not be written.
/// Written to a temp file and renamed into place, so a browser that has the
/// page open never reads half of it.
Future<String?> writeReportPage({
  required String directory,
  required String fileName,
  required String content,
}) async {
  try {
    final dir = Directory(directory);
    await dir.create(recursive: true);
    final target = File('${dir.path}${Platform.pathSeparator}$fileName');
    final temp =
        File('${target.path}.tmp-${DateTime.now().microsecondsSinceEpoch}');
    await temp.writeAsString(content, flush: true);
    await temp.rename(target.path);
    return target.path;
  } catch (error, stackTrace) {
    developer.log(
      'Could not save the report page to $directory/$fileName.',
      error: error,
      stackTrace: stackTrace,
    );
    return null;
  }
}
