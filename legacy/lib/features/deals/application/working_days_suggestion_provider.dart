import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/deals/application/working_days_suggestion.dart';

/// Wires up [computeWorkingDaysSuggestion] for one deal: the deal itself
/// (for [Deal.stage]/[Deal.createdAt]/[Deal.updatedAt]), its influencer's
/// outreach thread and that thread's messages — reusing the entity providers
/// every other screen already reads from, rather than adding new repository
/// wiring for this feature.
///
/// Null when the deal isn't found, its influencer has no outreach thread
/// yet, or [computeWorkingDaysSuggestion] itself has nothing to suggest.
final workingDaysSuggestionProvider =
    FutureProvider.family<WorkingDaysSuggestion?, String>(
  (ref, dealId) async {
    final deal = await ref.watch(dealByIdProvider(dealId).future);
    if (deal == null) return null;

    final thread =
        await ref.watch(threadByInfluencerProvider(deal.influencerId).future);
    if (thread == null) return null;

    final messages =
        await ref.watch(messagesByThreadProvider(thread.id).future);
    return computeWorkingDaysSuggestion(deal: deal, messages: messages);
  },
);
