import 'package:flutter/material.dart';

/// A small colored pill for a status label (vetting status, deal stage,
/// search-run status, ...). Purely presentational — callers decide the
/// label text and color; see `lib/core/status/status_presentation.dart`
/// for the actual enum-to-label/color mappings this is normally fed from.
class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: color,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }
}
