/// Merging a build's seed `.env` into the one a machine already has.
///
/// The seed under `pipeline_data_seed/` is copied into the data dir only when
/// no `.env` is there yet (`PipelineDataDir.ensureDataDir` never overwrites),
/// which is right for every value a person may have changed by hand — but it
/// means a build that introduces a NEW key (the R2 credentials, say) never
/// reaches a machine that was installed before the key existed. This is the
/// narrow fix: a key the seed has and the local file does not — or has with
/// nothing after the `=` — is added; every key the local file already holds
/// a value for is left exactly as it is, so a machine's own `WORKER_NAME` or
/// a YouTube key somebody swapped survives every upgrade.
library;

final _assignment =
    RegExp(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$');

/// The `KEY=value` pairs in a dotenv text, in file order. Comments and blank
/// lines are skipped; values keep their raw text (quotes included).
Map<String, String> parseEnv(String text) {
  final out = <String, String>{};
  for (final line in text.split('\n')) {
    final match = _assignment.firstMatch(line.trimRight());
    if (match == null) continue;
    out[match.group(1)!] = match.group(2)!.trim();
  }
  return out;
}

/// [existing] with every key from [seed] that it lacks. Returns null when
/// there is nothing to add, so the caller can leave the file untouched.
///
/// A key present in [existing] with an empty value is filled in on its own
/// line; a key absent altogether is appended in a dated block at the end,
/// so somebody opening the file can see what the upgrade added and when.
String? mergeEnvText(String existing, String seed, {DateTime? now}) {
  final have = parseEnv(existing);
  final want = parseEnv(seed);
  final fillIn = <String, String>{};
  final append = <String, String>{};
  for (final entry in want.entries) {
    if (entry.value.isEmpty) continue;
    final current = have[entry.key];
    if (current == null) {
      append[entry.key] = entry.value;
    } else if (current.isEmpty) {
      fillIn[entry.key] = entry.value;
    }
  }
  if (fillIn.isEmpty && append.isEmpty) return null;

  final lines = existing.split('\n');
  if (fillIn.isNotEmpty) {
    for (var i = 0; i < lines.length; i++) {
      final match = _assignment.firstMatch(lines[i].trimRight());
      if (match == null) continue;
      final value = fillIn.remove(match.group(1));
      if (value != null) lines[i] = '${match.group(1)}=$value';
    }
    // A key the parser saw but this loop did not (cannot happen with one
    // regex, but never lose a value over it).
    append.addAll(fillIn);
  }
  if (append.isNotEmpty) {
    final stamp =
        (now ?? DateTime.now()).toUtc().toIso8601String().substring(0, 10);
    if (lines.isNotEmpty && lines.last.trim().isNotEmpty) lines.add('');
    lines
      ..add('# ---- Added by the app from the installed build on $stamp ----')
      ..addAll([for (final e in append.entries) '${e.key}=${e.value}'])
      ..add('');
  }
  return lines.join('\n');
}
