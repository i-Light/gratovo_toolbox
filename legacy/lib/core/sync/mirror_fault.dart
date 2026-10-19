/// What happens when the local copy itself is the thing that is broken.
///
/// Every other failure in this subsystem is a failure to *reach* the server,
/// and the app's answer to those has always been the same: keep reading the
/// file on disk and try again later. This file is about the opposite failure —
/// the file on disk is the part that stopped working — and until it existed
/// the app had no answer to it at all.
///
/// That gap was not theoretical. Once a first sync has finished,
/// `localMirrorProvider` hands every screen a repository that reads SQLite and
/// nothing else: the influencer list, the dashboard's analytics, the archive,
/// the conflicts banner. A file left half-written by a hard power cut, a
/// database the OS has locked, a disk with nothing left on it, a handle closed
/// underneath an in-flight read by a sign-out on another future — each of them
/// turns every one of those screens into an error state, permanently, with no
/// path back short of a restart and no hint that the network copy was sitting
/// there working the whole time.
///
/// So a read or a write that fails locally does two things. It raises a
/// [MirrorFault], so the caller sees something it can recognise rather than a
/// bare `SqliteException` from three layers down; and it tells the engine the
/// mirror is no longer trustworthy, which drops the whole app back to the
/// network repositories it used before the mirror existed and before a first
/// sync finished. That is a state the app already knows how to be in, which is
/// the entire reason this is a safe thing to do.
library;

import 'package:gratovo_toolbox/core/sync/sync_engine_types.dart';

/// A read or write against the local mirror that did not work.
///
/// Carries the underlying error rather than replacing it — the SQLite message
/// says whether this was a corrupt page, a locked file or a full disk, and
/// that is the difference between "it will fix itself" and "this machine needs
/// attention".
class MirrorFault implements Exception {
  const MirrorFault({
    required this.operation,
    required this.cause,
    this.stackTrace,
  });

  /// `read` or `write` — the two things a repository asks of the mirror.
  final String operation;

  final Object cause;
  final StackTrace? stackTrace;

  @override
  String toString() =>
      'The local copy could not be $operation. The app is reading from the '
      'server instead. Cause: $cause';
}

/// A [LocalSyncDb] that reports its own failures instead of letting them out.
///
/// Sits between the repositories and the real database, and is the only
/// [LocalSyncDb] they are ever handed. Deliberately thin: it does not retry,
/// does not translate SQL and does not decide anything. A local database that
/// refused a query a millisecond ago is not going to accept it a millisecond
/// later, and the useful response — switch the app to the network — is one
/// only the engine can make.
///
/// It still rethrows. The screen that asked has to be told its answer is not
/// coming, and swallowing the error would leave it showing an empty list
/// forever, which is the failure this whole layer exists to avoid. What makes
/// the error survivable is [onFault]: by the time it propagates, the engine has
/// already marked the mirror unusable, every repository provider has rebuilt
/// against Supabase, and the screen's own refetch — which Riverpod runs because
/// its repository changed — goes to the network and succeeds.
class GuardedMirrorDb implements LocalSyncDb, OffThreadReads {
  GuardedMirrorDb(this._inner, {required this.onFault});

  final LocalSyncDb _inner;

  /// Called before the fault is rethrown, so the switch to the network has
  /// already happened by the time anything above sees the error.
  final void Function(MirrorFault fault) onFault;

  @override
  Future<List<Map<String, Object?>>> getAll(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    try {
      return await _inner.getAll(sql, parameters);
    } catch (error, stackTrace) {
      throw _report('read', error, stackTrace);
    }
  }

  @override
  Future<List<Map<String, Object?>>> readOffThread(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    try {
      return await _inner.getAllOffThread(sql, parameters);
    } catch (error, stackTrace) {
      throw _report('read', error, stackTrace);
    }
  }

  @override
  Future<void> execute(
    String sql, [
    List<Object?> parameters = const [],
  ]) async {
    try {
      await _inner.execute(sql, parameters);
    } catch (error, stackTrace) {
      throw _report('written to', error, stackTrace);
    }
  }

  @override
  Future<void> transaction(void Function(LocalSyncTx tx) body) async {
    try {
      await _inner.transaction(body);
    } catch (error, stackTrace) {
      throw _report('written to', error, stackTrace);
    }
  }

  MirrorFault _report(String operation, Object error, StackTrace stackTrace) {
    // A fault this wrapper raised itself is already reported and already
    // phrased for a person. Wrapping it again would nest the same sentence
    // twice and count one failure as two.
    if (error is MirrorFault) return error;

    final fault = MirrorFault(
      operation: operation,
      cause: error,
      stackTrace: stackTrace,
    );
    // Deliberately guarded: the whole promise of this class is that a broken
    // mirror cannot take anything else down with it, and a listener that threw
    // would do exactly that — turning a recoverable local failure into an
    // unhandled one on the way out.
    try {
      onFault(fault);
    } catch (_) {}
    return fault;
  }
}
