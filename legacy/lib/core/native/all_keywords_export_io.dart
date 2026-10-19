import 'dart:io';

/// Appends whatever [keywords] `<dataDir>/all_keywords.txt` does not already
/// have (compared trimmed) to the bottom of the file, leaving every line
/// already in it untouched. Returns how many were actually new.
Future<int> appendUniqueKeywords({
  required String dataDir,
  required List<String> keywords,
}) async {
  final dir = Directory(dataDir);
  if (!dir.existsSync()) await dir.create(recursive: true);

  final file = File('$dataDir/all_keywords.txt');
  final current = file.existsSync() ? await file.readAsString() : '';

  final existing = <String>{
    for (final line in current.split('\n'))
      if (line.trim().isNotEmpty) line.trim(),
  };

  final toAppend = <String>[];
  for (final keyword in keywords) {
    final trimmed = keyword.trim();
    if (trimmed.isEmpty) continue;
    if (existing.add(trimmed)) toAppend.add(trimmed);
  }
  if (toAppend.isEmpty) return 0;

  final needsLeadingNewline = current.isNotEmpty && !current.endsWith('\n');
  final addition = '${needsLeadingNewline ? '\n' : ''}${toAppend.join('\n')}\n';
  await file.writeAsString(addition, mode: FileMode.append, flush: true);
  return toAppend.length;
}

/// Every line of `<dataDir>/all_keywords.txt`, trimmed, blanks dropped — the
/// running tally [appendUniqueKeywords] maintains, read back so a keyword
/// generator can avoid what has already been searched. An unreadable or
/// missing file is an empty list: the tally is a convenience, not a record
/// anything depends on. Synchronous like `LocalPipelineDb.readAllKeywords`,
/// its sibling source: a few thousand short lines, read once per dialog.
List<String> readAllKeywordsFile({required String dataDir}) {
  final file = File('$dataDir/all_keywords.txt');
  if (!file.existsSync()) return const [];
  try {
    final text = file.readAsStringSync();
    return [
      for (final line in text.split('\n'))
        if (line.trim().isNotEmpty) line.trim(),
    ];
  } on FileSystemException {
    return const [];
  }
}
