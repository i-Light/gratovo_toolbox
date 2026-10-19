/// A team member's own configuration for one registered hosted AI provider
/// — what turns the `AiProvider` interface (`lib/core/ai/ai_provider.dart`)
/// from "just an interface" into an actual, callable provider alongside
/// the always-available `TemplateFillAiProvider` fallback. See
/// `ai_provider_config_repository.dart`'s doc comment for why this is
/// stored in encrypted per-device storage rather than `shared_preferences`
/// like every other Settings value.
class AiProviderConfig {
  const AiProviderConfig({
    required this.id,
    required this.displayName,
    required this.apiKey,
    required this.model,
  });

  final String id;

  /// What this provider shows up as in the picker (e.g. "Claude — work
  /// account"). Free text, not the vendor name — a team member might
  /// register more than one key for the same vendor.
  final String displayName;

  final String apiKey;

  /// The specific model this config calls (e.g. `claude-sonnet-4-5`).
  /// Free text rather than a closed enum, since new model names ship more
  /// often than this app does.
  final String model;

  AiProviderConfig copyWith({
    String? displayName,
    String? apiKey,
    String? model,
  }) {
    return AiProviderConfig(
      id: id,
      displayName: displayName ?? this.displayName,
      apiKey: apiKey ?? this.apiKey,
      model: model ?? this.model,
    );
  }

  Map<String, String> toJson() => {
        'id': id,
        'displayName': displayName,
        'apiKey': apiKey,
        'model': model,
      };

  static AiProviderConfig fromJson(Map<String, dynamic> json) {
    return AiProviderConfig(
      id: json['id'] as String,
      displayName: json['displayName'] as String,
      apiKey: json['apiKey'] as String,
      model: json['model'] as String,
    );
  }
}
