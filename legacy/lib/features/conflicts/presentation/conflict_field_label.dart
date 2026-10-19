import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The database's column name as something a person reads.
///
/// Its own file because both the conflicts page and the banner on an
/// influencer profile name the same fields, and two switch statements over the
/// same whitelist would drift the first time a column is added.
String conflictFieldLabel(AppLocalizations l10n, String field) =>
    switch (field) {
      'notes' => l10n.conflictFieldNotes,
      'channel_tags' => l10n.conflictFieldTags,
      'pipeline_stage' => l10n.conflictFieldStage,
      'vetting_status' => l10n.conflictFieldVetting,
      'relevance_criteria' => l10n.conflictFieldCriteria,
      'provided_data' => l10n.conflictFieldProvided,
      'contacts' => l10n.conflictFieldContacts,
      // Not a fallback that can normally be reached — the database whitelists
      // the field names — but a new column added on one side only should read
      // as itself rather than as a blank.
      _ => field,
    };
