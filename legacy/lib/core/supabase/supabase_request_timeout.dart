import 'dart:async';

/// How long a live (non-mirror) Supabase read may take before it is treated
/// as failed rather than left to hang.
///
/// `package:http` does not time out on its own — a connection that is
/// accepted and then goes quiet (a proxy that never sends the rest of the
/// response, a pooler recycling mid-request) leaves the `Future` simply never
/// completing. `core/sync/mirror_network.dart` learned this the hard way for
/// the mirror's own requests; News and the Activity Log make the same kind of
/// call through the same `SupabaseClient` with no timeout of their own, so a
/// connection that goes quiet for one of them shows as "loading forever" with
/// no error to retry from — exactly what an unwrapped request looks like.
///
/// A flat duration rather than [mirror_network.dart]'s row-scaled budget:
/// every call this wraps returns at most a page of rows (news items, log
/// entries, actors, sources), never the several-hundred-row transfer the
/// mirror sizes its own budget around.
const kSupabaseRequestTimeout = Duration(seconds: 20);

extension SupabaseRequestTimeout<T> on Future<T> {
  /// Fails with a readable [TimeoutException] instead of hanging.
  ///
  /// Named for what stalled, not for the value: "News did not answer" reads
  /// better in a retry banner than "TimeoutException after 0:00:20".
  ///
  /// [limit] overrides the flat budget for a call that is genuinely doing work
  /// rather than reading a page: the bulk clean's deletions are a row-by-row
  /// loop with a cascading delete per channel, and twenty seconds is a normal
  /// batch rather than a stall. What must never happen is *no* limit -- a
  /// request that hangs leaves a modal with every button disabled and nothing
  /// on screen to explain it.
  Future<T> withSupabaseTimeout(String what, {Duration? limit}) {
    final budget = limit ?? kSupabaseRequestTimeout;
    return timeout(
      budget,
      onTimeout: () => throw TimeoutException(
        'The server did not answer while trying to $what.',
        budget,
      ),
    );
  }
}
