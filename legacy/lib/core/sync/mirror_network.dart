import 'dart:async';

import 'package:gratovo_toolbox/core/sync/sync_diagnostics.dart';
import 'package:supabase_flutter/supabase_flutter.dart'
    show AuthException, PostgrestException;

/// How long a *small* request the mirror makes to Supabase may take before it
/// is treated as a failure.
///
/// Nothing in `package:http` times out on its own, so a connection that is
/// accepted and then goes quiet — a server behind a proxy that never sends the
/// reply, a laptop that suspended part-way through a page — leaves the `await`
/// inside `MirrorPuller.pull` or `MirrorUploader.drain` hanging for the rest of
/// the process' life. That is not a hypothetical: it is what put the sync
/// button into a spinner that never stopped and the Settings card into
/// "Offline" with no error beside it to explain either. A pass that cannot
/// finish also cannot fail, so nothing ever retried and nothing was ever
/// reported.
///
/// This is the budget for a request that returns one row or writes one edit.
/// A page of 500 channels is not that request and must not share its budget —
/// see [mirrorTimeoutForRows].
const kMirrorRequestTimeout = Duration(seconds: 45);

/// The time budget for a request that asks for [rows] rows.
///
/// A single flat 45 seconds for everything is what put "TimeoutException after
/// 0:00:45 … while trying to download channels" in front of people, over and
/// over. It charged a page of 500 channel rows — several megabytes, most of it
/// description text — the same budget as a one-row lookup, so the *largest*
/// request the app makes was the one with the least headroom, and on a hotel
/// connection or a laptop sharing its uplink with a running scrape it simply
/// could not finish in time. Nothing was broken; the deadline was wrong.
///
/// So the budget scales with the work asked for. The fixed part covers the
/// round trip, the TLS handshake and the server's own planning; the per-row
/// part is the transfer, sized so that a page still completes on a connection
/// managing roughly a tenth of what an office line does.
///
/// Capped, because "wait as long as it takes" is how the spinner-that-never-
/// stops came back. A minute is roughly a hundred times what a healthy full
/// page measures — 500 channel rows, 571 kB, come down in about 0.6 s — so
/// nothing that is actually working is cut off by it, and a request still
/// stuck at a minute is not going to be rescued by a second one.
///
/// This is only the ceiling for a single request. What actually bounds a pass
/// is [MirrorDeadline], and it has to: three attempts at a minute each, across
/// seven tables, is half an hour of a spinner nobody asked for.
Duration mirrorTimeoutForRows(int rows) {
  const base = Duration(seconds: 20);
  const perRow = Duration(milliseconds: 90);
  const ceiling = Duration(seconds: 60);

  final scaled = base + perRow * rows;
  return scaled > ceiling ? ceiling : scaled;
}

/// The wall clock for one whole sync pass.
///
/// The bound that was missing, and whose absence is what "it just loads
/// forever" actually was. Every individual request had a deadline, so nothing
/// hung in the sense of never returning — but the *pass* had none, and the
/// per-request budgets multiplied: three attempts on a page, several pages to a
/// table, seven tables to a pass. A machine whose downloads were all failing
/// spent nearly half an hour working through that arithmetic before it said so,
/// having been told by the first fifteen seconds everything the last twenty-nine
/// minutes went on to confirm.
///
/// So a pass gets one budget and spends it. Running out is deliberately NOT a
/// failure: page cursors are written as each page lands, so a pass that stops
/// early has genuinely banked its progress and the next one resumes from there.
/// That is what makes a first sync of a large table safe to interrupt — it
/// arrives over several passes instead of one long one, and neither the person
/// nor the connection is held hostage while it does.
class MirrorDeadline {
  MirrorDeadline(this.budget) : _endsAt = DateTime.now().add(budget);

  /// A pass with no ceiling, for tests and for callers that bound themselves.
  MirrorDeadline.unbounded()
      : budget = const Duration(days: 1),
        _endsAt = DateTime.now().add(const Duration(days: 1));

  final Duration budget;
  final DateTime _endsAt;

  Duration get remaining {
    final left = _endsAt.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  Duration get spent => budget - remaining;

  /// Whether there is enough left to be worth starting another request.
  ///
  /// [minimum] rather than "is there any time at all", because a request
  /// started with two seconds left cannot succeed and cannot fail informatively
  /// — it just spends a round trip to report the deadline that was already
  /// known before it was sent. Stopping one request early is cheaper than a
  /// timeout that teaches nobody anything.
  bool hasRoomFor(Duration minimum) => remaining >= minimum;

  /// [want], or whatever is left of the pass if that is less.
  Duration clamp(Duration want) => want <= remaining ? want : remaining;

  /// [want], but never spending the last [reserve] of the pass.
  ///
  /// For work that must leave the pass able to do something afterwards. The
  /// case it exists for is the page retry ladder: two attempts at a minute each
  /// exactly consume a two-minute pass, so every failure was logged with
  /// `passLeftMs=0` and [MirrorPuller._probeAfterFailure] — the one thing in
  /// the system that can tell "the server is slow" apart from "this query is
  /// slow" — was skipped for want of five seconds, every single time. The
  /// diagnostic was unreachable in precisely the failure it was built for.
  ///
  /// Never returns a negative duration, and deliberately still returns
  /// something once the reserve is already gone: a caller that has run past it
  /// gets a short request rather than a zero-length one that cannot even fail
  /// informatively. Whether to start at all is [hasRoomFor]'s question.
  Duration clampLeaving(Duration want, Duration reserve) {
    final spendable = remaining - reserve;
    if (spendable <= Duration.zero) return clamp(want);
    return want <= spendable ? want : spendable;
  }

  /// A deadline nested inside this one, ending at the sooner of [cap] from now
  /// and this one's own end.
  ///
  /// For dividing a pass between halves that must both get a turn. Handing the
  /// upload queue the whole pass budget would be correct and useless: a machine
  /// with a long queue would spend every pass sending and never download at
  /// all, which is the same starvation this class exists to prevent, only
  /// pointed the other way.
  MirrorDeadline within(Duration cap) => MirrorDeadline(clamp(cap));
}

/// The wait before attempt [attempt] of a request (1 being the first retry).
///
/// Short, and short on purpose. This is the gap between two tries *inside* one
/// pass, for a blip that is usually over before the second attempt starts — a
/// Wi-Fi roam, a token refresh, a Supabase pooler recycling a connection. The
/// long ladder for a server that is genuinely down lives in
/// `mirror_engine_io.dart`, measured in minutes, and this must not turn into a
/// second copy of it: a pass that retried for five minutes would hold the
/// spinner, block the next pass, and delay the honest "this is not working"
/// that the person actually needs to see.
Duration mirrorAttemptDelay(int attempt) => switch (attempt) {
      1 => const Duration(seconds: 1),
      _ => const Duration(seconds: 4)
    };

/// How many times one request is attempted before the pass gives up on it.
const kMirrorAttempts = 3;

/// The page a retry should ask for after one of [lastRequested] failed.
///
/// A quarter of the last ask, never below [kMirrorMinPageSize]. Top-level and
/// tested on its own because it is a policy, not a detail: it decides how fast
/// a table that cannot land its first page climbs down to one it can, and every
/// pass until it does is a pass where nothing behind that page moves at all.
int mirrorRetryPageSize(int lastRequested) {
  final smaller = lastRequested ~/ 4;
  return smaller < kMirrorMinPageSize ? kMirrorMinPageSize : smaller;
}

/// The smallest page a retry will fall back to.
///
/// A page that keeps timing out is retried a quarter of the size each time
/// (see `MirrorPuller._fetchPage`), and this is where that stops. Below about
/// this many rows the round trip costs more than the rows do, and a backlog of
/// thousands drained twenty-five at a time is its own kind of stuck.
const kMirrorMinPageSize = 25;

/// The slice of a pass kept back for the probes that run after a failure.
///
/// Enough for both of them — a 15-second reach probe and a 30-second one-row
/// query — plus the moment between. Without it the retry ladder eats the pass
/// to the millisecond and the probes never run; see [MirrorDeadline.clampLeaving]
/// for the failure that taught us this.
///
/// It is not free: a pass that would have spent this on a third attempt now
/// spends it on evidence instead. That is the right trade. A third attempt at a
/// request that has already failed twice the same way has never once succeeded
/// in the logs, and the probes settle in five seconds a question that has
/// otherwise cost days.
const Duration kMirrorProbeReserve = Duration(seconds: 50);

/// The least time worth starting another queued upload with.
///
/// Same reasoning as the page equivalent: a send begun with two seconds
/// left cannot finish, and failing it would put a perfectly good edit
/// through the retry accounting for no reason. Leaving it queued is free.
const Duration kMirrorMinUploadTime = Duration(seconds: 8);

/// Whether a failure is worth trying again, or is the server's final answer.
///
/// The distinction the whole retry policy rests on. Everything that is a
/// property of *the moment* — no route to the host, a TLS handshake that did
/// not complete, a pooler that closed the connection, a 500, a token being
/// refreshed on another future — is worth a second attempt a second later.
/// Everything that is a property of *the request* — a column that does not
/// exist, a row this account may not read, a constraint it violates — will be
/// refused identically for as long as anybody cares to ask, and retrying it
/// only delays reporting it.
///
/// `dart:io` types are matched by name so this file stays importable from the
/// web build, which has none of them.
bool isTransientMirrorFailure(Object error) {
  if (error is TimeoutException) return true;

  // A token being refreshed, or one that expired between the request being
  // composed and sent. The client refreshes on its own; the next attempt
  // usually carries a good one.
  if (error is AuthException) return true;

  if (error is PostgrestException) {
    final code = error.code;
    // No code at all is what a transport failure looks like once PostgREST has
    // wrapped it, and what an HTML error page from a proxy in front of Supabase
    // decodes to. Both are "not now" rather than "never".
    if (code == null || code.isEmpty) return true;
    // PostgREST puts the HTTP status in `code` for anything the database did
    // not name itself: 5xx is the server's problem, 408 and 429 are explicit
    // "ask again". Told apart from a Postgres SQLSTATE by length, and that is
    // not a nicety — a SQLSTATE is five characters and `42501` (the RLS
    // refusal) parses as an integer well above 500. Read as a status it looks
    // like a server error, and the client retries a permissions refusal three
    // times before reporting it, every pass, forever.
    if (code.length == 3) {
      final status = int.tryParse(code);
      if (status != null) {
        return status >= 500 || status == 408 || status == 429;
      }
    }
    return switch (code) {
      '57014' => true, // statement timeout — the query, not the request
      '55P03' =>
        true, // lock_timeout — a writer we collided with, gone next try
      '53300' => true, // too many connections
      '40001' => true, // serialisation failure
      '40P01' => true, // deadlock
      '08006' || '08003' || '08000' => true, // connection exceptions
      _ => code.startsWith('08') || code.startsWith('53'),
    };
  }

  return switch (error.runtimeType.toString()) {
    'SocketException' => true,
    'HandshakeException' => true,
    'TlsException' => true,
    'HttpException' => true,
    'ClientException' => true,
    _ => false,
  };
}

extension MirrorRequestTimeout<T> on Future<T> {
  /// Fails with a readable [TimeoutException] instead of hanging.
  ///
  /// [what] is completed into "The server did not answer while trying to …",
  /// because this message is what the Settings card shows verbatim when a sync
  /// fails, and "TimeoutException after 0:00:45" tells the reader nothing about
  /// which half of the sync gave up.
  Future<T> withMirrorTimeout(String what, [Duration? budget]) {
    final limit = budget ?? kMirrorRequestTimeout;
    return timeout(
      limit,
      onTimeout: () => throw TimeoutException(
        'The server did not answer while trying to $what.',
        limit,
      ),
    );
  }
}

/// Runs one server call, retrying the failures that are worth retrying, and
/// writing down what happened either way.
///
/// The "either way" is the part that matters. Before this, a pass logged
/// nothing at all when it worked, so the only evidence a failure ever left was
/// the failure itself — and a timeout with no record of the nine requests
/// before it that took four seconds each is a fact with nothing to compare it
/// to. Every attempt is timed and recorded here, so the log answers "was this
/// getting slower all morning or did it fall off a cliff" without anybody
/// having to reproduce it.
///
/// [what] is the human phrase used in the timeout message and the log.
/// [event] is the machine-stable dotted name for the log line. [fields] are
/// whatever the caller knows that the reader will want — the table, the cursor,
/// the page size.
Future<T> runMirrorRequest<T>({
  required String what,
  required String event,
  required Future<T> Function() call,
  SyncDiagnostics? log,
  Duration? budget,
  int attempts = kMirrorAttempts,
  Map<String, Object?> fields = const {},
}) async {
  final limit = budget ?? kMirrorRequestTimeout;

  for (var attempt = 1;; attempt++) {
    final started = DateTime.now();
    try {
      final result = await call().withMirrorTimeout(what, limit);
      log?.log(
        event,
        what,
        level: SyncLogLevel.debug,
        fields: {
          ...fields,
          'attempt': attempt,
          'elapsedMs': DateTime.now().difference(started).inMilliseconds,
          'budgetMs': limit.inMilliseconds,
        },
      );
      return result;
    } catch (error) {
      final elapsed = DateTime.now().difference(started);
      final transient = isTransientMirrorFailure(error);
      final last = attempt >= attempts || !transient;

      log?.log(
        '$event.failed',
        last
            ? 'Gave up trying to $what.'
            : 'Failed trying to $what; trying again.',
        level: last ? SyncLogLevel.error : SyncLogLevel.warn,
        fields: {
          ...fields,
          'attempt': attempt,
          'of': attempts,
          'elapsedMs': elapsed.inMilliseconds,
          'budgetMs': limit.inMilliseconds,
          'transient': transient,
        },
        error: error,
      );

      if (last) rethrow;
      await Future<void>.delayed(mirrorAttemptDelay(attempt));
    }
  }
}
