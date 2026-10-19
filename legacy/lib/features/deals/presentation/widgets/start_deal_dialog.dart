import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/activity_log_query.dart';
import 'package:gratovo_toolbox/data/models/agency_settings.dart';
import 'package:gratovo_toolbox/data/models/brand.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/brands/application/boycott_check.dart';
import 'package:gratovo_toolbox/features/brands/presentation/widgets/brand_form_dialog.dart';
import 'package:gratovo_toolbox/features/deals/application/deal_stage_controller.dart';
import 'package:gratovo_toolbox/features/deals/presentation/widgets/deal_terms_dialog.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Start deal (fix #6): from a creator's profile, a thread, or a campaign
/// shortlist row ([brandId] and [campaignId] already known there). The deal
/// starts as proposed and the channel's stage follows it. A boycotted brand
/// (HC-09) or an out-of-scope creator (HC-08) gets no deal.
Future<Deal?> showStartDealDialog(
  BuildContext context, {
  required Influencer creator,
  String? brandId,
  String? campaignId,
}) async {
  final draft = await showDialog<Deal>(
    context: context,
    builder: (context) => _StartDealDialog(
      creator: creator,
      brandId: brandId,
      campaignId: campaignId,
    ),
  );
  if (draft == null || !context.mounted) return null;
  final container = ProviderScope.containerOf(context, listen: false);
  final l10n = AppLocalizations.of(context);
  try {
    final deal = await container.read(dealRepositoryProvider).create(draft);
    await container
        .read(dealStageControllerProvider)
        .followLatestDeal(deal, deal.stage);
    container
        .read(dataRevisionsProvider.notifier)
        .bump({DataDomain.deals, DataDomain.channels});
    try {
      container.read(activityLoggerProvider).record(ActivityDraft(
            action: ActivityAction.created,
            entityType: 'deal',
            entityId: deal.id,
            entityLabel: creator.handle,
          ));
    } on Object catch (_) {
      // Best-effort: the deal exists either way.
    }
    if (context.mounted) {
      AppToast.success(context, l10n.dealStarted);
      if (GoRouter.maybeOf(context) != null) {
        context.go(AppRoutes.dealDetail(deal.id));
      }
    }
    return deal;
  } on Exception catch (error) {
    if (context.mounted) AppToast.error(context, '$error');
    return null;
  }
}

class _StartDealDialog extends ConsumerStatefulWidget {
  const _StartDealDialog({
    required this.creator,
    this.brandId,
    this.campaignId,
  });

  final Influencer creator;
  final String? brandId;
  final String? campaignId;

  @override
  ConsumerState<_StartDealDialog> createState() => _StartDealDialogState();
}

class _StartDealDialogState extends ConsumerState<_StartDealDialog> {
  final _formKey = GlobalKey<FormState>();
  final _terms = DealTermsControllers();
  late String? _brandId = widget.brandId;

  @override
  void dispose() {
    _terms.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final brands = ref.watch(allBrandsProvider).value ?? const <Brand>[];
    final agency =
        ref.watch(agencySettingsProvider).value ?? const AgencySettings();
    Brand? brand;
    for (final candidate in brands) {
      if (candidate.id == _brandId) brand = candidate;
    }
    final hit = brand == null ? null : boycottHit(brand, agency);
    final outOfScope = widget.creator.creatorGender?.outOfScope ?? false;
    final blocked = hit != null || outOfScope;

    Widget warning(String text) => Row(
          children: [
            ExcludeSemantics(
              child: Icon(Icons.block, color: theme.colorScheme.error),
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
          ],
        );

    return AlertDialog(
      title: Text(l10n.dealStartTitle(widget.creator.handle)),
      content: SizedBox(
        width: 520,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              spacing: 12,
              children: [
                if (outOfScope) warning(l10n.creatorFlagOutOfScope),
                DropdownButtonFormField<String>(
                  key: const ValueKey('deal-brand'),
                  initialValue: _brandId,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.dealFormBrand,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final b in brands)
                      DropdownMenuItem(value: b.id, child: Text(b.name)),
                  ],
                  onChanged: (value) => setState(() => _brandId = value),
                  validator: (value) =>
                      value == null ? l10n.dealFormBrandRequired : null,
                ),
                if (hit != null) warning(boycottMessage(l10n, hit)),
                DealTermsFields(controllers: _terms),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: blocked
              ? null
              : () {
                  if (!(_formKey.currentState?.validate() ?? false)) return;
                  final terms = _terms.read();
                  final now = DateTime.now().toUtc();
                  Navigator.of(context).pop(Deal(
                    id: '',
                    brandId: _brandId!,
                    influencerId: widget.creator.id,
                    stage: DealStage.proposed,
                    brandPrice: terms.brandPrice,
                    influencerPayout: terms.influencerPayout,
                    currency: terms.currency,
                    deliverables: terms.deliverables,
                    deadline: terms.deadline,
                    paymentTerms: terms.paymentTerms,
                    trackingLink: terms.trackingLink,
                    campaignId: widget.campaignId,
                    createdAt: now,
                    updatedAt: now,
                  ));
                },
          child: Text(l10n.dealStart),
        ),
      ],
    );
  }
}
