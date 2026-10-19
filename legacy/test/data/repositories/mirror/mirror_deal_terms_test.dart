// Deals started from the app (fix #6) with their terms editable and two
// contracts in the course's order: the brand's contract is the template, the
// creator signs first, the brand after (decision contract-order).
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/repositories/deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mirror/mirror_deal_repository.dart';
import 'package:gratovo_toolbox/data/repositories/mock/mock_deal_repository.dart';

import 'memory_mirror.dart';

Deal _draft() => Deal(
      id: '',
      brandId: 'b1',
      influencerId: 'UC_x',
      stage: DealStage.proposed,
      brandPrice: 3000,
      influencerPayout: 2000,
      createdAt: DateTime.utc(2026, 10, 18),
      updatedAt: DateTime.utc(2026, 10, 18),
    );

void main() {
  for (final (name, make) in [
    ('mirror', () => MirrorDealRepository(MemoryMirror())),
    ('mock', MockDealRepository.new),
  ]) {
    group(name, () {
      late DealRepository repo;
      setUp(() => repo = make());

      test('a started deal gets an id and reads back', () async {
        final deal = await repo.create(_draft());
        expect(deal.id, isNotEmpty);
        final read = (await repo.getById(deal.id))!;
        expect(read.brandPrice, 3000);
        expect(read.paymentTerms, isNull, reason: 'no default, set per deal');
        expect(read.creatorContract.status, ContractStatus.none);
        expect(read.brandContract.status, ContractStatus.none);
      });

      test('terms are edited as one unit', () async {
        final deal = await repo.create(_draft());

        await repo.updateTerms(
          deal.id,
          DealTerms(
            brandPrice: 3500,
            influencerPayout: 2200,
            currency: 'USD',
            deliverables: 'One 60-90s integration',
            deadline: DateTime.utc(2026, 11, 20),
            paymentTerms: '50% upfront, 50% on publish',
            trackingLink: 'https://brand.example/?ref=x',
          ),
        );

        final read = (await repo.getById(deal.id))!;
        expect(read.brandPrice, 3500);
        expect(read.influencerPayout, 2200);
        expect(read.paymentTerms, '50% upfront, 50% on publish');
        expect(read.trackingLink, 'https://brand.example/?ref=x');
        expect(read.deadline, DateTime.utc(2026, 11, 20));
      });

      test('each contract is recorded on its own side', () async {
        final deal = await repo.create(_draft());

        await repo.updateContract(
          deal.id,
          ContractParty.creator,
          const DealContract(
              url: 'https://docs.example/c', status: ContractStatus.sent),
        );

        final read = (await repo.getById(deal.id))!;
        expect(read.creatorContract.url, 'https://docs.example/c');
        expect(read.creatorContract.status, ContractStatus.sent);
        expect(read.brandContract.status, ContractStatus.none);
      });
    });
  }

  test('the creator signs first, then the brand (contract-order)', () {
    final unsigned = _draft();
    final creatorSigned = unsigned.copyWithContracts(
      creator: DealContract(
          status: ContractStatus.signed, signedAt: DateTime.utc(2026, 10, 20)),
    );
    expect(canMarkBrandSigned(unsigned), isFalse);
    expect(canMarkBrandSigned(creatorSigned), isTrue);
  });

  test('the server receives the contract and term columns', () async {
    final db = MemoryMirror();
    final repo = MirrorDealRepository(db);
    final deal = await repo.create(_draft());
    await repo.updateContract(
      deal.id,
      ContractParty.brand,
      DealContract(
          status: ContractStatus.signed, signedAt: DateTime.utc(2026, 10, 25)),
    );

    final queued = await db.getAll(
        "SELECT payload FROM _outbox WHERE kind = 'row.upsert' ORDER BY seq");
    final row =
        (jsonDecode(queued.last['payload']! as String) as Map)['row'] as Map;
    expect(row['brand_contract_status'], 'signed');
    expect(row['brand_signed_at'], startsWith('2026-10-25'));
    expect(row['creator_contract_status'], 'none');
    expect(row['channel_id'], 'UC_x');
  });
}
