import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/native/all_keywords_export.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/native/local_pipeline_db.dart';
import 'package:gratovo_toolbox/core/native/scraper_process.dart';
import 'package:gratovo_toolbox/core/status/gemini_bridge_presentation.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/features/search/application/generate_keywords_controller.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/python_environment_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The button in the keyword box's header that opens [GenerateKeywordsDialog].
///
/// Absent on a platform with no bridge (web), and disabled — with the reason
/// in the tooltip — while the bridge is in a state where a request cannot
/// reach Gemini: failed, or up with no extension connected while the app is
/// not allowed to open a Gemini window itself (Settings, "open a window
/// automatically"). A stopped bridge is fine; the first request starts it.
///
/// Gathers the `avoid` list before opening: what is typed in the box, what
/// the local pipeline database has searched, and the project's
/// `all_keywords.txt` tally. Adding writes straight into [controller], which
/// is the same path a paste takes — the box's listener persists the text and
/// recounts.
class GenerateKeywordsButton extends ConsumerWidget {
  const GenerateKeywordsButton({super.key, required this.controller});

  final TextEditingController controller;

  Future<void> _open(BuildContext context, WidgetRef ref) async {
    final current = SearchKeywordsState(text: controller.text).keywords;
    final searched = _alreadySearched(ref);
    await showDialog<void>(
      context: context,
      builder: (_) => GenerateKeywordsDialog(
        currentKeywords: current,
        alreadySearched: searched,
        onAdd: _append,
      ),
    );
  }

  /// Everything the pipeline has run before, from both places it is kept.
  static List<String> _alreadySearched(WidgetRef ref) {
    final override =
        ref.read(pythonEnvironmentProvider).projectRootOverride.trim();
    final paths = ScraperProcess.resolvePaths(
      projectRootOverride: override.isEmpty ? null : override,
    );
    if (paths == null) return const [];
    return [
      ...LocalPipelineDb.readAllKeywords(paths.dbPath),
      ...readAllKeywordsFile(dataDir: paths.dataDir),
    ];
  }

  /// The same merge the remote-intake path uses: only lines the box does
  /// not already have, appended under whatever is there.
  void _append(List<String> keywords) {
    final text = controller.text;
    final present = SearchKeywordsState(text: text).keywords.toSet();
    final toAdd = [
      for (final keyword in keywords)
        if (present.add(keyword.trim())) keyword.trim(),
    ];
    if (toAdd.isEmpty) return;
    final trimmed = text.trimRight();
    final next =
        trimmed.isEmpty ? toAdd.join('\n') : '$trimmed\n${toAdd.join('\n')}';
    controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: next.length),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final bridge = ref.watch(geminiBridgeProvider);
    if (!bridge.isAvailable) return const SizedBox.shrink();
    final state = ref.watch(geminiBridgeStateProvider);
    final autoOpen = ref.watch(
      geminiBridgeSettingsProvider.select((s) => s.autoOpenWindow),
    );

    final String? blocker;
    if (state.isFailed) {
      blocker = l10n.geminiBridgeStateFailed;
    } else if (state.isListening && !autoOpen) {
      blocker = l10n.geminiKeywordsNotConnected;
    } else {
      blocker = null;
    }
    final enabled = blocker == null;

    return Tooltip(
      message: enabled ? l10n.geminiKeywordsButton : blocker,
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: enabled ? () => _open(context, ref) : null,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          child: Icon(
            Icons.auto_awesome,
            size: 18,
            color: enabled
                ? theme.colorScheme.primary
                : theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.5),
          ),
        ),
      ),
    );
  }
}

/// Topic in, ~100 long-tail phrases out, ticked ones into the keyword box.
///
/// Two screens in one dialog. The form first; then the answer as a checkbox
/// list, with phrases the person already has greyed and unticked so "Add N"
/// only ever adds something new. A failure shows as the code and message
/// with Retry, never as an exception.
class GenerateKeywordsDialog extends ConsumerStatefulWidget {
  const GenerateKeywordsDialog({
    super.key,
    required this.currentKeywords,
    required this.alreadySearched,
    required this.onAdd,
  });

  /// What is in the keyword box now.
  final List<String> currentKeywords;

  /// What the pipeline has run before (local database + all-keywords tally).
  final List<String> alreadySearched;

  /// Receives the ticked phrases when Add is pressed.
  final ValueChanged<List<String>> onAdd;

  @override
  ConsumerState<GenerateKeywordsDialog> createState() =>
      _GenerateKeywordsDialogState();
}

class _GenerateKeywordsDialogState
    extends ConsumerState<GenerateKeywordsDialog> {
  final _topic = TextEditingController();
  final _count = TextEditingController(text: '100');
  final _chats = TextEditingController(
    text: '${GeminiBridgeSettings.defaultKeywordChats}',
  );
  bool _chatsEdited = false;
  final _exclusions = TextEditingController();
  final _styles = TextEditingController();
  final _language = TextEditingController();
  final _notes = TextEditingController();
  bool _topicTouched = false;

  @override
  void initState() {
    super.initState();
    _chats.addListener(_markChatsEdited);
    // The saved number of chats, once the settings have loaded — unless the
    // person already typed one.
    final notifier = ref.read(geminiBridgeSettingsProvider.notifier);
    notifier.ready.then((_) {
      if (!mounted || _chatsEdited) return;
      _setChats('${ref.read(geminiBridgeSettingsProvider).keywordChats}');
    });
  }

  void _markChatsEdited() => _chatsEdited = true;

  void _setChats(String text) {
    _chats.removeListener(_markChatsEdited);
    _chats.text = text;
    _chats.addListener(_markChatsEdited);
  }

  @override
  void dispose() {
    _topic.dispose();
    _count.dispose();
    _chats.dispose();
    _exclusions.dispose();
    _styles.dispose();
    _language.dispose();
    _notes.dispose();
    super.dispose();
  }

  List<String> get _avoid => [
        ...widget.currentKeywords,
        ...widget.alreadySearched,
      ];

  /// Comma- or newline-separated, trimmed, blanks dropped.
  static List<String> _split(String raw) => [
        for (final part in raw.split(RegExp(r'[,\n]')))
          if (part.trim().isNotEmpty) part.trim(),
      ];

  Future<void> _generate() async {
    setState(() => _topicTouched = true);
    final topic = _topic.text.trim();
    if (topic.isEmpty) return;
    final count = int.tryParse(_count.text.trim()) ?? 100;
    final chats = (int.tryParse(_chats.text.trim()) ?? 1).clamp(1, 8);
    // Remembered for next time: the setting is what the field starts at.
    final settings = ref.read(geminiBridgeSettingsProvider.notifier);
    unawaited(settings.edit(
        (s) => s.keywordChats == chats ? s : s.copyWith(keywordChats: chats)));
    final language = _language.text.trim();
    final notes = _notes.text.trim();
    await ref.read(generateKeywordsControllerProvider.notifier).generate(
          topic: topic,
          count: count.clamp(1, 500),
          exclusions: _split(_exclusions.text),
          styles: _split(_styles.text),
          language: language.isEmpty ? null : language,
          avoid: _avoid,
          notes: notes.isEmpty ? null : notes,
          chats: chats,
        );
  }

  void _add() {
    final l10n = AppLocalizations.of(context);
    final toAdd = ref.read(generateKeywordsControllerProvider).toAdd;
    if (toAdd.isEmpty) return;
    widget.onAdd(toAdd);
    AppToast.success(context, l10n.geminiKeywordsAdded(toAdd.length));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(generateKeywordsControllerProvider);
    final showResult = state.result != null;

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640, maxHeight: 720),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 12, 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.geminiKeywordsTitle,
                          style: theme.textTheme.titleLarge,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.geminiKeywordsSubtitle,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.commonClose,
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Flexible(
              child: showResult
                  ? _ResultList(state: state)
                  : _Form(
                      topic: _topic,
                      count: _count,
                      chats: _chats,
                      exclusions: _exclusions,
                      styles: _styles,
                      language: _language,
                      notes: _notes,
                      topicError: _topicTouched && _topic.text.trim().isEmpty
                          ? l10n.geminiKeywordsTopicRequired
                          : null,
                      avoidCount: _avoid.length,
                      generating: state.generating,
                      progress: state.progress,
                      error: state.error,
                    ),
            ),
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
              child: showResult
                  ? _ResultActions(state: state, onAdd: _add)
                  : _FormActions(
                      generating: state.generating,
                      hasError: state.error != null,
                      onGenerate: _generate,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Form extends StatelessWidget {
  const _Form({
    required this.topic,
    required this.count,
    required this.chats,
    required this.exclusions,
    required this.styles,
    required this.language,
    required this.notes,
    required this.topicError,
    required this.avoidCount,
    required this.generating,
    required this.progress,
    required this.error,
  });

  final TextEditingController topic;
  final TextEditingController count;
  final TextEditingController chats;
  final TextEditingController exclusions;
  final TextEditingController styles;
  final TextEditingController language;
  final TextEditingController notes;
  final String? topicError;
  final int avoidCount;
  final bool generating;
  final GeminiProgress? progress;
  final GeminiBridgeException? error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final progress = this.progress;

    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
      children: [
        TextField(
          controller: topic,
          autofocus: true,
          enabled: !generating,
          decoration: InputDecoration(
            labelText: l10n.geminiKeywordsTopicLabel,
            hintText: l10n.geminiKeywordsTopicHint,
            errorText: topicError,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            SizedBox(
              width: 120,
              child: TextField(
                controller: count,
                enabled: !generating,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: l10n.geminiKeywordsCountLabel,
                ),
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 150,
              child: TextField(
                controller: chats,
                enabled: !generating,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: l10n.geminiKeywordsChatsLabel,
                  helperText: l10n.geminiKeywordsChatsHint,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: language,
                enabled: !generating,
                decoration: InputDecoration(
                  labelText: l10n.geminiKeywordsLanguageLabel,
                  hintText: l10n.geminiKeywordsLanguageHint,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: styles,
          enabled: !generating,
          decoration: InputDecoration(
            labelText: l10n.geminiKeywordsStylesLabel,
            hintText: l10n.geminiKeywordsStylesHint,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: exclusions,
          enabled: !generating,
          maxLines: 3,
          minLines: 2,
          decoration: InputDecoration(
            labelText: l10n.geminiKeywordsExclusionsLabel,
            hintText: l10n.geminiKeywordsExclusionsHint,
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: notes,
          enabled: !generating,
          maxLines: 3,
          minLines: 2,
          decoration: InputDecoration(
            labelText: l10n.geminiKeywordsNotesLabel,
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          l10n.geminiKeywordsAvoiding(avoidCount),
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        if (generating) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  progress == null
                      ? l10n.geminiKeywordsGenerating
                      : l10n.geminiKeywordsProgress(
                          progress.done,
                          progress.total,
                          progress.keywords ?? 0,
                        ),
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ],
          ),
          if (progress?.fraction != null) ...[
            const SizedBox(height: 8),
            LinearProgressIndicator(value: progress!.fraction),
          ],
        ],
        if (error != null) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.errorContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.error_outline,
                  size: 18,
                  color: theme.colorScheme.onErrorContainer,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: SelectableText(
                    describeGeminiFailure(error!, l10n),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _FormActions extends StatelessWidget {
  const _FormActions({
    required this.generating,
    required this.hasError,
    required this.onGenerate,
  });

  final bool generating;
  final bool hasError;
  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        const SizedBox(width: 8),
        FilledButton.icon(
          onPressed: generating ? null : onGenerate,
          icon: const Icon(Icons.auto_awesome, size: 18),
          label: Text(
            hasError ? l10n.commonRetry : l10n.geminiKeywordsGenerate,
          ),
        ),
      ],
    );
  }
}

class _ResultList extends ConsumerWidget {
  const _ResultList({required this.state});

  final GenerateKeywordsState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final controller = ref.read(generateKeywordsControllerProvider.notifier);
    final keywords = state.keywords;
    final result = state.result!;

    if (keywords.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child:
            Text(l10n.geminiKeywordsEmpty, style: theme.textTheme.bodyMedium),
      );
    }

    final failed = result.failedChats;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (result.partial && failed.isNotEmpty)
          Container(
            key: const ValueKey('gemini-keywords-partial'),
            margin: const EdgeInsets.fromLTRB(24, 12, 24, 0),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.tertiaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: DefaultTextStyle.merge(
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onTertiaryContainer,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.geminiKeywordsPartial(
                      failed.length,
                      result.chats.length,
                    ),
                  ),
                  for (final chat in failed)
                    Text(
                      l10n.geminiKeywordsChatFailed(
                        chat.index + 1,
                        chat.error ?? '—',
                      ),
                    ),
                ],
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 16, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.geminiKeywordsResultCount(
                    state.addable.length,
                    keywords.length - state.addable.length + result.dropped,
                  ),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              TextButton(
                onPressed: controller.selectAll,
                child: Text(l10n.geminiKeywordsSelectAll),
              ),
              TextButton(
                onPressed: controller.selectNone,
                child: Text(l10n.geminiKeywordsSelectNone),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            itemCount: keywords.length,
            itemBuilder: (context, index) {
              final keyword = keywords[index];
              final known = state.isKnown(keyword);
              return CheckboxListTile(
                key: ValueKey('gemini-keyword-$index'),
                dense: true,
                controlAffinity: ListTileControlAffinity.leading,
                enabled: !known,
                value: !known && state.selected.contains(keyword),
                onChanged: known ? null : (_) => controller.toggle(keyword),
                title: Text(
                  keyword,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: known
                        ? theme.colorScheme.onSurfaceVariant
                            .withValues(alpha: 0.6)
                        : null,
                    decoration: known ? TextDecoration.lineThrough : null,
                  ),
                ),
                subtitle: known
                    ? Text(
                        l10n.geminiKeywordsAlreadyKnown,
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    : null,
              );
            },
          ),
        ),
      ],
    );
  }
}

class _ResultActions extends ConsumerWidget {
  const _ResultActions({required this.state, required this.onAdd});

  final GenerateKeywordsState state;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final count = state.toAdd.length;
    return Row(
      children: [
        TextButton.icon(
          onPressed:
              ref.read(generateKeywordsControllerProvider.notifier).reset,
          icon: const Icon(Icons.arrow_back, size: 18),
          label: Text(l10n.geminiKeywordsBack),
        ),
        const Spacer(),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        const SizedBox(width: 8),
        FilledButton.icon(
          onPressed: count == 0 ? null : onAdd,
          icon: const Icon(Icons.playlist_add, size: 18),
          label: Text(l10n.geminiKeywordsAdd(count)),
        ),
      ],
    );
  }
}
