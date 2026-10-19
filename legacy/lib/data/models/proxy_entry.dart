/// One proxy candidate in the scraper's rotation pool — see
/// [SearchTuningSettings.proxies]. [id] is generated client-side
/// (`'proxy_${DateTime.now().microsecondsSinceEpoch}'`, same convention as
/// `AiProviderConfig`) so the Settings card can address a row for edit/
/// delete without round-tripping through the repository first.
class ProxyEntry {
  const ProxyEntry({
    required this.id,
    this.label = '',
    required this.host,
    required this.port,
    this.username = '',
    this.password = '',
    this.enabled = true,
  });

  final String id;
  final String label;
  final String host;
  final int? port;
  final String username;

  /// Never logged, never sent anywhere except written back to the shared
  /// scraper config — same handling care as an AI provider API key, even
  /// though it lives in `data/settings.json` rather than secure storage:
  /// the Python pipeline has to be able to read it, and that file is the
  /// only thing that crosses the Flutter/Python boundary today.
  final String password;
  final bool enabled;

  String get hostPort => port == null ? host : '$host:$port';

  ProxyEntry copyWith({
    String? label,
    String? host,
    int? port,
    bool clearPort = false,
    String? username,
    String? password,
    bool? enabled,
  }) {
    return ProxyEntry(
      id: id,
      label: label ?? this.label,
      host: host ?? this.host,
      port: clearPort ? null : (port ?? this.port),
      username: username ?? this.username,
      password: password ?? this.password,
      enabled: enabled ?? this.enabled,
    );
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'label': label,
        'host': host,
        'port': port,
        'username': username,
        'password': password,
        'enabled': enabled,
      };

  factory ProxyEntry.fromJson(Map<String, Object?> json) {
    final port = json['port'];
    return ProxyEntry(
      id: json['id'] as String? ??
          'proxy_${DateTime.now().microsecondsSinceEpoch}',
      label: json['label'] as String? ?? '',
      host: json['host'] as String? ?? '',
      port: port is num ? port.round() : null,
      username: json['username'] as String? ?? '',
      password: json['password'] as String? ?? '',
      enabled: json['enabled'] as bool? ?? true,
    );
  }
}
