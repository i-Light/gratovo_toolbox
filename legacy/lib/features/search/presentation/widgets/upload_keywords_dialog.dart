import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/search/application/search_keywords_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Popup that hands this device's keywords to another signed-in team
/// member's machine to run there — see `remote_search_intake_controller.dart`
/// for the receiving side. Opened by tapping a teammate's chip in
/// `SearchingNowRow` (see `SearchingUserChip`), which is also where the
/// recipient comes from.
class UploadKeywordsDialog extends ConsumerStatefulWidget {
  const UploadKeywordsDialog({super.key, required this.recipient});

  final TeamMember recipient;

  @override
  ConsumerState<UploadKeywordsDialog> createState() =>
      _UploadKeywordsDialogState();
}

class _UploadKeywordsDialogState extends ConsumerState<UploadKeywordsDialog> {
  late final TextEditingController _keywordsController;
  bool _sending = false;

  // Same `ValueNotifier` + only-recount-on-real-change approach as the
  // keyword box on the Search page (see `KeywordInput`'s `_keywordCount`):
  // `TextEditingController` also notifies on plain selection changes, and
  // recomputing the keyword count on every one of those (e.g. while dragging
  // to select text) would rebuild the whole dialog for nothing.
  final _keywordCount = ValueNotifier<int>(0);
  String _lastCountedText = '';

  @override
  void initState() {
    super.initState();
    // Seeded from this device's own box: the common case is "I already have
    // a list typed here, send a copy to an idle machine too" rather than
    // starting from nothing.
    final text = ref.read(searchKeywordsProvider).text;
    _keywordsController = TextEditingController(text: text);
    _lastCountedText = text;
    _keywordCount.value = SearchKeywordsState(text: text).keywords.length;
    _keywordsController.addListener(_onKeywordsChanged);
  }

  @override
  void dispose() {
    _keywordsController.removeListener(_onKeywordsChanged);
    _keywordsController.dispose();
    _keywordCount.dispose();
    super.dispose();
  }

  void _onKeywordsChanged() {
    final text = _keywordsController.text;
    if (text == _lastCountedText) return;
    _lastCountedText = text;
    _keywordCount.value = SearchKeywordsState(text: text).keywords.length;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final recipient = widget.recipient;
    final screen = MediaQuery.sizeOf(context);
    final width =
        screen.width * 0.9 < 520.0 ? screen.width * 0.9 : screen.width * 0.6;
    final maxHeight = screen.height * 0.8;

    // Built on `Dialog` (not `AlertDialog`) so the width below is a hard
    // constraint: `AlertDialog` measures its title/content/actions inside an
    // internal `IntrinsicWidth`, which was making the `SizedBox` width in
    // content get ignored.
    return Dialog(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: width, maxHeight: maxHeight),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.searchUploadDialogTitleTo(recipient.displayName),
                      style: theme.textTheme.titleLarge,
                    ),
                  ),
                  const SizedBox(width: 12),
                  ValueListenableBuilder<int>(
                    valueListenable: _keywordCount,
                    builder: (context, count, _) => Text(
                      l10n.searchKeywordsCount(formatCount(count)),
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Flexible(
                child: SingleChildScrollView(
                  child: TextField(
                    controller: _keywordsController,
                    maxLines: null,
                    minLines: 3,
                    decoration: InputDecoration(
                      hintText: l10n.searchUploadKeywordsHint,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              OverflowBar(
                alignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed:
                        _sending ? null : () => Navigator.of(context).pop(),
                    child: Text(
                        MaterialLocalizations.of(context).cancelButtonLabel),
                  ),
                  FilledButton(
                    onPressed: _sending ? null : () => _send(l10n),
                    child: _sending
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.searchUploadSendButton),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _send(AppLocalizations l10n) async {
    final keywords =
        SearchKeywordsState(text: _keywordsController.text).keywords;
    if (keywords.isEmpty) {
      AppToast.warning(context, l10n.searchNoKeywordsError);
      return;
    }

    setState(() => _sending = true);
    try {
      await ref.read(remoteSearchRepositoryProvider).send(
            toUserId: widget.recipient.id,
            keywords: keywords.join('\n'),
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      AppToast.success(
        context,
        l10n.searchUploadSent(widget.recipient.displayName, keywords.length),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _sending = false);
      AppToast.error(context, l10n.searchUploadSendFailed('$error'));
    }
  }
}
