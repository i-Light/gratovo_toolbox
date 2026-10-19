import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/images/tagged_image_cleanup.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Watches the window's focus and, once it has stayed out of focus for
/// [idleThreshold] with no return to the foreground, runs
/// [TaggedImageCleanup] once.
///
/// Held here rather than in a widget's `State` so it survives navigation and
/// exists exactly once for the app's lifetime — the same reasoning behind
/// `presenceControllerProvider`/`liveDataControllerProvider`, which this is
/// watched alongside in `AppShell`.
class TaggedImageCleanupController extends Notifier<void> {
  static const idleThreshold = Duration(minutes: 20);

  AppLifecycleListener? _listener;
  Timer? _timer;

  @override
  void build() {
    ref.onDispose(() {
      _timer?.cancel();
      _listener?.dispose();
    });

    _listener = AppLifecycleListener(
      onStateChange: (state) {
        if (state == AppLifecycleState.resumed) {
          _timer?.cancel();
          _timer = null;
          return;
        }
        // Any non-resumed state counts as "out of focus". The timer is only
        // ever started once per unfocused stretch — `resumed` above is what
        // cancels it, so regaining and losing focus again starts a fresh one.
        _timer ??= Timer(idleThreshold, _runCleanup);
      },
    );
  }

  void _runCleanup() {
    _timer = null;
    unawaited(TaggedImageCleanup.run(ref.read(influencerRepositoryProvider)));
  }
}

final taggedImageCleanupControllerProvider =
    NotifierProvider<TaggedImageCleanupController, void>(
  TaggedImageCleanupController.new,
);
