import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/comms_queue_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Outreach -> Comms queue (plan step 6): everything waiting on us in four
/// sections — new replies, follow-ups due, decisions, new outreach. The
/// engine drafts an item when a person presses Draft; a draft shows why it is
/// the next step and the lessons it used, and goes only when a person presses
/// Send (edited text checked again, gates confirmed first).
class CommsQueuePage extends ConsumerStatefulWidget {
  const CommsQueuePage({super.key});

  @override
  ConsumerState<CommsQueuePage> createState() => _CommsQueuePageState();
}

String _key(CommsRequest r) =>
    '${r.kind.name}:${r.threadId ?? r.channelId ?? r.brandId}';

class _CommsQueuePageState extends ConsumerState<CommsQueuePage> {
  final Set<String> _drafting = {};

  Future<void> _draft(CommsRequest request) async {
    final l10n = AppLocalizations.of(context);
    final key = _key(request);
    setState(() => _drafting.add(key));
    try {
      await ref.read(commsQueueProvider.notifier).draft(request);
    } on Object catch (error) {
      if (mounted) AppToast.error(context, l10n.commsDraftFailed('$error'));
    } finally {
      if (mounted) setState(() => _drafting.remove(key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final queue = ref.watch(commsQueueProvider);
    final status = ref.watch(gmailStatusProvider).value;
    final limits = [
      for (final a in status?.accounts ?? const [])
        if (a.connected && a.limits != null) a.limits!,
    ];

    // The last view stays on screen while it is read again (after a send, a
    // draft, a sync), rather than flashing to a spinner.
    return queue.when(
      skipLoadingOnReload: true,
      skipLoadingOnRefresh: true,
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(child: Text(l10n.commonError)),
      // A readable measure on a wide window: drafts are prose, and a line
      // the whole width of a desktop screen is hard to read.
      data: (view) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 960),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  _Count(
                    icon: Icons.outgoing_mail,
                    text: l10n.commsToday(view.sentToday, view.dailyTarget),
                  ),
                  if (limits.isNotEmpty)
                    _Count(
                      icon: Icons.mark_email_read_outlined,
                      text: l10n.commsMailboxLeft(limits.first.leftToday),
                    ),
                  IconButton(
                    tooltip: l10n.commonRefresh,
                    icon: const Icon(Icons.refresh),
                    onPressed: () => ref.invalidate(commsQueueProvider),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _Section(
                title: l10n.commsSectionReplies,
                icon: Icons.reply,
                proposals: view.proposalsFor(CommsKind.reply),
                candidates: view.replies,
                drafting: _drafting,
                onDraft: _draft,
              ),
              _Section(
                title: l10n.commsSectionFollowUps,
                icon: Icons.alarm,
                proposals: view.proposalsFor(CommsKind.followUp),
                candidates: view.followUps,
                drafting: _drafting,
                onDraft: _draft,
              ),
              _Section(
                title: l10n.commsSectionDecisions,
                icon: Icons.rule_folder_outlined,
                proposals: view.decisions,
                candidates: const [],
                drafting: _drafting,
                onDraft: _draft,
              ),
              _Section(
                title: l10n.commsSectionNewOutreach,
                icon: Icons.person_add_alt,
                proposals: view.proposalsFor(CommsKind.first),
                candidates: view.newOutreach,
                drafting: _drafting,
                onDraft: _draft,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(child: Icon(icon, size: 16)),
          const SizedBox(width: 6),
          Flexible(child: Text(text, style: theme.textTheme.labelLarge)),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.icon,
    required this.proposals,
    required this.candidates,
    required this.drafting,
    required this.onDraft,
  });

  final String title;
  final IconData icon;
  final List<CommsProposal> proposals;
  final List<CommsCandidate> candidates;
  final Set<String> drafting;
  final ValueChanged<CommsRequest> onDraft;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final empty = proposals.isEmpty && candidates.isEmpty;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          spacing: 8,
          children: [
            Row(
              children: [
                ExcludeSemantics(child: Icon(icon)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(title, style: theme.textTheme.titleMedium),
                ),
                if (!empty)
                  Text('${proposals.length + candidates.length}',
                      style: theme.textTheme.labelLarge),
              ],
            ),
            if (empty)
              Text(l10n.commsSectionEmpty,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
            for (final proposal in proposals)
              _ProposalCard(key: ValueKey(proposal.id), proposal: proposal),
            for (final candidate in candidates)
              _CandidateTile(
                candidate: candidate,
                drafting: drafting.contains(_key(candidate.request)),
                onDraft: () => onDraft(candidate.request),
              ),
          ],
        ),
      ),
    );
  }
}

class _CandidateTile extends StatelessWidget {
  const _CandidateTile({
    required this.candidate,
    required this.drafting,
    required this.onDraft,
  });

  final CommsCandidate candidate;
  final bool drafting;
  final VoidCallback onDraft;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final number = candidate.request.followUpNumber;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(candidate.title, style: theme.textTheme.titleSmall),
                  if (number != null) Text(l10n.commsFollowUpNumber(number)),
                  if (candidate.detail.isNotEmpty)
                    Text(candidate.detail,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 8),
            if (!drafting)
              FilledButton.tonal(
                key: const ValueKey('comms-draft'),
                onPressed: onDraft,
                child: Text(l10n.commsDraft),
              ),
          ],
        ),
        if (drafting)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(
              children: [
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(l10n.commsDrafting,
                      style: theme.textTheme.bodySmall),
                ),
              ],
            ),
          ),
        const Divider(height: 16),
      ],
    );
  }
}

class _ProposalCard extends ConsumerStatefulWidget {
  const _ProposalCard({super.key, required this.proposal});

  final CommsProposal proposal;

  @override
  ConsumerState<_ProposalCard> createState() => _ProposalCardState();
}

class _ProposalCardState extends ConsumerState<_ProposalCard> {
  late final _subject = TextEditingController(text: widget.proposal.subject);
  late final _body = TextEditingController(text: widget.proposal.body);
  bool _editing = false;
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send({bool confirmed = false}) async {
    // A second tap while the first send is in flight does nothing.
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    setState(() => _busy = true);
    final CommsSendResult result;
    try {
      result = await ref.read(commsQueueProvider.notifier).send(
            widget.proposal,
            subject: _subject.text,
            body: _body.text,
            gatesConfirmed: confirmed,
          );
    } on Object catch (error) {
      if (mounted) AppToast.error(context, l10n.commsSendError('$error'));
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    switch (result) {
      case CommsSent():
        AppToast.success(context, l10n.commsSent);
      case CommsSentNotRecorded(:final error):
        AppToast.warning(context, l10n.commsSentNotRecorded(error));
      case CommsNeedsConfirmation(:final gates):
        final yes = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(l10n.commsGatesTitle),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: 6,
              children: [
                Text(l10n.commsGatesBody),
                for (final gate in gates)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const ExcludeSemantics(
                          child: Icon(Icons.flag_outlined, size: 18)),
                      const SizedBox(width: 6),
                      Expanded(child: Text('${gate.what}: ${gate.detail}')),
                    ],
                  ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: Text(l10n.commonCancel),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(l10n.commsConfirmSend),
              ),
            ],
          ),
        );
        if ((yes ?? false) && mounted) await _send(confirmed: true);
      case CommsBlocked(:final findings):
        AppToast.error(
          context,
          [
            l10n.commsCheckFailed,
            for (final f in findings) '${f.rule}: ${f.detail}',
          ].join('\n'),
        );
      case CommsNoRecipient():
        AppToast.warning(context, l10n.commsNoRecipient);
      case CommsSendFailed(:final message):
        AppToast.error(context, message);
    }
  }

  Future<void> _redo() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    final steer = await showDialog<_Steer>(
      context: context,
      builder: (context) => _SteerDialog(proposal: widget.proposal),
    );
    if (steer == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(commsQueueProvider.notifier).redo(
            widget.proposal,
            steer: steer.knobs,
            note: steer.note,
            cashOffer: steer.cashOffer,
          );
    } on Object catch (error) {
      if (mounted) AppToast.error(context, l10n.commsDraftFailed('$error'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _skip() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    await ref.read(commsQueueProvider.notifier).skip(widget.proposal);
    if (mounted) AppToast.info(context, l10n.commsSkipped);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final p = widget.proposal;
    final blocked = p.status == CommsQueueStatus.blocked;
    final channel = p.channelId == null
        ? null
        : ref.watch(influencerByIdProvider(p.channelId!)).value;
    final brand = p.brandId == null
        ? null
        : ref.watch(brandByIdProvider(p.brandId!)).value;
    final who =
        channel?.handle ?? brand?.name ?? p.channelId ?? p.brandId ?? '';
    final recipient = p.hasMessage
        ? ref.watch(commsRecipientProvider((
            threadId: p.threadId,
            channelId: p.channelId,
            brandId: p.brandId,
          )))
        : null;
    final kind = switch (p.kind) {
      CommsKind.first => l10n.commsKindFirst,
      CommsKind.reply => l10n.commsKindReply,
      CommsKind.followUp => l10n.commsKindFollowUp,
      CommsKind.decision => l10n.commsKindDecision,
    };

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: 8,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(who, style: theme.textTheme.titleSmall),
              Chip(label: Text(kind), visualDensity: VisualDensity.compact),
              if (blocked)
                Chip(
                  avatar: const Icon(Icons.block, size: 16),
                  label: Text(l10n.commsBlocked),
                  visualDensity: VisualDensity.compact,
                )
              else if (p.engineStatus == CommsEngineStatus.needsHuman)
                Chip(
                  avatar: const Icon(Icons.front_hand_outlined, size: 16),
                  label: Text(l10n.commsNeedsYou),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
          if (p.why != null)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const ExcludeSemantics(
                    child: Icon(Icons.lightbulb_outline, size: 18)),
                const SizedBox(width: 6),
                Expanded(child: Text(p.why!)),
              ],
            ),
          if (p.rules.isNotEmpty)
            Wrap(
              spacing: 6,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(l10n.commsLessons, style: theme.textTheme.labelMedium),
                for (final rule in p.rules)
                  Chip(label: Text(rule), visualDensity: VisualDensity.compact),
              ],
            ),
          if (p.error != null)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(
                  child: Icon(Icons.block,
                      size: 18, color: theme.colorScheme.error),
                ),
                const SizedBox(width: 6),
                Expanded(child: Text(p.error!)),
              ],
            ),
          for (final gate in p.needsHuman)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const ExcludeSemantics(
                    child: Icon(Icons.flag_outlined, size: 18)),
                const SizedBox(width: 6),
                Expanded(child: Text('${gate.what}: ${gate.detail}')),
              ],
            ),
          if (!p.hasMessage && !blocked)
            Text(l10n.commsNothingToSend, style: theme.textTheme.bodySmall),
          if (recipient?.value case final to?) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const ExcludeSemantics(
                    child: Icon(Icons.alternate_email, size: 18)),
                const SizedBox(width: 6),
                Expanded(child: Text(l10n.commsTo(to.address))),
              ],
            ),
            if (to.unconfirmed)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ExcludeSemantics(
                    child: Icon(Icons.warning_amber_outlined,
                        size: 18, color: theme.colorScheme.tertiary),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(l10n.commsRecipientUnconfirmed,
                        style: theme.textTheme.bodySmall),
                  ),
                ],
              ),
          ] else if (recipient != null && recipient.hasValue)
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ExcludeSemantics(
                  child: Icon(Icons.error_outline,
                      size: 18, color: theme.colorScheme.error),
                ),
                const SizedBox(width: 6),
                Expanded(child: Text(l10n.commsNoRecipient)),
              ],
            ),
          if (p.hasMessage && !_editing) ...[
            if (_subject.text.isNotEmpty)
              Text(_subject.text, style: theme.textTheme.titleSmall),
            SelectableText(_body.text),
          ],
          if (_editing) ...[
            TextField(
              controller: _subject,
              decoration: InputDecoration(
                labelText: l10n.commsSubject,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            TextField(
              controller: _body,
              minLines: 4,
              maxLines: 16,
              decoration: InputDecoration(
                labelText: l10n.commsBody,
                border: const OutlineInputBorder(),
              ),
            ),
          ],
          if (_busy) const LinearProgressIndicator(),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (p.hasMessage && !blocked)
                FilledButton.icon(
                  onPressed: _busy ? null : _send,
                  icon: const Icon(Icons.send),
                  label: Text(l10n.commsSend),
                ),
              if (p.hasMessage && !blocked)
                OutlinedButton(
                  onPressed:
                      _busy ? null : () => setState(() => _editing = !_editing),
                  child:
                      Text(_editing ? l10n.commsDoneEditing : l10n.commsEdit),
                ),
              TextButton(
                onPressed: _busy ? null : _redo,
                child: Text(l10n.commsRedo),
              ),
              TextButton(
                onPressed: _busy ? null : _skip,
                child: Text(l10n.commsSkip),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The Steer panel's answer.
class _Steer {
  const _Steer(this.knobs, this.note, this.cashOffer);

  final Map<String, String> knobs;
  final String? note;
  final bool cashOffer;
}

/// The old knob panel, now optional corrections (decision old-files): each
/// starts at "as read" — what the engine read from the case — or at what the
/// person set last time. The case builder reads the same ids
/// (pipeline/comms/live_case.py STEER).
const Map<String, List<String>> _knobs = {
  'reader': ['creator', 'manager', 'brand'],
  'stage': ['first', 'fu1', 'fu2', 'closing', 'reply', 'reengage'],
  'channel': ['email', 'dm', 'linkedin'],
  'have': ['nothing', 'roster', 'brand', 'deal'],
  'inmind': ['none', 'yes'],
  'state': ['unknown', 'unsponsored', 'some', 'full', 'own'],
  'pitch': ['one', 'several'],
  'proof': ['none', 'some'],
  'btype': ['active', 'never', 'b2b', 'apps', 'ecom', 'affiliate'],
  'bsize': ['small', 'big'],
  'creply': [
    'interested',
    'which',
    'kit',
    'who',
    'budget',
    'affiliate',
    'gifting',
    'manager',
    'notint',
    'silent',
  ],
  'breply': [
    'creators',
    'budget',
    'cases',
    'notnow',
    'ignored',
    'kit',
    'affiliate',
  ],
  'english': ['native', 'nonnative'],
};

const _creatorKnobs = [
  'reader',
  'stage',
  'channel',
  'have',
  'inmind',
  'state',
  'creply',
  'english',
];
const _brandKnobs = [
  'stage',
  'channel',
  'pitch',
  'proof',
  'btype',
  'bsize',
  'breply',
  'english',
];

String _knobLabel(AppLocalizations l10n, String knob) => switch (knob) {
      'reader' => l10n.steerReader,
      'stage' => l10n.steerStage,
      'channel' => l10n.steerChannel,
      'have' => l10n.steerHave,
      'inmind' => l10n.steerInmind,
      'state' => l10n.steerState,
      'pitch' => l10n.steerPitch,
      'proof' => l10n.steerProof,
      'btype' => l10n.steerBtype,
      'bsize' => l10n.steerBsize,
      'creply' => l10n.steerCreply,
      'breply' => l10n.steerBreply,
      _ => l10n.steerEnglish,
    };

String _optionLabel(AppLocalizations l10n, String knob, String option) =>
    switch (knob) {
      'reader' => l10n.steerReaderOption(option),
      'stage' => l10n.steerStageOption(option),
      'channel' => l10n.steerChannelOption(option),
      'have' => l10n.steerHaveOption(option),
      'inmind' => l10n.steerInmindOption(option),
      'state' => l10n.steerStateOption(option),
      'pitch' => l10n.steerPitchOption(option),
      'proof' => l10n.steerProofOption(option),
      'btype' => l10n.steerBtypeOption(option),
      'bsize' => l10n.steerBsizeOption(option),
      'creply' => l10n.steerCreplyOption(option),
      'breply' => l10n.steerBreplyOption(option),
      _ => l10n.steerEnglishOption(option),
    };

class _SteerDialog extends StatefulWidget {
  const _SteerDialog({required this.proposal});

  final CommsProposal proposal;

  @override
  State<_SteerDialog> createState() => _SteerDialogState();
}

class _SteerDialogState extends State<_SteerDialog> {
  late final Map<String, String?> _values = {
    for (final knob in _knobs.keys)
      knob: switch (widget.proposal.steer[knob]) {
        final String value when _knobs[knob]!.contains(value) => value,
        _ => null,
      },
  };
  late final _note = TextEditingController(
      text: widget.proposal.steer['note'] is String
          ? widget.proposal.steer['note']! as String
          : '');
  late bool _cash = (widget.proposal.steer['cashOffer'] as bool?) ?? false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final knobs = widget.proposal.brandId != null ? _brandKnobs : _creatorKnobs;
    return AlertDialog(
      title: Text(l10n.commsSteerTitle),
      content: SizedBox(
        width: 520,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: 12,
            children: [
              Text(l10n.commsSteerHelp, style: theme.textTheme.bodySmall),
              for (final knob in knobs)
                DropdownButtonFormField<String?>(
                  key: ValueKey('steer-$knob'),
                  initialValue: _values[knob],
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: _knobLabel(l10n, knob),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    DropdownMenuItem<String?>(
                        value: null, child: Text(l10n.commsSteerAsRead)),
                    for (final option in _knobs[knob]!)
                      DropdownMenuItem<String?>(
                        value: option,
                        child: Text(_optionLabel(l10n, knob, option)),
                      ),
                  ],
                  onChanged: (value) => setState(() => _values[knob] = value),
                ),
              TextField(
                key: const ValueKey('steer-note'),
                controller: _note,
                minLines: 2,
                maxLines: 5,
                decoration: InputDecoration(
                  labelText: l10n.commsSteerNote,
                  border: const OutlineInputBorder(),
                ),
              ),
              // HC-10: a subtle switch, out of the way unless opened.
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: Text(l10n.commsSteerMore),
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _cash,
                    onChanged: (value) => setState(() => _cash = value),
                    title: Text(l10n.commsSteerCash),
                    subtitle: Text(l10n.commsSteerCashHelp),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_Steer(
            {
              for (final MapEntry(:key, :value) in _values.entries)
                if (value != null) key: value,
            },
            _note.text.trim().isEmpty ? null : _note.text.trim(),
            _cash,
          )),
          child: Text(l10n.commsRedo),
        ),
      ],
    );
  }
}
