import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';

/// Re-reads an expensive provider when its data changed, but only while the tab
/// it lives on is actually on screen.
///
/// Every top-level section of the app is a branch of
/// `StatefulShellRoute.indexedStack`, which keeps all nine alive at once. That
/// is what makes the app feel instant when switching tabs, and it is also why a
/// naive "re-read whenever the data changes" would be a bad trade here: the
/// dashboard's analytics section aggregates every channel the agency has ever
/// found, and hanging that off [DataDomain.channels] directly would run a full
/// aggregate every time somebody tags a channel three tabs away — work nobody
/// is looking at, on the frame budget of the page they *are* looking at.
///
/// So visibility is the gate. go_router wraps each inactive branch in
/// `TickerMode(enabled: false)`, so [TickerMode.valuesOf] answers "is my tab the one
/// on screen" exactly, with no shell plumbing and no registry of who is where.
/// A change that arrives while this subtree is hidden is remembered, not acted
/// on, and applied the moment it comes back.
///
/// Note what this does NOT gate: a detail route pushed over a list route is in
/// the same branch, so the list underneath stays "visible" by this definition
/// and refreshes immediately. That is deliberate — editing a channel's tags on
/// its profile is precisely the case where the list behind it must already be
/// right when the back button is pressed.
///
/// Cheap reads should not use this. An indexed `COUNT` or a fifty-row list is
/// better off watching [dataRevisionProvider] directly and simply always being
/// right; the ceremony here is only worth it for work measured in frames.
class RefreshWhenVisible extends ConsumerStatefulWidget {
  const RefreshWhenVisible({
    super.key,
    required this.domains,
    required this.onRefresh,
    required this.child,
  });

  /// What this subtree reads. A change to anything else is ignored.
  final Set<DataDomain> domains;

  /// Invalidate whatever this subtree reads. Runs after the frame, because
  /// invalidating a provider during a build would rebuild widgets that are
  /// already building.
  final void Function(WidgetRef ref) onRefresh;

  final Widget child;

  @override
  ConsumerState<RefreshWhenVisible> createState() => _RefreshWhenVisibleState();
}

class _RefreshWhenVisibleState extends ConsumerState<RefreshWhenVisible> {
  /// The revisions this subtree has already caught up to.
  ///
  /// Seeded on the first build rather than starting empty, so mounting the
  /// widget never fires a refresh of data that was just read.
  final Map<DataDomain, int> _applied = {};
  bool _seeded = false;

  @override
  Widget build(BuildContext context) {
    // Registers a dependency, so this rebuilds when the tab is switched to —
    // which is the moment a change that arrived while hidden gets applied.
    final visible = TickerMode.valuesOf(context).enabled;

    final current = <DataDomain, int>{
      for (final domain in widget.domains)
        domain: ref.watch(dataRevisionProvider(domain)),
    };

    if (!_seeded) {
      _seeded = true;
      _applied.addAll(current);
    } else if (visible && !mapEquals(_applied, current)) {
      _applied
        ..clear()
        ..addAll(current);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onRefresh(ref);
      });
    }

    return widget.child;
  }
}
