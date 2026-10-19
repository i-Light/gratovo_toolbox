import 'package:gratovo_toolbox/core/local_db/local_db_types.dart';

export 'package:gratovo_toolbox/core/local_db/local_db_types.dart';

/// The web build's [openLocalDb] — `package:sqlite3` is FFI-based and does not
/// exist there at all.
///
/// Returns null rather than throwing, matching the io build's own failure
/// contract exactly (see `local_db_io.dart`), so no caller needs a `kIsWeb`
/// branch: "there is no local database here" is already a state every one of
/// them handles.
LocalDb? openLocalDb({required String directory, required LocalDbSpec spec}) =>
    null;
