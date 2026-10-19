import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/models/campaign_shortlist_entry.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/media_kit.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_filter_controller.dart';
import 'package:gratovo_toolbox/features/influencers/application/influencer_mutation_guard.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Wraps a row or card so that right-clicking it offers the two dropdowns
/// that otherwise need a trip into the channel's own page: its pipeline
/// [PipelineStage] (single-select) and its [ChannelTag]s (multi-select), plus
/// a shortcut into the profile itself.
///
/// Right-click AND long-press, because this app runs on a Windows desktop and
/// on touch, and only one of those has a right button. Long-press does not
/// conflict with anything: the tile's only other gesture is a tap.
///
/// The menu opens at the pointer rather than at the widget's corner, which is
/// what every desktop context menu does and what makes it feel native rather
/// than like a dialog that happened to appear.
///
/// While Ctrl or Alt is held, hovering paints a translucent halo around
/// whichever card the pointer is over, previewing where a Ctrl/Alt +
/// right-click would land — primary-tinted for Ctrl (adds the preset tags),
/// error-tinted for Alt (removes them). It is a fill outside the card's own
/// edge rather than a border, because a border on this exact widget already
/// means something else — see [PresenceBorder], which wraps this same tile
/// when a teammate has it open.
class ChannelContextMenu extends ConsumerStatefulWidget {
  const ChannelContextMenu({
    super.key,
    required this.influencer,
    required this.child,
  });

  final Influencer influencer;
  final Widget child;

  @override
  ConsumerState<ChannelContextMenu> createState() => _ChannelContextMenuState();
}

class _ChannelContextMenuState extends ConsumerState<ChannelContextMenu> {
  bool _hovering = false;

  /// Records the pointer entering or leaving this tile, but only asks for a
  /// rebuild when it could change what is painted — i.e. while a Ctrl/Alt
  /// modifier is held, which is the only time [_hovering] feeds the halo.
  ///
  /// Scrolling the list with the wheel keeps the pointer still while row after
  /// row slides under it, so the framework fires enter/exit down the whole
  /// visible list, one frame at a time. A `setState` in those callbacks meant
  /// every transiting row rebuilt its subtree on every scroll frame for no
  /// visible effect — the stutter this page had. When a modifier is later
  /// pressed, `build` re-runs anyway (it watches [_quickTagModifierProvider])
  /// and reads the current [_hovering], so the halo still appears under the
  /// pointer.
  void _setHovering(bool value) {
    if (_hovering == value) return;
    _hovering = value;
    if (mounted &&
        ref.read(_quickTagModifierProvider) != _QuickTagModifier.none) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final modifier = ref.watch(_quickTagModifierProvider);
    final highlight = _hovering && modifier != _QuickTagModifier.none;

    return MouseRegion(
      onEnter: (_) => _setHovering(true),
      onExit: (_) => _setHovering(false),
      child: GestureDetector(
        behavior: HitTestBehavior.deferToChild,
        // Ctrl + right-click adds the brush preset's tags, Alt + right-click
        // removes them, both straight away instead of opening the menu — the
        // whole point is not stopping at every channel while tagging a batch
        // of them.
        onSecondaryTapDown: (details) {
          final keyboard = HardwareKeyboard.instance;
          if (keyboard.isControlPressed) {
            _applyQuickPreset(context, ref, add: true);
          } else if (keyboard.isAltPressed) {
            _applyQuickPreset(context, ref, add: false);
          } else {
            _open(context, ref, details.globalPosition);
          }
        },
        onLongPressStart: (details) =>
            _open(context, ref, details.globalPosition),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            if (highlight)
              Positioned.fill(
                left: -4,
                top: -4,
                right: -4,
                bottom: -4,
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: (modifier == _QuickTagModifier.remove
                              ? Theme.of(context).colorScheme.error
                              : Theme.of(context).colorScheme.primary)
                          .withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(16),
                    ),
                  ),
                ),
              ),
            widget.child,
          ],
        ),
      ),
    );
  }

  /// Adds ([add] true) or removes ([add] false) the brush preset's tags,
  /// merging against whatever tags the channel already carries rather than
  /// replacing its tag list outright — otherwise Ctrl + right-click on an
  /// already-tagged channel would silently wipe tags the preset doesn't
  /// mention.
  Future<void> _applyQuickPreset(
    BuildContext context,
    WidgetRef ref, {
    required bool add,
  }) async {
    final preset = ref.read(influencerQuickTagPresetProvider);
    if (preset.isEmpty) {
      final l10n = AppLocalizations.of(context);
      AppToast.warning(context, l10n.influencerQuickTagPresetEmpty);
      return;
    }

    final current = widget.influencer.channelTags;
    final currentSet = current.toSet();
    final presetSet = preset.toSet();
    final nextSet =
        add ? currentSet.union(presetSet) : currentSet.difference(presetSet);
    if (setEquals(currentSet, nextSet)) return;

    final next = add
        ? [
            ...current,
            for (final t in preset)
              if (!currentSet.contains(t)) t
          ]
        : [
            for (final t in current)
              if (!presetSet.contains(t)) t
          ];

    final repository = ref.read(influencerRepositoryProvider);
    await guardInfluencerMutation(
      context,
      ref,
      widget.influencer,
      action: () => repository.updateChannelTags(
        widget.influencer.id,
        next,
        base: current,
      ),
      log: (logger) => logger.channelTagsChanged(
        widget.influencer,
        before: current,
        after: next,
      ),
      patchList: (row) => row.copyWith(channelTags: next),
    );
  }

  RelativeRect _positionAt(BuildContext context, Offset position) {
    final overlay =
        Overlay.of(context).context.findRenderObject()! as RenderBox;
    return RelativeRect.fromRect(
      // A zero-size rect at the pointer: showMenu positions the menu against
      // this rect's edges, so a point is exactly what "open here" means.
      Rect.fromLTWH(position.dx, position.dy, 0, 0),
      Offset.zero & overlay.size,
    );
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    Offset position,
  ) async {
    final l10n = AppLocalizations.of(context);

    final selected = await showMenu<_ChannelAction>(
      context: context,
      position: _positionAt(context, position),
      items: [
        PopupMenuItem(
          value: _ChannelAction.status,
          child: Row(
            children: [
              const Icon(Icons.trending_up, size: 18),
              const SizedBox(width: 12),
              Flexible(child: Text(l10n.influencerContextMenuStatus)),
            ],
          ),
        ),
        PopupMenuItem(
          value: _ChannelAction.channelTag,
          child: Row(
            children: [
              const Icon(Icons.sell_outlined, size: 18),
              const SizedBox(width: 12),
              Flexible(child: Text(l10n.influencerContextMenuChannelTag)),
            ],
          ),
        ),
        PopupMenuItem(
          value: _ChannelAction.shortlist,
          child: Row(
            children: [
              Icon(
                widget.influencer.vettingStatus == VettingStatus.shortlisted
                    ? Icons.playlist_remove
                    : Icons.playlist_add_check,
                size: 18,
              ),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                    widget.influencer.vettingStatus == VettingStatus.shortlisted
                        ? l10n.influencerContextMenuUnshortlist
                        : l10n.influencerContextMenuShortlist),
              ),
            ],
          ),
        ),
        PopupMenuItem(
          value: _ChannelAction.addToCampaign,
          child: Row(
            children: [
              const Icon(Icons.campaign_outlined, size: 18),
              const SizedBox(width: 12),
              Flexible(child: Text(l10n.influencerContextMenuAddToCampaign)),
            ],
          ),
        ),
        PopupMenuItem(
          value: _ChannelAction.open,
          child: Row(
            children: [
              const Icon(Icons.open_in_new, size: 18),
              const SizedBox(width: 12),
              Flexible(child: Text(l10n.influencerListOpenChannel)),
            ],
          ),
        ),
      ],
    );

    if (selected == null || !context.mounted) return;
    switch (selected) {
      case _ChannelAction.status:
        await _openStageMenu(context, ref, position);
      case _ChannelAction.channelTag:
        await _openTagMenu(context, ref, position);
      case _ChannelAction.shortlist:
        await _toggleShortlist(context, ref);
      case _ChannelAction.addToCampaign:
        await _addToCampaign(context, ref, position);
      case _ChannelAction.open:
        context.go(AppRoutes.influencerDetail(widget.influencer.id));
    }
  }

  /// HC-08: a creator flagged female or couple is out of scope — never
  /// shortlisted, never put in front of a brand. Says so and answers true.
  bool _refuseOutOfScope(BuildContext context, AppLocalizations l10n) {
    if (!(widget.influencer.creatorGender?.outOfScope ?? false)) return false;
    AppToast.warning(context, l10n.creatorFlagOutOfScope);
    return true;
  }

  Future<void> _toggleShortlist(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final before = widget.influencer.vettingStatus;
    final after = before == VettingStatus.shortlisted
        ? VettingStatus.newlyFound
        : VettingStatus.shortlisted;
    if (after == VettingStatus.shortlisted &&
        _refuseOutOfScope(context, l10n)) {
      return;
    }
    await guardInfluencerMutation(
      context,
      ref,
      widget.influencer,
      action: () => ref.read(influencerRepositoryProvider).updateVettingStatus(
            widget.influencer.id,
            after,
            base: before,
          ),
      log: (logger) => logger.channelVettingChanged(
        widget.influencer,
        before: before,
        after: after,
      ),
      patchList: (row) => row.copyWith(vettingStatus: after),
    );
  }

  /// Puts the channel on an active campaign's shortlist — where a brand pitch
  /// is put together. A creator who is not ready to pitch yet (BRD-PRES-15) is
  /// still added, with a reminder of what is missing before the proposal goes.
  Future<void> _addToCampaign(
    BuildContext context,
    WidgetRef ref,
    Offset position,
  ) async {
    final l10n = AppLocalizations.of(context);
    if (_refuseOutOfScope(context, l10n)) return;
    final campaigns = [
      for (final campaign
          in await ref.read(campaignRepositoryProvider).getAll())
        if (campaign.status == CampaignStatus.active) campaign,
    ];
    if (!context.mounted) return;
    if (campaigns.isEmpty) {
      AppToast.info(context, l10n.influencerContextMenuNoCampaigns);
      return;
    }
    final picked = await showMenu<Campaign>(
      context: context,
      position: _positionAt(context, position),
      items: [
        for (final campaign in campaigns)
          PopupMenuItem(value: campaign, child: Text(campaign.name)),
      ],
    );
    if (picked == null || !context.mounted) return;
    try {
      await ref.read(campaignShortlistRepositoryProvider).add(
            CampaignShortlistEntry(
              id: '',
              campaignId: picked.id,
              channelId: widget.influencer.id,
              addedAt: DateTime.now().toUtc(),
            ),
          );
      if (!context.mounted) return;
      final readiness = PitchReadiness.of(widget.influencer);
      if (readiness.ready) {
        AppToast.success(
            context, l10n.influencerContextMenuAddedToCampaign(picked.name));
      } else {
        AppToast.warning(
            context, l10n.influencerContextMenuAddedNotReady(picked.name));
      }
    } on Exception catch (error) {
      if (context.mounted) AppToast.error(context, '$error');
    }
  }

  Future<void> _openStageMenu(
    BuildContext context,
    WidgetRef ref,
    Offset position,
  ) async {
    final l10n = AppLocalizations.of(context);
    final current = widget.influencer.pipelineStage;

    final stage = await showMenu<PipelineStage>(
      context: context,
      position: _positionAt(context, position),
      items: [
        for (final stage in PipelineStage.values)
          PopupMenuItem(
            value: stage,
            child: Row(
              children: [
                Icon(
                  stage == current
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  size: 18,
                  color: stage == current ? stage.color(context) : null,
                ),
                const SizedBox(width: 12),
                Text(stage.label(l10n)),
              ],
            ),
          ),
      ],
    );

    if (stage == null || stage == current || !context.mounted) return;
    final repository = ref.read(influencerRepositoryProvider);
    await guardInfluencerMutation(
      context,
      ref,
      widget.influencer,
      action: () => repository.updatePipelineStage(
        widget.influencer.id,
        stage,
        base: current,
      ),
      log: (logger) => logger.channelStageChanged(
        widget.influencer,
        before: current,
        after: stage,
      ),
      patchList: (row) => row.copyWith(pipelineStage: stage),
    );
  }

  /// Opens the channel-tag checklist, and — because [PopupMenuItem] always
  /// closes its parent menu on tap and Flutter has no supported "stays open"
  /// popup-menu mode — reopens itself after every toggle so multiple tags can
  /// be picked in one visit, at the cost of a brief close/reopen flicker per
  /// tap. [pending] carries the accumulated selection across those reopens,
  /// since this widget is not rebuilt with the freshly saved value in between.
  Future<void> _openTagMenu(
    BuildContext context,
    WidgetRef ref,
    Offset position, {
    List<ChannelTag>? pending,
  }) async {
    final l10n = AppLocalizations.of(context);
    final current = pending ?? widget.influencer.channelTags;

    final tapped = await showMenu<ChannelTag>(
      context: context,
      position: _positionAt(context, position),
      items: [
        for (final tag in ChannelTag.values)
          PopupMenuItem(
            value: tag,
            child: Row(
              children: [
                IgnorePointer(
                  child: Checkbox(
                    value: current.contains(tag),
                    onChanged: (_) {},
                  ),
                ),
                const SizedBox(width: 4),
                Text(tag.label(l10n)),
              ],
            ),
          ),
      ],
    );

    if (tapped == null || !context.mounted) return;

    final next = current.contains(tapped)
        ? [
            for (final t in current)
              if (t != tapped) t
          ]
        : [...current, tapped];

    final repository = ref.read(influencerRepositoryProvider);
    await guardInfluencerMutation(
      context,
      ref,
      widget.influencer,
      action: () => repository.updateChannelTags(
        widget.influencer.id,
        next,
        base: widget.influencer.channelTags,
      ),
      log: (logger) => logger.channelTagsChanged(
        widget.influencer,
        before: widget.influencer.channelTags,
        after: next,
      ),
      patchList: (row) => row.copyWith(channelTags: next),
    );

    if (!context.mounted) return;
    await _openTagMenu(context, ref, position, pending: next);
  }
}

enum _ChannelAction { status, channelTag, shortlist, addToCampaign, open }

/// Which quick-tag modifier is currently held — Ctrl (add), Alt (remove), or
/// neither — tracked globally rather than per-tile.
enum _QuickTagModifier { none, add, remove }

/// [HardwareKeyboard]'s global handler fires regardless of which widget has
/// focus — the alternative, a `Focus`/keyboard listener on each tile, would
/// need every one of the fifty-odd tiles on screen to hold its own key
/// listener just to answer the same question. One handler here, watched by
/// every [ChannelContextMenu], keeps that cost to one listener for the whole
/// list.
final _quickTagModifierProvider =
    NotifierProvider<_QuickTagModifierNotifier, _QuickTagModifier>(
  _QuickTagModifierNotifier.new,
);

class _QuickTagModifierNotifier extends Notifier<_QuickTagModifier> {
  @override
  _QuickTagModifier build() {
    HardwareKeyboard.instance.addHandler(_onKeyEvent);
    ref.onDispose(() => HardwareKeyboard.instance.removeHandler(_onKeyEvent));
    return _current();
  }

  _QuickTagModifier _current() {
    final keyboard = HardwareKeyboard.instance;
    if (keyboard.isControlPressed) return _QuickTagModifier.add;
    if (keyboard.isAltPressed) return _QuickTagModifier.remove;
    return _QuickTagModifier.none;
  }

  bool _onKeyEvent(KeyEvent event) {
    final next = _current();
    if (next != state) state = next;
    // Never claims the event — this is an observer, not a shortcut handler.
    return false;
  }
}
