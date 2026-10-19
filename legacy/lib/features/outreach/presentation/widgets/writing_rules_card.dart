import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/writing_rules_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The team's shared outreach writing rules — see
/// writing_rules_controller.dart's doc comment.
///
/// Plain content rather than a card, for the same reason as
/// [TemplateLibraryCard]: it is shown inside the app bar's writing-rules
/// dialog, which supplies the title and the surface around it.
class WritingRulesCard extends ConsumerStatefulWidget {
  const WritingRulesCard({super.key});

  @override
  ConsumerState<WritingRulesCard> createState() => _WritingRulesCardState();
}

class _WritingRulesCardState extends ConsumerState<WritingRulesCard> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final text = _controller.text;
    if (text.trim().isEmpty) return;
    await ref.read(writingRulesControllerProvider).add(text);
    _controller.clear();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final rulesAsync = ref.watch(writingRulesProvider);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        rulesAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, stackTrace) => Text(l10n.commonError),
          data: (rules) => Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final rule in rules)
                Chip(
                  label: Text(rule),
                  onDeleted: () =>
                      ref.read(writingRulesControllerProvider).remove(rule),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                decoration: InputDecoration(
                  hintText: l10n.outreachWritingRulesHint,
                  isDense: true,
                ),
                onSubmitted: (_) => _add(),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(
              onPressed: _add,
              child: Text(l10n.commonAdd),
            ),
          ],
        ),
      ],
    );
  }
}
