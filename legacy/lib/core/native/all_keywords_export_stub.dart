/// Web has no filesystem to append to -- see all_keywords_export.dart.
Future<int> appendUniqueKeywords({
  required String dataDir,
  required List<String> keywords,
}) async {
  throw UnsupportedError(
    'Saving all_keywords.txt is only available on desktop builds.',
  );
}

/// Web has no file to read either.
List<String> readAllKeywordsFile({required String dataDir}) => const [];
