/// The web build: nowhere to write a file, so exporting always reports
/// failure rather than pretending to have saved something.
Future<bool> writeSkillMarkdownFile({
  required String directory,
  required String fileName,
  required String content,
}) async =>
    false;

Future<List<String>> listSkillMarkdownFiles(String directory) async => const [];

Future<String?> readSkillMarkdownFile(String path) async => null;
