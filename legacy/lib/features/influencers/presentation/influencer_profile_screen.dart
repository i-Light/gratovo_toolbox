import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/presence/presence_widgets.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/presentation/influencer_profile_body.dart';
import 'package:gratovo_toolbox/features/team/presentation/owner_picker.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Full channel detail: the channel's own art and numbers, how to reach it,
/// recent uploads, what it is worth, notes, and its full deal history — every
/// deal this channel has ever been part of, oldest engagement never
/// overwritten by a newer one. That history lives on `Deal` rather than
/// here — see that model's doc for why.
///
/// This is only the [Scaffold] chrome — title, presence avatars — around
/// [InfluencerProfileBody], which carries every card and is also what the
/// Outreach page docks beside its composer.
class InfluencerProfileScreen extends ConsumerWidget {
  const InfluencerProfileScreen({super.key, required this.influencerId});

  final String influencerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final influencerAsync = ref.watch(influencerByIdProvider(influencerId));

    return Scaffold(
      appBar: GradientAppBar(
        // Reached with `context.go`, so there is no page to pop — the back
        // button returns to the Roster page explicitly.
        leading: BackButton(onPressed: () => context.go(AppRoutes.roster)),
        title: influencerAsync.maybeWhen(
          // The channel's real name, which is often nothing like its handle.
          data: (influencer) =>
              GradientText(influencer?.displayName ?? l10n.navInfluencers),
          orElse: () => GradientText(l10n.navInfluencers),
        ),
        actions: [
          // Wave 2: ownership picker
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: influencerAsync.maybeWhen(
              data: (influencer) => influencer == null
                  ? const SizedBox.shrink()
                  : OwnerPicker(
                      ownerId: influencer.ownerId,
                      onChanged: (ownerId) async {
                        await ref
                            .read(influencerRepositoryProvider)
                            .updateOwner(influencer.id, ownerId);
                        ref.bumpData(const {DataDomain.channels});
                      },
                    ),
              orElse: () => const SizedBox.shrink(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: EntityPresenceAvatars(type: 'channel', id: influencerId),
          ),
        ],
      ),
      body: InfluencerProfileBody(
        influencerId: influencerId,
        withEditingScope: true,
      ),
    );
  }
}
