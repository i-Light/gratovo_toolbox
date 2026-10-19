import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/capabilities/app_capabilities.dart';

/// Declaratively hides [child] unless the current build's capabilities
/// allow it. Defaults to gating on [AppCapabilities.canRunSearch]; pass
/// [requires] to gate on a different capability (e.g.
/// `(caps) => caps.canTuneScrapingSettings`) instead.
///
/// Use this instead of an inline platform check scattered through feature
/// code — see app_capabilities.dart for why.
class DesktopOnly extends ConsumerWidget {
  const DesktopOnly({
    super.key,
    required this.child,
    this.fallback,
    this.requires,
  });

  final Widget child;
  final Widget? fallback;
  final bool Function(AppCapabilities caps)? requires;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final caps = ref.watch(capabilitiesProvider);
    final allowed = (requires ?? (c) => c.canRunSearch)(caps);
    return allowed ? child : (fallback ?? const SizedBox.shrink());
  }
}
