import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _prefsKey = 'gratovo.rosterSection';

/// The three record lists that share the Roster page: influencers, brands, and
/// the archive of rejected channels. Grouped here because they are one area of
/// the app — you switch between them from the app bar rather than the nav rail.
enum RosterSection {
  influencers,
  brands,
  archive;

  IconData get icon => switch (this) {
        RosterSection.influencers => Icons.people_outline,
        RosterSection.brands => Icons.business_outlined,
        RosterSection.archive => Icons.inventory_2_outlined,
      };

  String label(AppLocalizations l10n) => switch (this) {
        RosterSection.influencers => l10n.navInfluencers,
        RosterSection.brands => l10n.navBrands,
        RosterSection.archive => l10n.navArchive,
      };
}

/// Which Roster section is showing.
///
/// Persisted per device, like the nav rail collapse preference beside it: the section
/// you last looked at is the one you almost always want next, and re-selecting
/// it on every launch is the kind of small tax that makes an app feel like it
/// is not listening. Defaults to [RosterSection.influencers] until the stored
/// value loads — a one-frame difference at most, matching the nav rail.
class RosterSectionNotifier extends Notifier<RosterSection> {
  @override
  RosterSection build() {
    unawaited(_loadPersisted());
    return RosterSection.influencers;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefsKey);
      if (saved == null) return;
      for (final section in RosterSection.values) {
        if (section.name == saved) {
          state = section;
          return;
        }
      }
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the persisted Roster section; keeping influencers.',
        name: 'gratovo.roster',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> select(RosterSection section) async {
    state = section;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, section.name);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the Roster section "${section.name}".',
        name: 'gratovo.roster',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final rosterSectionProvider =
    NotifierProvider<RosterSectionNotifier, RosterSection>(
  RosterSectionNotifier.new,
);
