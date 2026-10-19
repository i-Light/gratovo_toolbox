/// The web build: nowhere to write a file, so saving a page always reports
/// failure (null) rather than pretending to have saved something.
Future<String?> writeReportPage({
  required String directory,
  required String fileName,
  required String content,
}) async =>
    null;
