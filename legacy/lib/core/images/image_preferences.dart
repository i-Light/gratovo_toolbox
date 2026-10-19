import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _autoDownloadKey = 'gratovo.images.autoDownload';
const _listImagesKey = 'gratovo.images.influencerList';

/// Whether a picture that is not already on disk should be SAVED after it is
/// fetched. On by default.
///
/// This is not a switch between showing and hiding images — every image is
/// shown either way. It decides only what happens on a cache miss:
///
///  * on — fetch the bytes once, keep them, and never ask YouTube's CDN for
///    that picture again on this machine;
///  * off — fetch it for display and keep nothing.
///
/// On is the right default for the machine this tool is normally installed on:
/// the same avatars and thumbnails are looked at over and over across a vetting
/// session, and paying for each one once beats re-fetching it every scroll.
/// Turning it off is the deliberate choice for a shared or borrowed machine,
/// where the app should leave no growing folder of creator photographs behind,
/// and the Settings card says so.
///
/// Either way, a local copy is checked FIRST, so a machine that has been
/// caching for a while stops making requests for images it already holds even
/// if the setting is later turned off.
class AutoDownloadImagesNotifier extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_loadPersisted());
    return true;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(_autoDownloadKey);
      if (saved == null) return;
      state = saved;
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the auto-download-images preference; keeping on.',
        name: 'gratovo.images',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> set(bool value) async {
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_autoDownloadKey, value);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the auto-download-images preference.',
        name: 'gratovo.images',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> toggle() => set(!state);
}

final autoDownloadImagesProvider =
    NotifierProvider<AutoDownloadImagesNotifier, bool>(
  AutoDownloadImagesNotifier.new,
);

/// Whether the Influencers list draws pictures at all.
///
/// A separate switch from [autoDownloadImagesProvider] because it answers a
/// different question. That one is about what gets kept; this one is about
/// what gets requested — the list shows dozens of avatars and banners per
/// screen, and on a slow connection turning them off is the difference between
/// a list that scrolls and one that stutters. It is also the honest way to
/// work through a long vetting session on a metered connection.
///
/// On by default: the pictures are genuinely useful for the judgement this
/// list exists to support, and a tool that starts blank looks broken.
/// Persisted, so whoever turns it off does not have to turn it off again on
/// every launch.
class InfluencerListImagesNotifier extends Notifier<bool> {
  @override
  bool build() {
    unawaited(_loadPersisted());
    return true;
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getBool(_listImagesKey);
      if (saved == null) return;
      state = saved;
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load the list-images preference; keeping images on.',
        name: 'gratovo.images',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> set(bool value) async {
    state = value;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_listImagesKey, value);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist the list-images preference.',
        name: 'gratovo.images',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> toggle() => set(!state);
}

final influencerListImagesProvider =
    NotifierProvider<InfluencerListImagesNotifier, bool>(
  InfluencerListImagesNotifier.new,
);
