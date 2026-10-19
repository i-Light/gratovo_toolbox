/// The skill factory's outreach folder (`data/gemini skills/outreach/`) as the
/// app touches it: read one file by name, write one atomically. Kept as an
/// interface so the repository's logic — what counts as corrupt, what a
/// rewrite must preserve — is tested on real files in a temp folder, while
/// widget tests hand it an in-memory folder and never wait on disk I/O inside
/// the fake clock.
library;

/// A file in the folder exists but cannot be used: unreadable, not JSON, or
/// not the shape the app can safely rewrite. Never swallowed — the screen
/// shows [message], and a write to the same file is refused.
class OutreachFileException implements Exception {
  const OutreachFileException(this.file, this.message);

  /// The file's name inside the folder (`decisions.json`).
  final String file;
  final String message;

  @override
  String toString() => '$file: $message';
}

abstract interface class OutreachFileStore {
  /// Where the folder is, for messages.
  String get location;

  /// [name]'s text, or null when the file does not exist. Throws
  /// [OutreachFileException] when it exists but cannot be read — a locked or
  /// unreadable file is a problem to show, not an absent one.
  Future<String?> read(String name);

  /// Writes [content] beside [name] as `<name>.tmp-<micros>` and renames it
  /// over [name], so the factory reading the file at the same moment sees
  /// the old version or the new one, never half of one. Throws
  /// [OutreachFileException] on failure.
  Future<void> writeAtomic(String name, String content);
}
