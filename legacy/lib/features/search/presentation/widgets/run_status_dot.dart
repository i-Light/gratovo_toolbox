import 'package:flutter/material.dart';

/// How a pipeline job's status reads at a glance, whichever job it is.
enum RunDotState { running, done, paused, failed, idle }

/// The 16 px status glyph at the head of every progress panel on the Search
/// page: a spinner while running, a tick / pause / error mark after. Each
/// panel maps its own status enum onto [RunDotState] so the four of them
/// cannot drift apart in size, color or icon.
class RunStatusDot extends StatelessWidget {
  const RunStatusDot(this.state, {super.key});

  final RunDotState state;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    if (state == RunDotState.running) {
      return SizedBox(
        width: 14,
        height: 14,
        child: CircularProgressIndicator(strokeWidth: 2, color: scheme.primary),
      );
    }
    final (icon, color) = switch (state) {
      RunDotState.done => (Icons.check_circle, scheme.primary),
      // Not an error color: a job stepping aside for another is the job
      // working as intended.
      RunDotState.paused => (Icons.pause_circle_filled, scheme.tertiary),
      RunDotState.failed => (Icons.error, scheme.error),
      RunDotState.running || RunDotState.idle => (
          Icons.circle_outlined,
          scheme.outline
        ),
    };
    return Icon(icon, size: 16, color: color);
  }
}
