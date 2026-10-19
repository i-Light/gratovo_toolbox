import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/features/archive/presentation/archive_screen.dart';
import 'package:gratovo_toolbox/features/brands/presentation/brand_list_screen.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_list_screen.dart';
import 'package:gratovo_toolbox/features/roster/application/roster_section_controller.dart';

/// One nav-rail destination for the three record lists the team keeps —
/// influencers, brands, and the archive of rejected channels. You switch
/// between them from the app bar title (see `RosterSectionSwitcher`), not the
/// rail.
///
/// The three screens keep their own `Scaffold`/`AppBar` and every control on
/// them untouched — this only chooses which one is on screen. An [IndexedStack]
/// rather than a `switch` so each keeps its widget state (scroll position, the
/// influencer list's pin) while the other two sit behind it.
class RosterScreen extends ConsumerWidget {
  const RosterScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final section = ref.watch(rosterSectionProvider);
    return IndexedStack(
      index: section.index,
      children: const [
        InfluencerListScreen(),
        BrandListScreen(),
        ArchiveScreen(),
      ],
    );
  }
}
