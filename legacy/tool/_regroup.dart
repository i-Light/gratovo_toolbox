// A one-off: re-split the "QA optimizer" skill group's cards along the
// headings its markdown actually has, after `parseSkillMarkdownSections`
// learned to read them differently. Run with `--apply` to write; without it,
// it only prints what it would do.
//
// It is kept rather than deleted because the same reshaping may be wanted for
// another group, but note what it is before running it: the group name is
// hardcoded, and `--apply` DELETEs every section in that group before
// reinserting. Nothing else in the app imports it.
//
// ignore_for_file: avoid_print — this is a command-line script, and `print`
// is how a command-line script talks. `avoid_print` is on for the app, where
// it would be a leak; here it is the interface. Without this the file fails
// CI's `flutter analyze --fatal-infos`, which is how it was found.

import 'package:gratovo_toolbox/features/skills/application/skill_markdown.dart';
import 'package:sqlite3/sqlite3.dart';

void main(List<String> args) {
  final apply = args.contains('--apply');
  final db = sqlite3.open('data/database/skills_library.db');
  db.execute('PRAGMA busy_timeout = 5000');
  final g = db
      .select("SELECT id,name FROM skill_groups WHERE name='QA optimizer'")
      .single;
  final gid = g['id'] as String;
  final rows = db.select(
      'SELECT heading, body, team_only FROM skill_sections WHERE group_id=? ORDER BY position',
      [gid]);
  if (rows.any((r) => r['team_only'] != 0)) throw 'team-only cards present';
  final b = StringBuffer('# ${g['name']}\n\n');
  for (final r in rows) {
    b.write('## ${r['heading']}\n\n${r['body']}\n\n');
  }
  final parsed =
      parseSkillMarkdownSections(b.toString(), title: g['name'] as String);
  print('old ${rows.length} new ${parsed.length}');
  for (var i = 0; i < parsed.length; i++) {
    print('$i  ${parsed[i].heading}  (${parsed[i].body.length})');
  }
  if (!apply) return;
  final now = DateTime.now().toUtc().toIso8601String();
  db.execute('BEGIN');
  db.execute('DELETE FROM skill_sections WHERE group_id=?', [gid]);
  for (var i = 0; i < parsed.length; i++) {
    db.execute(
      'INSERT INTO skill_sections (id,group_id,heading,body,position,created_at,updated_at,team_only) VALUES (?,?,?,?,?,?,?,0)',
      [
        '${DateTime.now().microsecondsSinceEpoch}-$i-${gid.substring(0, 8)}',
        gid,
        parsed[i].heading,
        parsed[i].body,
        i,
        now,
        now
      ],
    );
  }
  db.execute('UPDATE skill_groups SET updated_at=? WHERE id=?', [now, gid]);
  db.execute('COMMIT');
  print('applied');
}
