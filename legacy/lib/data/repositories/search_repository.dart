import 'package:gratovo_toolbox/data/models/search_run.dart';

/// How the UI reads the sourcing/search side of the pipeline: the state of
/// the current/most recent [SearchRun] on this machine.
///
/// This used to also expose `getActiveClaims()` — who on the team was
/// searching what — backed by `store.py`'s keyword-claim system. Both are
/// gone: the pipeline no longer claims keywords at all (anyone may run any
/// keyword, and a run that dies mid-keyword no longer locks it), so there
/// were no claims left to report, and the panel that showed them spent most
/// of a run displaying a spinner over stale data.
abstract class SearchRepository {
  Future<SearchRun?> getCurrentRun();
}
