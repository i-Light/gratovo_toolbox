import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider_registry.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/native/url_launcher_provider.dart';
import 'package:gratovo_toolbox/core/status/contact_method_presentation.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/ai_brief_builder.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_compose_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/add_contact_inline_row.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/ai_brief_dialog.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/scheduled_sends.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/send_later_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The compose area for one thread, shaped by the chosen contact method.
///
/// Email gets the full treatment — To, Subject, Body, template, AI draft, and
/// two ways out. Every other method drops the subject line, calls the field
/// "message", and offers copy buttons instead of a deep link, because there is
/// no reliable compose URL for a DM.
///
/// THE TWO WAYS AN EMAIL LEAVES, AND WHY BOTH STAY
/// ------------------------------------------------
/// **Send with Gmail** is the real one, and the only one that makes the rest
/// of the feature work: it sends through the team's mailbox, so the message
/// threads, the next follow-up's reminder is set, and a reply is noticed
/// automatically (`outreach_inbox_controller.dart`). It is offered only when
/// this machine actually has a mailbox connected.
///
/// **Open mail app** is the `mailto:` hand-off, kept for every case the first
/// one cannot cover: the web build, a machine with no pipeline, a mailbox that
/// has not been connected yet, and the person who wants to send this one from
/// their own address. It ends at **Mark as sent**, which records that a human
/// says they sent something — a weaker claim, honestly made.

/// Whitespace-separated run count for a draft — what the composer's word
/// counter reports.
int draftWordCount(String text) {
  final trimmed = text.trim();
  if (trimmed.isEmpty) return 0;
  return trimmed.split(RegExp(r'\s+')).length;
}

class MethodAwareComposer extends ConsumerStatefulWidget {
  const MethodAwareComposer({
    super.key,
    required this.threadId,
    required this.thread,
    required this.influencer,
  });

  final String threadId;
  final OutreachThread thread;
  final Influencer influencer;

  @override
  ConsumerState<MethodAwareComposer> createState() =>
      _MethodAwareComposerState();
}

class _MethodAwareComposerState extends ConsumerState<MethodAwareComposer> {
  final _subjectController = TextEditingController();
  final _bodyController = TextEditingController();

  ComposeController get _controller =>
      ref.read(composeControllerProvider(widget.threadId).notifier);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _controller.initFor(widget.influencer);
    });
  }

  @override
  void dispose() {
    _subjectController.dispose();
    _bodyController.dispose();
    super.dispose();
  }

  /// Overwrites a text controller only when the value diverged elsewhere (an
  /// AI draft landing, or `clearDraft` after a send) — normal typing already
  /// keeps the two in step through `onChanged`, so this never fights a cursor.
  void _sync(TextEditingController controller, String value) {
    if (controller.text == value) return;
    controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  Future<void> _generate() async {
    final l10n = AppLocalizations.of(context);
    final influencer = widget.influencer;
    final videos =
        await ref.read(videosByInfluencerProvider(influencer.id).future);
    final templates = await ref.read(allTemplatesProvider.future);
    final writingRules = await ref.read(writingRulesProvider.future);
    final provider = ref.read(selectedAiProviderProvider);

    final error = await _controller.generateDraft(
      influencer: influencer,
      videos: videos,
      writingRules: writingRules,
      templates: templates,
      provider: provider,
    );
    if (error != null && mounted) {
      AppToast.error(context, l10n.outreachDraftGenerationFailed(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(composeControllerProvider(widget.threadId));
    _sync(_subjectController, state.subject);
    _sync(_bodyController, state.body);

    final isEmail = state.method == ContactMethod.email;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // The header names where this is going instead of announcing
            // that it is a composer — the card's shape already says the
            // latter. "Sending via Email" and the address are the one fact
            // worth a title line here, and it arrives free: it took the place
            // of a static heading and gave the picker's own row back.
            Row(
              children: [
                Expanded(
                  child: state.needsContact
                      ? Text(
                          l10n.outreachComposeTitle,
                          style: theme.textTheme.titleMedium,
                        )
                      : _ContactPicker(
                          threadId: widget.threadId,
                          influencer: widget.influencer,
                          state: state,
                        ),
                ),
                if (!state.needsContact) ...[
                  const SizedBox(width: 8),
                  Text(
                    l10n.outreachComposeWordCount(draftWordCount(state.body)),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            if (state.needsContact)
              _NeedsContact(
                influencer: widget.influencer,
                threadId: widget.threadId,
              )
            else ...[
              _TemplateAndAiControls(
                threadId: widget.threadId,
                isGenerating: state.isGenerating,
                onGenerate: state.isGenerating ? null : _generate,
              ),
              const SizedBox(height: 16),
              if (isEmail) ...[
                TextField(
                  controller: _subjectController,
                  decoration:
                      InputDecoration(labelText: l10n.outreachSubjectLabel),
                  onChanged: _controller.setSubject,
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: _bodyController,
                maxLines: 8,
                minLines: 4,
                decoration: InputDecoration(
                  labelText: isEmail
                      ? l10n.outreachBodyLabel
                      : l10n.outreachComposeMessageLabel,
                ),
                onChanged: _controller.setBody,
              ),
              // The ways this message leaves are not in this card: they are
              // docked under the whole panel in [ComposerActionBar], where a
              // long draft cannot scroll them off screen.
            ],
          ],
        ),
      ),
    );
  }
}

/// Zero contacts on the channel — nothing to send to yet.
class _NeedsContact extends StatelessWidget {
  const _NeedsContact({required this.influencer, required this.threadId});

  final Influencer influencer;
  final String threadId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.outreachComposeNoContactYet,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 12),
        AddContactInlineRow(influencer: influencer, threadId: threadId),
      ],
    );
  }
}

/// Where this message is going — and, when the channel has more than one
/// recorded contact, which one.
///
/// It lives in the composer's title line rather than under it. "Draft a
/// message" used to sit there saying nothing the card's shape did not already
/// say, while the address this is about to leave for — the fact somebody
/// actually wants confirmed before pressing send — was a separate row below.
/// Swapping them cost nothing and returned a line to the draft.
class _ContactPicker extends ConsumerWidget {
  const _ContactPicker({
    required this.threadId,
    required this.influencer,
    required this.state,
  });

  final String threadId;
  final Influencer influencer;
  final ComposeState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final style = theme.textTheme.titleSmall;
    final contacts = [...influencer.contacts]
      ..sort((a, b) => a.method.index.compareTo(b.method.index));

    Widget heading(ContactMethod method, String value) => Row(
          children: [
            Icon(contactMethodIcon(method), size: 16),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '${l10n.outreachComposeSendVia(contactMethodLabel(method, l10n))}'
                '  ·  $value',
                style: style,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        );

    if (contacts.isEmpty) return const SizedBox.shrink();
    if (contacts.length == 1) {
      return heading(contacts.first.method, contacts.first.value);
    }

    final selectedIndex = contacts.indexWhere(
      (c) => c.method == state.method && c.value == state.recipientValue,
    );

    // Closed, it reads exactly like the single-contact heading; opened, each
    // row carries the label that tells two addresses on one channel apart.
    return DropdownButtonHideUnderline(
      child: DropdownButton<int>(
        value: selectedIndex >= 0 ? selectedIndex : null,
        isExpanded: true,
        isDense: true,
        borderRadius: BorderRadius.circular(8),
        hint: Text(l10n.outreachComposeMethodLabel, style: style),
        selectedItemBuilder: (context) => [
          for (final contact in contacts)
            heading(contact.method, contact.value),
        ],
        items: [
          for (var i = 0; i < contacts.length; i++)
            DropdownMenuItem(
              value: i,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(contactMethodIcon(contacts[i].method), size: 16),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      [
                        contactMethodLabel(contacts[i].method, l10n),
                        contacts[i].value,
                        if (contacts[i].label != null) contacts[i].label!,
                      ].join('  ·  '),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
        ],
        onChanged: (i) {
          if (i == null) return;
          final contact = contacts[i];
          ref
              .read(composeControllerProvider(threadId).notifier)
              .setMethod(contact.method, recipient: contact.value);
        },
      ),
    );
  }
}

/// What the draft is written *from*: which template seeds it, which model
/// writes it, and the button that asks that model for one.
///
/// This was two full-width dropdowns stacked above a button row — three lines
/// of chrome for two choices that rarely change between drafts. They are
/// icons now, with their names (and the current selection) in tooltips; the
/// width they were spending belongs to the message.
///
/// The brief that goes to a chat window used to sit here too. It moved to the
/// docked bar, beside the other things somebody does with a finished draft.
class _TemplateAndAiControls extends ConsumerWidget {
  const _TemplateAndAiControls({
    required this.threadId,
    required this.isGenerating,
    required this.onGenerate,
  });

  final String threadId;
  final bool isGenerating;
  final VoidCallback? onGenerate;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(composeControllerProvider(threadId));
    final templatesAsync = ref.watch(allTemplatesProvider);

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        templatesAsync.maybeWhen(
          data: (allTemplates) => _TemplateMenu(
            threadId: threadId,
            method: state.method,
            templateId: state.templateId,
            allTemplates: allTemplates,
          ),
          orElse: () => const SizedBox.shrink(),
        ),
        const _AiProviderMenu(),
        // The in-app generate: the only one of the two that works when there
        // is no chat window to paste into.
        IconButton(
          onPressed: onGenerate,
          tooltip: l10n.outreachGenerateDraft,
          icon: isGenerating
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.auto_awesome),
        ),
      ],
    );
  }
}

/// Which template seeds the draft: a tick beside the current one, and a
/// primary-colored icon while any template is applied — the two things the
/// dropdown's label used to say, without the row it used to cost.
class _TemplateMenu extends ConsumerWidget {
  const _TemplateMenu({
    required this.threadId,
    required this.method,
    required this.templateId,
    required this.allTemplates,
  });

  final String threadId;
  final ContactMethod method;
  final String? templateId;
  final List<EmailTemplate> allTemplates;

  /// "No template" rides as the empty string rather than as null:
  /// [PopupMenuButton] reads a null selection as "the menu was dismissed" and
  /// never calls `onSelected`, so a null-valued entry would silently do
  /// nothing. Mapped back to null on the way out.
  static const _noneId = '';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);

    // Email contacts get the email set (with a subject line); every other
    // method gets the DM set.
    final wantedKind =
        method == ContactMethod.email ? TemplateKind.email : TemplateKind.dm;
    final templates = [
      for (final t in allTemplates)
        if (t.kind == wantedKind) t,
    ];
    final validIds = {for (final t in templates) t.id};
    final selectedId = validIds.contains(templateId) ? templateId : null;
    String? selectedName;
    for (final template in templates) {
      if (template.id == selectedId) selectedName = template.name;
    }

    return PopupMenuButton<String>(
      tooltip: selectedName == null
          ? l10n.outreachSelectTemplateLabel
          : '${l10n.outreachSelectTemplateLabel}  ·  $selectedName',
      position: PopupMenuPosition.under,
      icon: Icon(
        Icons.article_outlined,
        color: selectedName == null ? null : theme.colorScheme.primary,
      ),
      onSelected: (id) => ref
          .read(composeControllerProvider(threadId).notifier)
          .setTemplate(id == _noneId ? null : id),
      itemBuilder: (context) => [
        CheckedPopupMenuItem<String>(
          value: _noneId,
          checked: selectedId == null,
          child: Text(l10n.outreachNoTemplateOption),
        ),
        for (final template in templates)
          CheckedPopupMenuItem<String>(
            value: template.id,
            checked: template.id == selectedId,
            child: Text(template.name),
          ),
      ],
    );
  }
}

/// Which model the in-app generate calls. Same treatment as the template
/// picker, and for the same reason: one choice, rarely changed, previously
/// holding a labelled form field open across the composer.
class _AiProviderMenu extends ConsumerWidget {
  const _AiProviderMenu();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final providers = ref.watch(aiProvidersProvider);
    final selectedId = ref.watch(selectedAiProviderIdProvider);

    String? selectedName;
    for (final provider in providers) {
      if (provider.id == selectedId) selectedName = provider.displayName;
    }

    return PopupMenuButton<String>(
      tooltip: selectedName == null
          ? l10n.outreachAiProviderLabel
          : '${l10n.outreachAiProviderLabel}  ·  $selectedName',
      position: PopupMenuPosition.under,
      icon: const Icon(Icons.smart_toy_outlined),
      onSelected: (id) =>
          ref.read(selectedAiProviderIdProvider.notifier).select(id),
      itemBuilder: (context) => [
        for (final provider in providers)
          CheckedPopupMenuItem<String>(
            value: provider.id,
            checked: provider.id == selectedId,
            child: Text(provider.displayName),
          ),
      ],
    );
  }
}

/// The ways a draft leaves, docked under the thread instead of sitting at the
/// bottom of the composer card.
///
/// It used to scroll with the composer, which put the send button off screen
/// exactly when the draft had grown long enough to be worth sending. It is
/// pinned now, and icon-only: five labelled buttons wrapped onto two rows at
/// panel widths, and every label was saying what its icon already said.
///
/// Send leads because it is the one that actually does the thing. The
/// alternatives follow in the order somebody reaches for them, and "mark as
/// sent" — the one that writes a record rather than a message — is last.
///
/// It reads the same [composeControllerProvider] the composer writes to, so
/// living outside that widget costs it nothing; it renders nothing at all
/// while the channel still has no contact to write to.
class ComposerActionBar extends ConsumerStatefulWidget {
  const ComposerActionBar({
    super.key,
    required this.threadId,
    required this.thread,
    required this.influencer,
  });

  final String threadId;
  final OutreachThread thread;
  final Influencer influencer;

  @override
  ConsumerState<ComposerActionBar> createState() => _ComposerActionBarState();
}

class _ComposerActionBarState extends ConsumerState<ComposerActionBar> {
  ComposeController get _controller =>
      ref.read(composeControllerProvider(widget.threadId).notifier);

  /// Copies this channel's research plus the drafting instructions to the
  /// clipboard, then shows the same material laid out to be read.
  ///
  /// This is the in-app replacement for `pipeline/tools/outreach_block.py`,
  /// and it exists because the drafts people actually send come out of a chat
  /// window rather than out of this app's own provider — the slow part was
  /// never the model, it was gathering the channel's facts by hand. See
  /// ai_brief_builder.dart for what goes in the block and, more importantly,
  /// what deliberately does not.
  ///
  /// The dialog is the second half of that job. Whoever pastes this brief is
  /// also the person who has to edit whatever comes back, and they cannot
  /// judge a draft against material they have never seen — a hook that misses
  /// is obvious beside the channel's last upload and invisible in the finished
  /// email.
  Future<void> _copyBrief() async {
    final data = await _buildBriefData();
    // One map, rendered twice: the clipboard payload and the readable view
    // are the same facts by construction, not by two builders agreeing.
    final brief = renderOutreachBrief(data);
    await Clipboard.setData(ClipboardData(text: brief));
    if (!mounted) return;
    await showOutreachBriefDialog(
      context,
      brief: brief,
      sections: outreachBriefSections(data),
    );
  }

  /// This channel's facts plus the selected template and the writing rules,
  /// as one map — built here once so the clipboard brief and its readable
  /// view are answers to the same question.
  Future<Map<String, Object?>> _buildBriefData() async {
    final state = ref.read(composeControllerProvider(widget.threadId));

    final videos =
        await ref.read(videosByInfluencerProvider(widget.influencer.id).future);
    final templates = await ref.read(allTemplatesProvider.future);
    final writingRules = await ref.read(writingRulesProvider.future);

    EmailTemplate? template;
    for (final candidate in templates) {
      if (candidate.id == state.templateId) {
        template = candidate;
        break;
      }
    }

    // The drafter skill refuses without `sender_name` (it signs the email);
    // the connected mailbox's display name is who actually sends it.
    final senderName = ref.read(gmailStatusProvider).value?.senderName;

    return buildOutreachBriefData(
      influencer: widget.influencer,
      videos: videos,
      template: template,
      writingRules: writingRules,
      senderName: senderName,
    );
  }

  Future<void> _openMailApp() async {
    final l10n = AppLocalizations.of(context);
    final mailto = _controller.buildMailto();
    if (mailto == null) return;

    final uri = Uri.parse(mailto);
    final launched = await ref.read(urlLauncherProvider)(uri);
    final body = ref.read(composeControllerProvider(widget.threadId)).body;

    if (!launched) {
      await Clipboard.setData(ClipboardData(text: body));
      if (!mounted) return;
      AppToast.error(context, l10n.outreachMailAppRefused);
      return;
    }
    if (_controller.mailtoOmitsBody) {
      await Clipboard.setData(ClipboardData(text: body));
      if (!mounted) return;
      AppToast.warning(context, l10n.outreachBodyTooLongForMail);
    }
  }

  /// Sends through the team's mailbox, then reports what happened.
  ///
  /// The confirmation names the sending address on purpose. Outreach goes out
  /// from a shared mailbox that is not necessarily the address of the person
  /// pressing the button, and "sent" without saying from where is the kind of
  /// detail people only discover they needed after a reply lands somewhere
  /// they were not looking.
  Future<void> _sendWithGmail() async {
    final l10n = AppLocalizations.of(context);

    final outcome = await _controller.sendViaGmail(
      thread: widget.thread,
      influencer: widget.influencer,
    );

    if (!mounted) return;
    // The mailbox's own counters moved: one more sent, one more awaiting a
    // reply.
    ref.invalidate(gmailStatusProvider);

    final receipt = outcome.receipt;
    if (receipt != null) {
      AppToast.success(
        context,
        receipt.queuedFollowUps.isEmpty
            ? l10n.outreachGmailSentAs(receipt.account)
            : l10n.outreachGmailSentWithFollowUps(
                receipt.account,
                receipt.queuedFollowUps.length,
              ),
      );
      return;
    }

    // Nothing-to-send and wrong-method are validation notices — the
    // composer's own state stopped the send, nothing failed on the wire —
    // so they read as `warning`, not `error`; only a genuine send failure
    // gets `error`.
    if (outcome.isEmptyDraft) {
      AppToast.warning(context, l10n.outreachComposeNothingToSend);
      return;
    }
    if (outcome.isWrongMethod) {
      AppToast.warning(
        context,
        l10n.outreachGmailNotEmail(
          contactMethodLabel(
            ref.read(composeControllerProvider(widget.threadId)).method,
            l10n,
          ),
        ),
      );
      return;
    }
    AppToast.error(
      context,
      l10n.outreachGmailSendFailed(outcome.error?.message ?? l10n.commonError),
    );
  }

  /// Queues the draft to go out through the mailbox at a chosen time.
  ///
  /// Gmail cannot schedule a send, so the app holds it -- see
  /// `scheduled_send_controller.dart` for when it goes out and what happens
  /// when the app is closed at that moment.
  Future<void> _sendLater() async {
    final l10n = AppLocalizations.of(context);
    final when = await showSendLaterDialog(context);
    if (when == null || !mounted) return;
    final fmt = ref.read(instantFormatterProvider);
    final result = await _controller.scheduleSend(
      thread: widget.thread,
      influencer: widget.influencer,
      sendAtUtc: when,
    );
    if (!mounted) return;
    switch (result) {
      case ScheduleSendResult.scheduled:
        AppToast.success(
            context, l10n.outreachSendLaterScheduled(fmt.dateTime(when)));
      case ScheduleSendResult.nothingToSend:
        AppToast.warning(context, l10n.outreachComposeNothingToSend);
      case ScheduleSendResult.notEmail:
        AppToast.warning(
          context,
          l10n.outreachGmailNotEmail(
            contactMethodLabel(
              ref.read(composeControllerProvider(widget.threadId)).method,
              l10n,
            ),
          ),
        );
    }
  }

  /// Takes a scheduled email off the list and back into the composer, to be
  /// changed and then sent or scheduled again. Refused while the composer
  /// holds a draft of its own, which this would overwrite.
  Future<void> _editScheduled(ScheduledEmail email) async {
    final l10n = AppLocalizations.of(context);
    if (!ref.read(composeControllerProvider(widget.threadId)).isEmpty) {
      AppToast.warning(context, l10n.outreachScheduledClearDraftFirst);
      return;
    }
    final taken =
        await ref.read(scheduledSendProvider.notifier).takeBack(email.id);
    if (!mounted) return;
    if (taken == null) {
      AppToast.warning(context, l10n.outreachScheduledBusy);
      return;
    }
    _controller.restoreScheduled(taken);
  }

  Future<void> _markSent() async {
    final l10n = AppLocalizations.of(context);
    final method = ref.read(composeControllerProvider(widget.threadId)).method;
    final sent = await _controller.markSent(
      thread: widget.thread,
      influencer: widget.influencer,
    );
    if (!mounted) return;
    if (sent) {
      AppToast.success(
        context,
        l10n.outreachMessageSentVia(contactMethodLabel(method, l10n)),
      );
    } else {
      // Nothing was actually marked sent — a validation notice, not success.
      AppToast.warning(context, l10n.outreachComposeNothingToSend);
    }
  }

  Future<void> _copy(String text, String toast) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    AppToast.success(context, toast);
  }

  Future<void> _openContactLink() async {
    final state = ref.read(composeControllerProvider(widget.threadId));
    final value = state.recipientValue;
    if (value == null) return;
    final uri = contactUrl(state.method, value, messageText: state.body);
    if (uri == null) return;
    await ref.read(urlLauncherProvider)(uri);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(composeControllerProvider(widget.threadId));
    // Nothing to send to yet — the composer is showing the add-a-contact row,
    // and a bar of dead buttons under it would only be in the way.
    if (state.needsContact) return const SizedBox.shrink();

    final method = state.method;
    final isEmail = method == ContactMethod.email;
    final mailbox = ref.watch(gmailStatusProvider).value;
    final canSendWithGmail = isEmail && (mailbox?.canSend ?? false);
    final hasLink = state.recipientValue != null &&
        contactUrl(method, state.recipientValue!, messageText: state.body) !=
            null;

    return Material(
      color: theme.colorScheme.surface,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Divider(height: 3),
          // What this thread already has waiting to go out, with Send now /
          // Change time / Edit / Don't send -- editable until it is sent.
          ScheduledSendsForThread(
            threadId: widget.threadId,
            onEdit: _editScheduled,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 25, vertical: 10),
            child: Row(
              children: [
                if (canSendWithGmail)
                  _BarAction(
                    icon: Icons.send,
                    tooltip: state.isSending
                        ? l10n.outreachSendingWithGmail
                        : l10n.outreachSendWithGmail,
                    primary: true,
                    busy: state.isSending,
                    onPressed: state.isSending || !state.hasRecipient
                        ? null
                        : _sendWithGmail,
                  ),
                // The same send, at a chosen time. Beside Send because it is
                // the same message going the same way, only later.
                if (canSendWithGmail)
                  _BarAction(
                    key: const Key('composer-send-later'),
                    icon: Icons.schedule_send_outlined,
                    tooltip: l10n.outreachSendLater,
                    onPressed: state.isSending || !state.hasRecipient
                        ? null
                        : _sendLater,
                  ),
                if (isEmail)
                  _BarAction(
                    icon: Icons.mail_outline,
                    tooltip: l10n.outreachOpenMailApp,
                    // With no mailbox connected the hand-off IS the send, so
                    // it takes the primary treatment the real send would have.
                    primary: !canSendWithGmail,
                    onPressed: state.hasRecipient ? _openMailApp : null,
                  )
                else if (hasLink)
                  _BarAction(
                    icon: Icons.open_in_new,
                    tooltip: l10n.outreachOpenContactLink,
                    primary: true,
                    onPressed: _openContactLink,
                  ),
                _BarAction(
                  icon: Icons.copy_all_outlined,
                  tooltip: isEmail
                      ? l10n.outreachCopyBody
                      : l10n.outreachCopyMessage,
                  onPressed: () => _copy(state.body, l10n.commonCopied),
                ),
                // Beside the other clipboard actions rather than up in the
                // drafting strip: it is a copy, and this is where the copies
                // are. It also stays reachable from a scrolled thread, which
                // is where somebody reaches for the brief in the first place.
                _BarAction(
                  icon: Icons.content_paste_go_outlined,
                  tooltip: l10n.outreachCopyAiBrief,
                  onPressed: _copyBrief,
                ),
                if (!isEmail)
                  _BarAction(
                    icon: Icons.alternate_email,
                    tooltip: l10n.outreachCopyContactValue(
                      contactMethodLabel(method, l10n),
                    ),
                    onPressed: state.hasRecipient
                        ? () => _copy(
                              state.recipientValue ?? '',
                              l10n.commonCopied,
                            )
                        : null,
                  ),
                // "Mark as sent" stays available even when Gmail is connected:
                // it is how somebody records a message they sent from their own
                // address, or by hand, and removing it would make the log
                // quietly incomplete.
                _BarAction(
                  icon: Icons.check,
                  tooltip: l10n.outreachMarkSent,
                  primary: !isEmail && !hasLink,
                  onPressed: state.isSending ? null : _markSent,
                ),
                const Spacer(),
                // Not a disabled send button: there is nothing to enable. The
                // tooltip says why the real send is missing and that the
                // hand-off beside it still works.
                if (isEmail && !canSendWithGmail)
                  Tooltip(
                    message:
                        '${mailbox?.error?.failure == GmailFailure.authFailed ? l10n.outreachGmailReconnectAction : l10n.outreachGmailNotConnected}'
                        '\n${l10n.outreachGmailSendUnavailableHint}',
                    child: Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: Icon(
                        Icons.info_outline,
                        size: 18,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One docked action: an icon, its name as a tooltip, and a filled treatment
/// for whichever one is the actual send on this thread.
///
/// A disabled [IconButton] swallows pointer events, tooltip included, so the
/// unavailable case is wrapped from outside — without that, a draft with no
/// recipient yet shows a row of grey glyphs and no way to learn what any of
/// them are.
class _BarAction extends StatelessWidget {
  const _BarAction({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.primary = false,
    this.busy = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool primary;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final Widget glyph = busy
        ? const SizedBox(
            width: 38,
            height: 38,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Icon(icon);
    final button = primary
        ? IconButton.filled(
            onPressed: onPressed,
            visualDensity: VisualDensity.compact,
            tooltip: onPressed == null ? null : tooltip,
            icon: glyph,
          )
        : IconButton(
            onPressed: onPressed,
            visualDensity: VisualDensity.compact,
            tooltip: onPressed == null ? null : tooltip,
            icon: glyph,
          );
    if (onPressed != null) return button;
    return Tooltip(message: tooltip, child: button);
  }
}
