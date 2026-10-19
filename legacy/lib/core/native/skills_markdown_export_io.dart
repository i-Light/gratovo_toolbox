import 'dart:developer' as developer;
import 'dart:io';

/// Writes [content] to `<directory>/<fileName>`, creating [directory] if
/// needed.
///
/// Written to a temp file and renamed into place rather than written
/// in-place: `pipeline/gemini_bridge/actions.py` may read this exact file at
/// any moment (see `CONTEXT.md` — every `action.*` prepends the matching
/// skill file to a live Gemini prompt), and a rename is atomic where a
/// truncate-then-write is a window where the file is half a skill.
/// Every `.md` file directly inside [directory] (not recursive — a skill
/// file has never been nested in a subfolder), sorted for a stable list in
/// the import dialog. Empty (not an error) when the folder does not exist yet
/// — a fresh checkout with no `data/gemini skills/` at all is exactly the
/// case this returns nothing for.
Future<List<String>> listSkillMarkdownFiles(String directory) async {
  try {
    final dir = Directory(directory);
    if (!await dir.exists()) return const [];
    final paths = [
      for (final entity in dir.listSync())
        if (entity is File && entity.path.toLowerCase().endsWith('.md'))
          entity.path,
    ]..sort();
    return paths;
  } catch (_) {
    return const [];
  }
}

/// The raw contents of one file the caller already knows exists (from
/// [listSkillMarkdownFiles]) — null on any read failure rather than throwing,
/// so a file that vanished or is locked between the listing and the read just
/// does not appear as importable.
Future<String?> readSkillMarkdownFile(String path) async {
  try {
    return await File(path).readAsString();
  } catch (_) {
    return null;
  }
}

Future<bool> writeSkillMarkdownFile({
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
    return true;
  } catch (error, stackTrace) {
    developer.log(
      'Could not export skill markdown to $directory/$fileName.',
      name: 'gratovo.skills',
      level: 1000,
      error: error,
      stackTrace: stackTrace,
    );
    return false;
  }
}
