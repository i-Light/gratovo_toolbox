import 'package:gratovo_toolbox/data/models/skill_gem_setup.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The person-facing name of the gem [role] stands for.
String skillGemRoleLabel(AppLocalizations l10n, SkillGemRole role) {
  switch (role) {
    case SkillGemRole.keywords:
      return l10n.skillsGemRoleKeywords;
  }
}
