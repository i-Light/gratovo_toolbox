import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/news/application/news_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Adds a feed to the shared source list.
///
/// The feed is only recorded here, not fetched — fetching happens on the
/// pipeline machine, so a feed added from a phone starts producing stories at
/// the next refresh rather than immediately. The success message says so,
/// because a new source that shows no stories otherwise reads as a failure.
class AddNewsSourceDialog extends ConsumerStatefulWidget {
  const AddNewsSourceDialog({super.key});

  static Future<void> show(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (context) => const AddNewsSourceDialog(),
    );
  }

  @override
  ConsumerState<AddNewsSourceDialog> createState() =>
      _AddNewsSourceDialogState();
}

class _AddNewsSourceDialogState extends ConsumerState<AddNewsSourceDialog> {
  final _formKey = GlobalKey<FormState>();
  final _url = TextEditingController();
  final _title = TextEditingController();
  final _niche = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _url.dispose();
    _title.dispose();
    _niche.dispose();
    super.dispose();
  }

  /// http(s) only, and it has to have a host.
  ///
  /// Validated here rather than left to the fetcher because the failure is
  /// otherwise silent and delayed: a typo'd feed sits in the list looking
  /// normal until someone runs a refresh on another machine and reads the
  /// error it recorded.
  String? _validateUrl(String? value, AppLocalizations l10n) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return l10n.newsAddSourceUrlInvalid;
    final uri = Uri.tryParse(text);
    if (uri == null ||
        (uri.scheme != 'http' && uri.scheme != 'https') ||
        uri.host.isEmpty) {
      return l10n.newsAddSourceUrlInvalid;
    }
    return null;
  }

  Future<void> _submit(AppLocalizations l10n) async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);

    try {
      await ref.read(newsRepositoryProvider).addSource(
            feedUrl: _url.text.trim(),
            title: _title.text.trimmedOrNull,
            niche: _niche.text.trimmedOrNull,
          );
      ref.invalidate(newsSourcesProvider);

      if (mounted) {
        Navigator.of(context).pop();
        AppToast.success(context, l10n.newsAddSourceAdded);
      }
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        AppToast.error(context, l10n.newsAddSourceFailed);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return AlertDialog(
      title: Text(l10n.newsAddSourceTitle),
      content: SizedBox(
        width: 420,
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _url,
                autofocus: true,
                keyboardType: TextInputType.url,
                decoration: InputDecoration(
                  labelText: l10n.newsAddSourceUrl,
                  hintText: l10n.newsAddSourceUrlHint,
                  border: const OutlineInputBorder(),
                ),
                validator: (value) => _validateUrl(value, l10n),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _niche,
                decoration: InputDecoration(
                  labelText: l10n.newsAddSourceNiche,
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _title,
                decoration: InputDecoration(
                  labelText: l10n.newsAddSourceTitleField,
                  helperText: l10n.newsAddSourceTitleHelp,
                  helperMaxLines: 2,
                  border: const OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        FilledButton(
          onPressed: _saving ? null : () => _submit(l10n),
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.newsAddSourceSubmit),
        ),
      ],
    );
  }
}
