/// Telling "the team database is older than this app" apart from every other
/// server answer.
///
/// `backend/schema.sql` reaches Supabase only when somebody pastes it into the
/// SQL editor, so for a while after an update the app asks for columns, tables
/// and editable fields the server does not have yet. That is not a refusal to
/// act on: every queued change must wait (never be dropped), and the sync card
/// must say what fixes it.
library;

import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;

/// What fixes it, in the words the sync card shows after the error.
const String kServerSchemaBehindHint =
    'The team database is behind this version of the app: paste '
    'backend/schema.sql into the Supabase SQL editor and run it. Nothing is '
    'lost meanwhile — queued changes are kept and go up once it has run.';

/// Whether [error] is the server lacking something this version relies on.
bool isServerSchemaBehind(Object error) {
  if (error is! PostgrestException) return false;
  return switch (error.code) {
    '42703' || // undefined_column
    '42P01' || // undefined_table
    '42883' || // undefined_function
    'PGRST202' || // function not in PostgREST's schema cache
    'PGRST204' || // column not in the schema cache
    'PGRST205' => // table not in the schema cache
      true,
    // apply_channel_edit's whitelist on a server that predates the field. The
    // app only sends fields on its own copy of that list (edit_cas.dart), so
    // the server refusing one means the server's copy is the older one.
    '22023' =>
      error.message.contains('is not editable through apply_channel_edit'),
    _ => false,
  };
}
