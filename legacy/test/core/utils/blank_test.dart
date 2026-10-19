import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/utils/blank.dart';

void main() {
  test('null and whitespace-only strings are absent', () {
    expect(null.trimmedOrNull, isNull);
    expect(''.trimmedOrNull, isNull);
    expect('   \n\t'.trimmedOrNull, isNull);
  });

  test('anything else comes back trimmed', () {
    expect('  @handle '.trimmedOrNull, '@handle');
    expect('x'.trimmedOrNull, 'x');
  });
}
