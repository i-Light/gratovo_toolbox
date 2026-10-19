import 'package:flutter_test/flutter_test.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_label.dart';

/// The stage tag a sent outreach email is filed under.
///
/// The rule this suite pins is the blend: neither the channel's funnel stage
/// nor the thread's own status is right on its own at the moment a message
/// goes out, so the tag reconciles them.

void main() {
  group('outreachStageTag', () {
    test('a first cold email is Contacted, not New', () {
      // The send is what advances the funnel off `new`; filing it as "New"
      // would be wrong the instant it were true.
      expect(
        outreachStageTag(
          pipelineStage: PipelineStage.isNew,
          threadStatus: ThreadStatus.notContactedYet,
        ),
        'Contacted',
      );
    });

    test('a reply promotes a lagging funnel to Interested', () {
      expect(
        outreachStageTag(
          pipelineStage: PipelineStage.contacted,
          threadStatus: ThreadStatus.replied,
        ),
        'Interested',
      );
    });

    test('a reply does not pull a funnel that is already further along back',
        () {
      expect(
        outreachStageTag(
          pipelineStage: PipelineStage.negotiating,
          threadStatus: ThreadStatus.replied,
        ),
        'Negotiating',
      );
    });

    test('an un-replied thread keeps the funnel stage as-is', () {
      expect(
        outreachStageTag(
          pipelineStage: PipelineStage.roster,
          threadStatus: ThreadStatus.awaitingReply,
        ),
        'Roster',
      );
    });

    test('multi-word stages read as label text', () {
      expect(
        outreachStageTag(
          pipelineStage: PipelineStage.awaitingDelivery,
          threadStatus: ThreadStatus.needsFollowUp,
        ),
        'Awaiting Delivery',
      );
    });
  });

  group('outreachInfluencerLabels', () {
    test('is the audience segment then the stage segment', () {
      expect(
        outreachInfluencerLabels(
          pipelineStage: PipelineStage.interested,
          threadStatus: ThreadStatus.replied,
        ),
        ['Influencers', 'Stage/Interested'],
      );
    });
  });
}
