import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/presentation/widgets/template_performance_section.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The outreach template library: view, add, edit, and delete
/// [EmailTemplate]s.
///
/// Plain content, not a card of its own: it is shown inside the app bar's
/// template dialog (see setup_dialogs.dart), which already supplies the title,
/// the surface and the scrolling. It used to be a collapsed `ExpansionTile`
/// docked above the conversation list, back when it lived on the page itself.
class TemplateLibraryCard extends ConsumerWidget {
  const TemplateLibraryCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final templatesAsync = ref.watch(allTemplatesProvider);

    return templatesAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) => Text(l10n.commonError),
      data: (templates) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (templates.isNotEmpty) const TemplatePerformanceSection(),
            if (templates.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  l10n.outreachNoTemplateOption,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            for (final template in templates)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(template.name),
                subtitle: Text(
                  template.kind == TemplateKind.dm
                      ? '${l10n.outreachTemplateKindDm} · ${template.body}'
                      : template.subject,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit_outlined),
                      onPressed: () => _openEditor(
                        context,
                        ref,
                        l10n,
                        template: template,
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () async {
                        await ref
                            .read(templateRepositoryProvider)
                            .delete(template.id);
                        ref.invalidate(allTemplatesProvider);
                      },
                    ),
                  ],
                ),
              ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => _openEditor(context, ref, l10n),
                icon: const Icon(Icons.add),
                label: Text(l10n.outreachAddTemplate),
              ),
            ),
          ],
        );
      },
    );
  }

  Future<void> _openEditor(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n, {
    EmailTemplate? template,
  }) async {
    final nameController = TextEditingController(text: template?.name ?? '');
    final subjectController = TextEditingController(
      text: template?.subject ?? '',
    );
    final bodyController = TextEditingController(text: template?.body ?? '');
    var kind = template?.kind ?? TemplateKind.email;

    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(
            template == null
                ? l10n.outreachNewTemplateTitle
                : l10n.outreachEditTemplateTitle,
          ),
          content: SizedBox(
            width: 420,
            child: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, setDialogState) => Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextField(
                      controller: nameController,
                      decoration: InputDecoration(
                        labelText: l10n.outreachTemplateNameLabel,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: SegmentedButton<TemplateKind>(
                        segments: [
                          ButtonSegment(
                            value: TemplateKind.email,
                            label: Text(l10n.outreachTemplateKindEmail),
                          ),
                          ButtonSegment(
                            value: TemplateKind.dm,
                            label: Text(l10n.outreachTemplateKindDm),
                          ),
                        ],
                        selected: {kind},
                        onSelectionChanged: (selection) =>
                            setDialogState(() => kind = selection.first),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (kind == TemplateKind.email) ...[
                      TextField(
                        controller: subjectController,
                        decoration: InputDecoration(
                          labelText: l10n.outreachTemplateSubjectLabel,
                        ),
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextField(
                      controller: bodyController,
                      maxLines: 6,
                      decoration: InputDecoration(
                        labelText: l10n.outreachTemplateBodyLabel,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.outreachTemplateTokenHint,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l10n.commonCancel),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l10n.commonSave),
            ),
          ],
        );
      },
    );

    // Read the fields out and release the controllers before any early
    // return: they are created fresh on every open of this dialog, so a
    // path that skipped disposal would leak one set per open.
    final name = nameController.text.trim();
    final subject = subjectController.text.trim();
    final body = bodyController.text;
    nameController.dispose();
    subjectController.dispose();
    bodyController.dispose();

    if (saved != true) return;
    if (name.isEmpty) return;

    final id = template?.id ?? 'tmpl_${DateTime.now().microsecondsSinceEpoch}';
    await ref.read(templateRepositoryProvider).upsert(
          EmailTemplate(
            id: id,
            name: name,
            subject: kind == TemplateKind.email ? subject : '',
            body: body,
            kind: kind,
          ),
        );
    ref.invalidate(allTemplatesProvider);
  }
}
