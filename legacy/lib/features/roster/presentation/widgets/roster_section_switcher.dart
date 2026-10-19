import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/features/roster/application/roster_section_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The Roster page's app-bar title: the current section's icon and name with a
/// dropdown caret. Tapping it opens a menu of all three sections — each with its
/// icon — and picking one swaps the body via [rosterSectionProvider].
///
/// Dropped into each list screen's `AppBar` in place of its plain `Text` title,
/// so whichever section is showing, its own app bar carries the switcher.
class RosterSectionSwitcher extends ConsumerWidget {
  const RosterSectionSwitcher({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final current = ref.watch(rosterSectionProvider);
    final theme = Theme.of(context);

    return MenuAnchor(
      builder: (context, controller, _) => InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => controller.isOpen ? controller.close() : controller.open(),
        child: Padding(
          // 10, not 4: this is how the roster's three sections are switched,
          // and at 4 the whole control stood 36px tall — under every platform's
          // minimum for something you have to hit. The toolbar is 56px, so the
          // taller target costs no layout.
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(current.icon, size: 20),
              const SizedBox(width: 8),
              Flexible(
                child: GradientText(
                  current.label(l10n),
                  style: theme.textTheme.titleLarge,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(Icons.arrow_drop_down),
            ],
          ),
        ),
      ),
      menuChildren: [
        for (final section in RosterSection.values)
          MenuItemButton(
            leadingIcon: Icon(
              section.icon,
              color: section == current ? theme.colorScheme.primary : null,
            ),
            trailingIcon:
                section == current ? const Icon(Icons.check, size: 18) : null,
            onPressed: () =>
                ref.read(rosterSectionProvider.notifier).select(section),
            child: Text(section.label(l10n)),
          ),
      ],
    );
  }
}
