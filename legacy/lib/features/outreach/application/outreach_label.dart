/// The Gmail sub-labels an outbound outreach email is filed under, relative to
/// the mailbox's configured parent label (`cfg.outreach_label` on the Python
/// side, e.g. "Gratovo Outreach").
///
/// Two axes, both asked for so "what has the pipeline sent, to whom, and where
/// was the relationship" is a Gmail search rather than a memory exercise:
///
///  * **audience** — who the message went to. Only influencer/channel outreach
///    has a mailbox send path today, so this is always [_audienceInfluencers]
///    for now; it is a named constant rather than a literal so the brand path
///    has one obvious place to add `Brands`.
///  * **stage** — how far the relationship had got. See [outreachStageTag].
///
/// Deliberately English and hard-coded, not localized: a Gmail label that
/// renamed itself when somebody switched the app to Arabic would split one
/// stream of mail across two labels.
library;

import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';

/// The audience segment for a channel/influencer send.
const _audienceInfluencers = 'Influencers';

/// The label paths (relative to the parent) for one influencer send: the
/// audience segment and the stage segment, in that order.
///
/// The Python side prepends the configured parent label to each, so
/// `['Influencers', 'Stage/Contacted']` becomes `Gratovo Outreach/Influencers`
/// and `Gratovo Outreach/Stage/Contacted` alongside the bare parent.
List<String> outreachInfluencerLabels({
  required PipelineStage pipelineStage,
  required ThreadStatus threadStatus,
}) {
  return [
    _audienceInfluencers,
    'Stage/${outreachStageTag(
      pipelineStage: pipelineStage,
      threadStatus: threadStatus,
    )}',
  ];
}

/// The stage a sent email is filed under — a blend of the channel's funnel
/// position and the thread's own state, because neither alone is right at the
/// moment a message goes out:
///
///  * On the **first** email the funnel stage is still `new` — the send is what
///    advances it (see `_recordOutbound` in outreach_compose_controller.dart).
///    Filing a cold email as "New" would be wrong the instant it were true, so
///    `new` is reported as `Contacted`.
///  * A channel nobody has dragged forward can sit at `contacted` long after
///    the creator answered. A reply is exactly the signal that normally moves
///    it to `interested`, so a `replied` thread whose funnel has not caught up
///    is reported as `Interested`.
///  * Otherwise the funnel stage is the honest answer and is used as-is.
String outreachStageTag({
  required PipelineStage pipelineStage,
  required ThreadStatus threadStatus,
}) {
  var stage = pipelineStage;
  if (stage == PipelineStage.isNew) {
    stage = PipelineStage.contacted;
  }
  if (threadStatus == ThreadStatus.replied &&
      stage.index < PipelineStage.interested.index) {
    stage = PipelineStage.interested;
  }
  return _stageLabel(stage);
}

String _stageLabel(PipelineStage stage) => switch (stage) {
      PipelineStage.isNew => 'New',
      PipelineStage.contacted => 'Contacted',
      PipelineStage.interested => 'Interested',
      PipelineStage.roster => 'Roster',
      PipelineStage.negotiating => 'Negotiating',
      PipelineStage.contract => 'Contract',
      PipelineStage.awaitingDelivery => 'Awaiting Delivery',
      PipelineStage.paid => 'Paid',
      PipelineStage.lost => 'Lost',
    };
