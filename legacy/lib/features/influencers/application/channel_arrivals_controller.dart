import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';

/// Where channels that turned up on their own came from.
///
/// Two answers, because there are two mechanisms and a person can act on the
/// difference. A run on this machine is something they (or whoever is at this
/// desk) started and can stop from the Search page; the team's shared data is
/// somebody else's work arriving through the mirror, which nothing here
/// started and nothing here can stop.
enum ChannelArrivalSource {
  /// A pipeline run on this computer is inserting them right now — a search,
  /// or the re-enrich that frees a channel from the archive. Includes the run
  /// the app resumes by itself at launch after a session that was killed
  /// mid-run, which is the case nobody could account for: nothing was pressed,
  /// and channels appeared anyway.
  localRun,

  /// They were downloaded from Supabase into the local mirror — a teammate's
  /// search, or this machine's own pipeline results coming back round. See
  /// `mirrorChangeAnnouncerProvider`.
  teamSync,
}

/// Channels that appeared in the Influencer list without anybody asking.
class ChannelArrivals {
  const ChannelArrivals({
    required this.count,
    required this.source,
    required this.at,
  });

  /// How many rows the list gained. Accumulated across a burst rather than
  /// replaced: a search run announces finds every keyword, and a notice that
  /// restarted from "3" every twenty seconds would be less informative than
  /// the total it is standing in for.
  final int count;
  final ChannelArrivalSource source;
  final DateTime at;
}

/// How long a notice stays up before clearing itself.
///
/// It is an explanation, not a task: the person it is for is looking at the
/// list when the rows arrive, and a bar that had to be dismissed would be one
/// more thing to dismiss on a busy machine where a run is finding channels all
/// afternoon.
const _noticeLifetime = Duration(seconds: 25);

/// Says out loud that the list just grew, and what put the rows there.
///
/// The gap this fills: channels arrive in this app through three different
/// mechanisms, none of which is a thing anybody pressed — the mirror's own
/// three-hourly pull, the catch-up pull a realtime push asks for, and a search
/// run that the app may have resumed by itself at launch. All three end at the
/// same place, `dataRevisionProvider(DataDomain.channels)`, which re-reads the
/// loaded rows with no loading state at all so that a tag edit two screens away
/// does not make the list blink. That is right for an edit and wrong for an
/// arrival: rows silently appeared, in a list somebody was reading, with
/// nothing anywhere in the app accounting for them.
///
/// Fed by [InfluencerPageNotifier], which is the only thing that can tell an
/// arrival from a change — it holds the ids that were on screen before the
/// re-read and the ids that are on screen after it.
class ChannelArrivalsNotifier extends Notifier<ChannelArrivals?> {
  Timer? _expiry;

  @override
  ChannelArrivals? build() {
    ref.onDispose(() => _expiry?.cancel());
    return null;
  }

  /// Records [count] rows the list gained on its own. A no-op for zero, which
  /// is the overwhelmingly common outcome of a re-read.
  void report(int count) {
    if (count <= 0) return;
    final source = _currentSource();
    final previous = state;
    // Only the same source accumulates. A run finishing and a teammate's rows
    // landing a moment later are two different pieces of news, and adding them
    // together would attribute one of them to the wrong place.
    final total = previous != null && previous.source == source
        ? previous.count + count
        : count;
    state = ChannelArrivals(count: total, source: source, at: DateTime.now());
    _expiry?.cancel();
    _expiry = Timer(_noticeLifetime, () => state = null);
  }

  /// Clears the notice — the dismiss button, and anything else that has made
  /// the news redundant.
  void dismiss() {
    _expiry?.cancel();
    state = null;
  }

  /// Which mechanism is the honest attribution right now.
  ///
  /// Deliberately asks only about the two jobs that can *add a channel*. The
  /// video catch-up and the manual backfill both run for a long time and add
  /// no channels at all — only videos to channels already here — so naming
  /// either of them would be a confident wrong answer, which is worse than the
  /// silence this replaces.
  ChannelArrivalSource _currentSource() {
    try {
      final searching =
          ref.read(activeSearchRunControllerProvider.notifier).isRunning;
      final reenriching =
          ref.read(reenrichRunControllerProvider.notifier).isRunning;
      if (searching || reenriching) return ChannelArrivalSource.localRun;
    } catch (_) {
      // A container without those controllers (a widget test) is not a reason
      // to refuse to explain an arrival.
    }
    return ChannelArrivalSource.teamSync;
  }
}

final channelArrivalsProvider =
    NotifierProvider<ChannelArrivalsNotifier, ChannelArrivals?>(
  ChannelArrivalsNotifier.new,
);
