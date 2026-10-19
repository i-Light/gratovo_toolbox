import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/features/search/application/active_search_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/backfill_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/reenrich_run_controller.dart';
import 'package:gratovo_toolbox/features/search/application/video_catchup_controller.dart';

/// Does what the real `startSearch` does right before launching: asks the
/// catch-up sweep whether it needs to step aside. That `ref.read` is the one
/// Riverpod's debug-mode graph check inspects.
class _AskingActiveSearchRun extends ActiveSearchRunNotifier {
  bool askCatchUp() =>
      ref.read(videoCatchUpControllerProvider.notifier).isRunning;
}

class _AskingBackfillRun extends BackfillRunNotifier {
  bool askCatchUp() =>
      ref.read(videoCatchUpControllerProvider.notifier).isRunning;
}

class _AskingReenrichRun extends ReenrichRunNotifier {
  bool askCatchUp() =>
      ref.read(videoCatchUpControllerProvider.notifier).isRunning;
}

void main() {
  // The catch-up sweep listens to the three jobs that can displace it, so it
  // can resume once they finish — and each of those three reads the sweep
  // right before launching, to tell it to step aside. Subscribing with
  // `ref.listen` made the sweep a graph dependent of all three, which Riverpod
  // reports as `CircularDependencyError` the moment a search starts. This pins
  // the shape that avoids it.
  test('a job may read the catch-up sweep after the sweep subscribed to it',
      () {
    final container = ProviderContainer(
      overrides: [
        activeSearchRunControllerProvider
            .overrideWith(_AskingActiveSearchRun.new),
        backfillRunControllerProvider.overrideWith(_AskingBackfillRun.new),
        reenrichRunControllerProvider.overrideWith(_AskingReenrichRun.new),
      ],
    );
    addTearDown(container.dispose);

    // Builds the sweep first, as `app.dart` does at launch — its
    // subscriptions to the three jobs are what created the cycle.
    container.read(videoCatchUpControllerProvider);

    final search = container.read(activeSearchRunControllerProvider.notifier)
        as _AskingActiveSearchRun;
    final backfill = container.read(backfillRunControllerProvider.notifier)
        as _AskingBackfillRun;
    final reenrich = container.read(reenrichRunControllerProvider.notifier)
        as _AskingReenrichRun;

    expect(search.askCatchUp, returnsNormally);
    expect(backfill.askCatchUp, returnsNormally);
    expect(reenrich.askCatchUp, returnsNormally);
  });
}
