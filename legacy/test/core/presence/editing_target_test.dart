import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';

void main() {
  group('keys', () {
    test('entityKey ignores the field, fieldKey includes it', () {
      const whole = EditingTarget(type: 'channel', id: 'UC123');
      const field = EditingTarget(type: 'channel', id: 'UC123', field: 'notes');

      expect(whole.entityKey, 'channel:UC123');
      expect(whole.fieldKey, 'channel:UC123');
      expect(field.entityKey, 'channel:UC123');
      expect(field.fieldKey, 'channel:UC123#notes');
    });
  });

  group('json round-trip', () {
    test('survives with and without a field', () {
      for (final target in [
        const EditingTarget(type: 'channel', id: 'UC123'),
        const EditingTarget(type: 'deal', id: 'd-1', field: 'price'),
      ]) {
        expect(EditingTarget.fromJson(target.toJson()), target);
      }
    });

    // Presence payloads come off the wire from other clients, possibly older
    // ones. A malformed payload must yield null (and so simply not draw a
    // border) rather than throwing inside the realtime callback, which would
    // kill the subscription for everything else.
    test('returns null for anything unusable', () {
      for (final input in <Object?>[
        null,
        'string',
        42,
        <String, dynamic>{},
        {'type': 'channel'},
        {'id': 'UC123'},
        {'type': '', 'id': 'UC123'},
        {'type': 'channel', 'id': ''},
        {'type': 5, 'id': 'UC123'},
      ]) {
        expect(EditingTarget.fromJson(input), isNull, reason: 'input: $input');
      }
    });

    test('treats an empty field as no field, not as a field named ""', () {
      final parsed = EditingTarget.fromJson(
          {'type': 'channel', 'id': 'UC123', 'field': ''});
      expect(parsed?.field, isNull);
      expect(parsed?.fieldKey, 'channel:UC123');
    });
  });
}
