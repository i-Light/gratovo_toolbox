import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';

void main() {
  group('fromJson', () {
    test('reads a full object', () {
      final contact = InfluencerContact.fromJson({
        'method': 'whatsapp',
        'value': '+20 100 123 4567',
        'label': 'manager',
        'primary': true,
      });

      expect(contact, isNotNull);
      expect(contact!.method, ContactMethod.whatsapp);
      expect(contact.value, '+20 100 123 4567');
      expect(contact.label, 'manager');
      expect(contact.isPrimary, isTrue);
    });

    test('an unknown method reads as other rather than throwing', () {
      // A method written by a future build must not take the profile page
      // down. The address is the part that matters and it survives.
      final contact = InfluencerContact.fromJson({
        'method': 'carrier-pigeon',
        'value': 'somewhere',
      });

      expect(contact!.method, ContactMethod.other);
      expect(contact.value, 'somewhere');
    });

    test('a bare string is read, and its method guessed where it is obvious',
        () {
      // Rows written by hand or by an import script that stored a plain
      // address rather than an object. Dropping them would lose real data.
      expect(
        InfluencerContact.fromJson('hello@example.com')!.method,
        ContactMethod.email,
      );
      expect(
        InfluencerContact.fromJson('+20 100 123 4567')!.method,
        ContactMethod.phone,
      );
      // An @handle is NOT an email — it has no dot after the @ and could be
      // any of four platforms, so guessing one would be worse than admitting
      // it is unknown.
      expect(
        InfluencerContact.fromJson('@someone')!.method,
        ContactMethod.other,
      );
    });

    test('anything with no usable value is dropped', () {
      expect(InfluencerContact.fromJson(null), isNull);
      expect(InfluencerContact.fromJson(''), isNull);
      expect(InfluencerContact.fromJson('   '), isNull);
      expect(InfluencerContact.fromJson({'method': 'email'}), isNull);
      expect(InfluencerContact.fromJson({'value': '  '}), isNull);
      expect(InfluencerContact.fromJson(42), isNull);
    });
  });

  group('listFromJson', () {
    test('keeps the usable members and drops the rest', () {
      final contacts = InfluencerContact.listFromJson([
        {'method': 'email', 'value': 'a@b.com'},
        null,
        {'method': 'email'},
        'c@d.com',
      ]);

      expect(contacts, hasLength(2));
      expect(contacts.first.value, 'a@b.com');
      expect(contacts.last.value, 'c@d.com');
    });

    test('a column that is not a list at all reads as empty', () {
      expect(InfluencerContact.listFromJson(null), isEmpty);
      expect(InfluencerContact.listFromJson({'value': 'x'}), isEmpty);
    });
  });

  group('normalize', () {
    test('trims values and drops blank ones', () {
      final contacts = InfluencerContact.normalize(const [
        InfluencerContact(method: ContactMethod.email, value: '  a@b.com  '),
        InfluencerContact(method: ContactMethod.email, value: '   '),
      ]);

      expect(contacts, hasLength(1));
      expect(contacts.single.value, 'a@b.com');
    });

    test('keeps at most one primary, and the first one wins', () {
      // Two people each ticking a primary while offline is a real way to reach
      // this state. Picking a deterministic winner is what stops the list from
      // ordering itself differently on each device.
      final contacts = InfluencerContact.normalize(const [
        InfluencerContact(
          method: ContactMethod.email,
          value: 'first@b.com',
          isPrimary: true,
        ),
        InfluencerContact(
          method: ContactMethod.email,
          value: 'second@b.com',
          isPrimary: true,
        ),
      ]);

      expect(contacts.map((c) => c.isPrimary), [true, false]);
    });

    test('does not invent a primary when none is marked', () {
      // Influencer.primaryContact falls back to the first entry for display;
      // that is a presentation choice and must not be written back as though
      // somebody had chosen it.
      final contacts = InfluencerContact.normalize(const [
        InfluencerContact(method: ContactMethod.email, value: 'a@b.com'),
      ]);

      expect(contacts.single.isPrimary, isFalse);
    });

    test('preserves order', () {
      final contacts = InfluencerContact.normalize(const [
        InfluencerContact(method: ContactMethod.email, value: 'a@b.com'),
        InfluencerContact(method: ContactMethod.whatsapp, value: '+1'),
        InfluencerContact(method: ContactMethod.instagram, value: '@c'),
      ]);

      expect(
        contacts.map((c) => c.method),
        [ContactMethod.email, ContactMethod.whatsapp, ContactMethod.instagram],
      );
    });
  });

  group('toJson', () {
    test('omits the fields that are absent rather than writing nulls', () {
      final json = const InfluencerContact(
        method: ContactMethod.email,
        value: 'a@b.com',
      ).toJson();

      expect(json, {'method': 'email', 'value': 'a@b.com'});
    });

    test('round-trips through fromJson', () {
      const original = InfluencerContact(
        method: ContactMethod.telegram,
        value: '@handle',
        label: 'agency',
        isPrimary: true,
      );
      final restored = InfluencerContact.fromJson(original.toJson())!;

      expect(restored.method, original.method);
      expect(restored.value, original.value);
      expect(restored.label, original.label);
      expect(restored.isPrimary, original.isPrimary);
    });
  });
}
