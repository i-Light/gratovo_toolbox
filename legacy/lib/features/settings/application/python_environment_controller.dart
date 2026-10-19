import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _pythonExecutablePrefsKey = 'gratovo.python.executable';
const _projectRootOverridePrefsKey = 'gratovo.python.projectRootOverride';

/// How this machine launches the Python pipeline -- deliberately per-device
/// (`shared_preferences`, same pattern as `theme_provider.dart`), never
/// team-shared: every team member's Python install lives at whatever path
/// is right for *their* machine, same reasoning as `AiProviderConfig`'s API
/// keys being per-device even though the app itself is shared.
class PythonEnvironmentSettings {
  const PythonEnvironmentSettings({
    this.pythonExecutable = 'python',
    this.projectRootOverride = '',
  });

  /// Whatever `Process.start` should run as the interpreter -- a bare
  /// command resolved via PATH (the default, "python"), or a full path to a
  /// specific interpreter/venv (e.g. a `venv\Scripts\python.exe`).
  /// `pipeline/requirements.txt` says what the pipeline needs, not which of
  /// a machine's interpreters has it installed, so this project genuinely
  /// can't know which one is right; this field is the escape hatch rather
  /// than a guess baked into the app.
  ///
  /// The default is not always literally `python`: an installed build ships
  /// its own interpreter in `pyruntime/` beside the .exe (the machines this
  /// gets installed on generally have no Python on PATH at all), and
  /// `ScraperProcess.resolveInterpreter` prefers it whenever this field is
  /// left at the default. Anything actually typed here still wins.
  final String pythonExecutable;

  /// Blank (the default) means let `ScraperProcess.resolvePaths` find the
  /// pipeline: beside the .exe on an installed build, or by walking up from
  /// the working directory on a `flutter run` checkout. That covers both ways
  /// this app is launched, so blank is the right answer almost always.
  ///
  /// Set this to point at a *different* checkout than the one the app came
  /// from — the folder holding `pipeline/` and `data/`. Unlike the blank
  /// default it is taken completely literally, including `data/`: no
  /// searching and no redirect to the per-user data folder, because an
  /// explicit answer should stay explicit.
  final String projectRootOverride;

  PythonEnvironmentSettings copyWith({
    String? pythonExecutable,
    String? projectRootOverride,
  }) {
    return PythonEnvironmentSettings(
      pythonExecutable: pythonExecutable ?? this.pythonExecutable,
      projectRootOverride: projectRootOverride ?? this.projectRootOverride,
    );
  }
}

/// The persisted settings, read directly, for code that runs outside the
/// provider tree — the sync engine's pipeline bridge is built in `main()`
/// before the first frame and has no `ref` to read [pythonEnvironmentProvider]
/// through. Defaults on any failure, same as the notifier.
Future<PythonEnvironmentSettings> readPersistedPythonEnvironment() async {
  try {
    final prefs = await SharedPreferences.getInstance();
    return PythonEnvironmentSettings(
      pythonExecutable: prefs.getString(_pythonExecutablePrefsKey) ?? 'python',
      projectRootOverride: prefs.getString(_projectRootOverridePrefsKey) ?? '',
    );
  } catch (_) {
    return const PythonEnvironmentSettings();
  }
}

class PythonEnvironmentNotifier extends Notifier<PythonEnvironmentSettings> {
  @override
  PythonEnvironmentSettings build() {
    unawaited(_loadPersisted());
    return const PythonEnvironmentSettings();
  }

  Future<void> _loadPersisted() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final python = prefs.getString(_pythonExecutablePrefsKey);
      final root = prefs.getString(_projectRootOverridePrefsKey);
      if (python == null && root == null) return;
      state = PythonEnvironmentSettings(
        pythonExecutable: python ?? state.pythonExecutable,
        projectRootOverride: root ?? state.projectRootOverride,
      );
    } catch (error, stackTrace) {
      developer.log(
        'Failed to load persisted Python environment settings; keeping '
        'defaults.',
        name: 'gratovo.python.environment',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> update(PythonEnvironmentSettings settings) async {
    state = settings;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
          _pythonExecutablePrefsKey, settings.pythonExecutable);
      await prefs.setString(
          _projectRootOverridePrefsKey, settings.projectRootOverride);
    } catch (error, stackTrace) {
      developer.log(
        'Failed to persist Python environment settings.',
        name: 'gratovo.python.environment',
        level: 900,
        error: error,
        stackTrace: stackTrace,
      );
    }
  }
}

final pythonEnvironmentProvider =
    NotifierProvider<PythonEnvironmentNotifier, PythonEnvironmentSettings>(
  PythonEnvironmentNotifier.new,
);
