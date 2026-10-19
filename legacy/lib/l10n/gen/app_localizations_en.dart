// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Gratovo IMA ToolBox';

  @override
  String get navDashboard => 'Home';

  @override
  String get navSearch => 'Search';

  @override
  String get navRoster => 'Roster';

  @override
  String get navInfluencers => 'Influencers';

  @override
  String get navBrands => 'Brands';

  @override
  String get navDeals => 'Deals';

  @override
  String get navOutreach => 'Outreach';

  @override
  String get navSettings => 'Settings';

  @override
  String get navNews => 'News';

  @override
  String get newsTitle => 'Industry news';

  @override
  String get newsAllSources => 'All sources';

  @override
  String get newsAllNiches => 'All niches';

  @override
  String get newsEmpty =>
      'Nothing stored yet. Run `python tools/news.py --refresh` on the machine that runs the pipeline to fetch the feeds.';

  @override
  String get newsNoMatches => 'No stories from this source yet.';

  @override
  String get newsOpenArticle => 'Read the article';

  @override
  String get newsUndated => 'No date';

  @override
  String newsBySource(String value) {
    return '$value';
  }

  @override
  String get newsRefresh => 'Fetch feeds now';

  @override
  String get newsRefreshStarted => 'Fetching feeds…';

  @override
  String get newsRefreshFinished => 'Feeds updated.';

  @override
  String get newsRefreshFailed => 'Couldn\'t fetch the feeds.';

  @override
  String get newsRefreshDesktopOnly =>
      'Feeds are fetched by the pipeline machine. A browser is not allowed to read them directly, which is why the stories are stored rather than loaded live.';

  @override
  String get newsSourcesTitle => 'Feeds';

  @override
  String get newsSourceFailing => 'This feed failed on its last fetch';

  @override
  String get newsSourceDisabled => 'Not being fetched';

  @override
  String newsSourceLastFetched(String date) {
    return 'Fetched $date';
  }

  @override
  String get newsSourceNeverFetched => 'Never fetched';

  @override
  String get newsAddSourceTitle => 'Add a feed';

  @override
  String get newsAddSourceUrl => 'Feed URL';

  @override
  String get newsAddSourceUrlHint => 'https://example.com/feed/';

  @override
  String get newsAddSourceUrlInvalid => 'That is not a valid http(s) URL.';

  @override
  String get newsAddSourceNiche => 'Niche (optional)';

  @override
  String get newsAddSourceTitleField => 'Name (optional)';

  @override
  String get newsAddSourceTitleHelp =>
      'Left blank, the feed names itself on the first successful fetch.';

  @override
  String get newsAddSourceSubmit => 'Add feed';

  @override
  String get newsAddSourceAdded => 'Feed added. Fetch to pull its stories in.';

  @override
  String get newsAddSourceFailed => 'Couldn\'t add that feed.';

  @override
  String get newsRemoveSource => 'Remove feed';

  @override
  String get newsRemoveSourceConfirm =>
      'Remove this feed and every story it produced? The stories cannot be recovered without fetching again.';

  @override
  String get newsSourceEnable => 'Fetch this feed';

  @override
  String get newsSourceDisable => 'Stop fetching this feed';

  @override
  String get newsSinceLastFetch => 'New stories since the last fetch';

  @override
  String get newsClearAll => 'Clear stored stories';

  @override
  String get newsClearAllConfirm =>
      'Delete every stored story? The feeds stay put and the next fetch pulls them all back in. This is here to test the new-stories badge.';

  @override
  String get newsClearAllDone => 'Stored stories cleared.';

  @override
  String get newsClearAllFailed => 'Couldn\'t clear the stored stories.';

  @override
  String get dashboardWelcomeTitle => 'Welcome back';

  @override
  String get dashboardWelcomeUser => 'Welcome back, ';

  @override
  String get dashboardWelcomeBody =>
      'Here\'s where the pipeline stands right now — new finds, active negotiations, upcoming outreach, and what the team is working on.';

  @override
  String comingSoonTitle(String pageName) {
    return '$pageName is coming soon';
  }

  @override
  String get comingSoonBody =>
      'This page is scaffolded and routable, but its real content is built in a later phase of the rebuild.';

  @override
  String get desktopOnlyNotice =>
      'This is only available on the desktop app, where the sourcing pipeline runs.';

  @override
  String get themeModeLight => 'Light';

  @override
  String get themeModeDark => 'Dark';

  @override
  String get themeModeSystem => 'System';

  @override
  String get languageEnglish => 'English';

  @override
  String get languageArabic => 'Arabic';

  @override
  String get commonError => 'Something went wrong.';

  @override
  String get commonRetry => 'Retry';

  @override
  String get dashboardNewFinds => 'New finds';

  @override
  String get dashboardActiveNegotiations => 'Active negotiations';

  @override
  String get dashboardEmailsSentToday => 'Emails sent today';

  @override
  String get dashboardDraftedToday => 'Drafted today';

  @override
  String dashboardOfTarget(String count, String target) {
    return '$count of $target';
  }

  @override
  String get dashboardRosterReady => 'Roster ready to pitch';

  @override
  String get dashboardUpcomingRemindersTitle => 'Upcoming reminders';

  @override
  String get dashboardNoReminders =>
      'No reminders due — you\'re all caught up.';

  @override
  String dashboardReminderDue(String date) {
    return 'Due $date';
  }

  @override
  String dashboardNewsNewCount(int count) {
    return '$count new';
  }

  @override
  String dashboardArchiveDueCount(String count) {
    return '+$count archive due';
  }

  @override
  String get dashboardNewsPeekEmpty => 'No news yet';

  @override
  String get dashboardLogsPeekEmpty => 'No activity yet';

  @override
  String get vettingStatusNewlyFound => 'New';

  @override
  String get vettingStatusShortlisted => 'Shortlisted';

  @override
  String get vettingStatusRejected => 'Rejected';

  @override
  String get dealStageProposed => 'Proposed';

  @override
  String get dealStageNegotiating => 'Negotiating';

  @override
  String get dealStageAgreed => 'Agreed';

  @override
  String get dealStageContractSent => 'Contract sent';

  @override
  String get dealStageSigned => 'Signed';

  @override
  String get dealStageLive => 'Live';

  @override
  String get dealStageClosed => 'Closed';

  @override
  String get dealStageLost => 'Lost';

  @override
  String get influencerListEmpty =>
      'No influencers yet — run a search to find some.';

  @override
  String get influencerListFilterAll => 'All';

  @override
  String get influencerListSortLabel => 'Sort by';

  @override
  String get influencerListSortSubscribers => 'Subscribers';

  @override
  String get influencerListSortRecentActivity => 'Recent activity';

  @override
  String get influencerListSortAverageViews => 'Median views (30d)';

  @override
  String influencerSubscribersCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString subscribers';
  }

  @override
  String influencerFoundVia(String keywords) {
    return 'Found via: $keywords';
  }

  @override
  String get influencerNotFound => 'Influencer not found.';

  @override
  String get influencerProfileSubscribers => 'Subscribers';

  @override
  String get influencerProfileMedianViews30 => 'Median views · 30 days';

  @override
  String get influencerProfileMedianViewsAll => 'Median views · all stored';

  @override
  String get influencerProfileCountry => 'Country';

  @override
  String get influencerProfileLastVideo => 'Last video';

  @override
  String get influencerProfileVettingLabel => 'Vetting status';

  @override
  String get influencerProfileRecentVideosTitle => 'Recent videos';

  @override
  String get influencerProfileRefreshVideos => 'Refresh';

  @override
  String get influencerProfileRefreshStarted => 'Refreshing recent videos…';

  @override
  String get influencerProfileRefreshFailed =>
      'Couldn\'t refresh this channel\'s videos.';

  @override
  String get influencerProfileNoVideos => 'No recent videos yet.';

  @override
  String get influencerProfileDetailsSyncing =>
      'Details syncing — this channel was found on a teammate\'s machine and its videos have not reached this one yet.';

  @override
  String get influencerDetailsSyncingShort => 'details syncing…';

  @override
  String get dashboardSearchingTitle => 'Searching now';

  @override
  String dashboardSearchingLine(String name, String keyword, int count) {
    return '$name · $keyword · $count found';
  }

  @override
  String dashboardSearchingBlockedLine(
      String name, String reason, int seconds) {
    return '$name · $reason — retrying in ${seconds}s';
  }

  @override
  String get searchBackoffReasonRateLimited => 'IP refused / rate-limited';

  @override
  String get searchBackoffReasonCaptcha => 'blocked by a CAPTCHA check';

  @override
  String get influencerProfileRelevanceCriteriaTitle =>
      'What I\'m looking for in this channel\'s videos';

  @override
  String get influencerProfileRelevanceCriteriaHint =>
      'e.g. sponsorship mentions, upload frequency';

  @override
  String get influencerProfileAddCriterion => 'Add';

  @override
  String get influencerProfileNotesTitle => 'Notes';

  @override
  String get influencerProfileNotesHint =>
      'Notes for future deals with this channel';

  @override
  String get influencerProfileSaveNotes => 'Save notes';

  @override
  String get influencerProfileNotesSaved => 'Notes saved.';

  @override
  String get influencerProfileDealHistoryTitle => 'Deal history';

  @override
  String get influencerProfileNoDeals => 'No deals yet with this influencer.';

  @override
  String get influencerProfileOpenChannel => 'Open channel';

  @override
  String influencerProfileLastUpdated(String date) {
    return 'Channel data updated $date';
  }

  @override
  String get influencerProfileNeverUpdated => 'Never refreshed';

  @override
  String get influencerProfileVideosThisMonth => 'Videos this month';

  @override
  String get influencerProfileStageTitle => 'Progress and tags';

  @override
  String get influencerProfileStageLabel => 'Pipeline stage';

  @override
  String get influencerProfileChannelTagsLabel => 'Channel tags';

  @override
  String get influencerProfileAddTagHint => 'e.g. tech, fitness';

  @override
  String get influencerProfileSaveFailed => 'Couldn\'t save that change.';

  @override
  String get influencerProfilePullMonths => 'Months to cover';

  @override
  String get influencerProfilePullMore => 'Pull more';

  @override
  String get influencerProfilePullStarted =>
      'Backfill started — see the Search page for progress.';

  @override
  String get influencerProfilePullAlreadyRunning =>
      'A backfill is already running — wait for it to finish, then try again.';

  @override
  String get influencerProfilePullSearchRunning =>
      'A search is running — wait for it to finish, then try again.';

  @override
  String get influencerProfilePullFailed => 'Couldn\'t start the backfill.';

  @override
  String get influencerProfileCrmTitle => 'What a video is worth';

  @override
  String get influencerProfileCrmBasis => 'Basis';

  @override
  String influencerProfileCrmIncluded(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString videos included';
  }

  @override
  String influencerProfileCrmUnusable(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString have no view count and can\'t be used';
  }

  @override
  String get influencerProfileCrmSelectAll => 'Select all';

  @override
  String get influencerProfileCrmSelectNone => 'Select none';

  @override
  String get influencerProfileCrmMedian => 'Median views';

  @override
  String get influencerProfileCrmAverage => 'Average views';

  @override
  String get influencerProfileCrmRange => 'Range';

  @override
  String get influencerProfileCrmUploadRate => 'Uploads / month';

  @override
  String get influencerProfileCrmSkewWarning =>
      'The average is well above the median — one or two videos are carrying it. Quote from the median.';

  @override
  String get influencerProfileCrmPrice => 'Price';

  @override
  String get influencerProfileCrmCpm => 'CPM';

  @override
  String get cpmNicheLabel => 'Niche (CPM range)';

  @override
  String cpmNicheLine(String niche, String low, String high, String lowPrice,
      String highPrice) {
    return '$niche: \$$low-$high CPM, so \$$lowPrice-$highPrice for this channel';
  }

  @override
  String get cpmSliderHelp =>
      'Slide to try a CPM within the range; the price follows.';

  @override
  String get cpmNicheTech => 'Tech';

  @override
  String get cpmNicheFinance => 'Finance';

  @override
  String get cpmNicheFitness => 'Fitness';

  @override
  String get cpmNicheEntertainment => 'Entertainment';

  @override
  String get cpmNicheGaming => 'Gaming';

  @override
  String get cpmNicheBeauty => 'Beauty';

  @override
  String get cpmNicheTravel => 'Travel';

  @override
  String get cpmNicheEducation => 'Education';

  @override
  String get cpmNicheFood => 'Food';

  @override
  String get cpmNicheLuxury => 'Luxury';

  @override
  String get brandNew => 'New brand';

  @override
  String get brandEdit => 'Edit brand';

  @override
  String get brandFormName => 'Brand name';

  @override
  String get brandFormNameRequired => 'A brand needs a name.';

  @override
  String get brandFormWebsite => 'Website';

  @override
  String get brandFormCategory => 'What they sell';

  @override
  String get brandFormCountry => 'Country (two letters)';

  @override
  String get brandFormCountryInvalid => 'Two letters, like US.';

  @override
  String get brandFormBudget => 'Budget';

  @override
  String get brandFormCurrency => 'Currency';

  @override
  String get brandFormContacts => 'Contacts';

  @override
  String get brandFormContactName => 'Name';

  @override
  String get brandFormContactEmail => 'Email';

  @override
  String get brandFormContactRole => 'Role';

  @override
  String get brandFormContactPrimary => 'Write to this one first';

  @override
  String get brandFormAddContact => 'Add a contact';

  @override
  String get brandFormRemoveContact => 'Remove';

  @override
  String get brandFormEmailInvalid => 'Not an email address.';

  @override
  String get brandFormBrief => 'Campaign brief';

  @override
  String get brandSaved => 'Brand saved.';

  @override
  String brandBoycottCountry(String country) {
    return 'Boycotted country ($country): no pitch and no creator for this brand.';
  }

  @override
  String brandBoycottBrand(String brand) {
    return 'On the boycott list ($brand): no pitch and no creator for this brand.';
  }

  @override
  String get brandSourceSeen => 'Found sponsoring creators';

  @override
  String get brandSourceLabel => 'How we found them';

  @override
  String get seenBrandsTitle => 'Brands seen sponsoring';

  @override
  String get seenBrandsSubtitle =>
      'Brands found in the sponsorship lines of creators\' videos. One click makes a brand record.';

  @override
  String seenBrandsSummary(int brands, int channels) {
    String _temp0 = intl.Intl.pluralLogic(
      brands,
      locale: localeName,
      other: '$brands brands seen',
      one: '1 brand seen',
    );
    String _temp1 = intl.Intl.pluralLogic(
      channels,
      locale: localeName,
      other: '$channels channels',
      one: '1 channel',
    );
    return '$_temp0 across $_temp1';
  }

  @override
  String get seenBrandsEmpty =>
      'No sponsorships found in the stored videos yet.';

  @override
  String seenBrandsChannels(int count, String handles) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels',
      one: '1 channel',
    );
    return '$_temp0: $handles';
  }

  @override
  String seenBrandsLatest(String date) {
    return 'Latest upload among them: $date';
  }

  @override
  String get seenBrandsSaved => 'Saved';

  @override
  String get seenBrandsCreate => 'Create brand';

  @override
  String seenBrandsShowAll(int count) {
    return 'Show all $count';
  }

  @override
  String get seenBrandsShowFewer => 'Show fewer';

  @override
  String get dealStart => 'Start deal';

  @override
  String dealStartTitle(String handle) {
    return 'Start a deal with $handle';
  }

  @override
  String get dealStarted => 'Deal started.';

  @override
  String get dealFormBrand => 'Brand';

  @override
  String get dealFormBrandRequired => 'Pick a brand.';

  @override
  String get dealFormBrandPrice => 'Brand pays';

  @override
  String get dealFormPayout => 'Creator receives';

  @override
  String get dealFormCurrency => 'Currency';

  @override
  String get dealFormDeliverables => 'Deliverables';

  @override
  String get dealFormDeadline => 'Deadline';

  @override
  String get dealFormPickDate => 'Pick a date';

  @override
  String get dealFormPaymentTerms => 'Payment terms';

  @override
  String get dealFormPaymentTermsHint =>
      'Set per deal, e.g. 50% upfront, 50% on publish';

  @override
  String get dealFormTrackingLink => 'Tracking link';

  @override
  String get dealFormNumberRequired => 'Enter an amount.';

  @override
  String get dealEditTerms => 'Edit terms';

  @override
  String get dealTermsSaved => 'Terms saved.';

  @override
  String dealPaymentTermsLine(String terms) {
    return 'Payment terms: $terms';
  }

  @override
  String get dealPaymentTermsNone => 'Payment terms not set yet';

  @override
  String dealTrackingLinkLine(String link) {
    return 'Tracking link: $link';
  }

  @override
  String get dealContractsTitle => 'Contracts';

  @override
  String get dealContractCreator => 'Creator\'s contract';

  @override
  String get dealContractBrand => 'Brand\'s contract';

  @override
  String get dealContractOrderNote =>
      'The brand\'s contract is the template. The creator signs first, then the brand.';

  @override
  String get contractStatusNone => 'Not started';

  @override
  String get contractStatusDraft => 'Draft';

  @override
  String get contractStatusSent => 'Sent';

  @override
  String get contractStatusSigned => 'Signed';

  @override
  String dealContractSignedOn(String date) {
    return 'Signed $date';
  }

  @override
  String get dealContractUpdate => 'Update';

  @override
  String get dealContractUrl => 'Contract link';

  @override
  String get dealContractStatus => 'Status';

  @override
  String get dealContractBrandWaits => 'The brand signs after the creator.';

  @override
  String get dealContractSaved => 'Contract saved.';

  @override
  String get navComms => 'Comms queue';

  @override
  String commsToday(int sent, int target) {
    return '$sent of $target today';
  }

  @override
  String commsMailboxLeft(int left) {
    return '$left left in the mailbox today';
  }

  @override
  String get commsSectionReplies => 'New replies';

  @override
  String get commsSectionFollowUps => 'Follow-ups due';

  @override
  String get commsSectionDecisions => 'Decisions';

  @override
  String get commsSectionNewOutreach => 'New outreach';

  @override
  String get commsSectionEmpty => 'Nothing here right now.';

  @override
  String get commsDraft => 'Draft';

  @override
  String get commsDrafting => 'Drafting with Gemini. This takes a few minutes.';

  @override
  String commsDraftFailed(String error) {
    return 'The draft did not come back: $error';
  }

  @override
  String commsFollowUpNumber(int number) {
    return 'Follow-up $number of 3';
  }

  @override
  String get commsKindFirst => 'First email';

  @override
  String get commsKindReply => 'Reply';

  @override
  String get commsKindFollowUp => 'Follow-up';

  @override
  String get commsKindDecision => 'Decision';

  @override
  String get commsNeedsYou => 'Needs you';

  @override
  String get commsBlocked => 'Not sendable';

  @override
  String get commsLessons => 'Lessons used';

  @override
  String get commsSubject => 'Subject';

  @override
  String get commsBody => 'Message';

  @override
  String get commsSend => 'Send';

  @override
  String get commsEdit => 'Edit';

  @override
  String get commsDoneEditing => 'Done';

  @override
  String get commsRedo => 'Redo';

  @override
  String get commsSkip => 'Skip';

  @override
  String get commsSent => 'Sent.';

  @override
  String commsTo(String address) {
    return 'To: $address';
  }

  @override
  String get commsRecipientUnconfirmed =>
      'This address was found on their channel and has not been confirmed by anyone. Check it, or add the right one to their contacts, before sending.';

  @override
  String get commsSkipped => 'Skipped.';

  @override
  String get commsNoRecipient =>
      'No email address for them yet. Add one in their contacts first.';

  @override
  String commsSendError(String error) {
    return 'It did not send: $error';
  }

  @override
  String commsSentNotRecorded(String error) {
    return 'Sent, but it could not be added to the conversation: $error. It will not be offered again; add it to the thread by hand.';
  }

  @override
  String get commsCheckFailed =>
      'The text failed the checks. Nothing was sent.';

  @override
  String get commsGatesTitle => 'Confirm before it goes';

  @override
  String get commsGatesBody => 'This message needs a person\'s yes on:';

  @override
  String get commsConfirmSend => 'Confirm and send';

  @override
  String get commsNothingToSend => 'The engine says nothing needs sending now.';

  @override
  String get commsSteerTitle => 'Steer and redo';

  @override
  String get commsSteerHelp =>
      'Optional corrections to what the engine read. Leave anything that is right as it is.';

  @override
  String get commsSteerAsRead => 'As read';

  @override
  String get commsSteerNote => 'Anything else the engine should know';

  @override
  String get commsSteerMore => 'More';

  @override
  String get commsSteerCash => 'Allow a straight cash offer for this case only';

  @override
  String get commsSteerCashHelp =>
      'House choice HC-10: off by default; a person may switch it on for one case.';

  @override
  String get steerReader => 'Who reads it';

  @override
  String steerReaderOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'creator': 'Creator',
        'manager': 'Creator\'s manager / agency',
        'brand': 'Brand',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerStage => 'What this message is';

  @override
  String steerStageOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'first': 'First email',
        'fu1': 'Follow-up 1',
        'fu2': 'Follow-up 2',
        'closing': 'Last follow-up (closing)',
        'reply': 'Answering their reply',
        'reengage': 'Re-engaging an old lead',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerChannel => 'Channel';

  @override
  String steerChannelOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'email': 'Email',
        'dm': 'Instagram DM',
        'linkedin': 'LinkedIn DM',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerHave => 'What I have';

  @override
  String steerHaveOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'nothing': 'Nothing yet',
        'roster': 'Creators on my roster',
        'brand': 'A brand in hand',
        'deal': 'A deal with a budget',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerInmind => 'Brands in mind';

  @override
  String steerInmindOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'none': 'None',
        'yes': 'Yes, brands that fit them',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerState => 'Their sponsors';

  @override
  String steerStateOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'unknown': 'Unknown',
        'unsponsored': 'No sponsors lately',
        'some': 'Some sponsors',
        'full': 'Every video sponsored',
        'own': 'Sells own product',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerPitch => 'What I\'m pitching';

  @override
  String steerPitchOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'one': 'One creator',
        'several': 'Several creators',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerProof => 'Closed deals / case studies';

  @override
  String steerProofOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'none': 'None yet',
        'some': 'I have some',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBtype => 'Brand type';

  @override
  String steerBtypeOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'active': 'Already runs influencer campaigns',
        'never': 'Never did influencer marketing',
        'b2b': 'B2B / SaaS / software',
        'apps': 'Apps / games',
        'ecom': 'E-commerce / DTC',
        'affiliate': 'Only does affiliate / gifting',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBsize => 'Brand size';

  @override
  String steerBsizeOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'small': 'Small (50 employees or fewer)',
        'big': 'Big',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerCreply => 'Their reply';

  @override
  String steerCreplyOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'interested': 'Interested',
        'which': 'Which brand? What are the details?',
        'kit': 'Sent media kit / analytics',
        'who': 'Who are you? Send your website',
        'budget': 'What\'s the budget?',
        'affiliate': 'Affiliate only / wants a flat fee',
        'gifting': 'Send me the product (gifting)',
        'manager': 'My manager handles this',
        'notint': 'Not interested',
        'silent': 'Replied, then went silent',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBreply => 'Their reply';

  @override
  String steerBreplyOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'creators': 'Send creators / who do you have?',
        'budget': 'States their budget or rates',
        'cases': 'Asks for case studies',
        'notnow': 'Not now / maybe next month',
        'ignored': 'Ignored my rate question',
        'kit': 'Asks for a media kit',
        'affiliate': 'We only do affiliate / gifting',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerEnglish => 'Their English';

  @override
  String steerEnglishOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'native': 'Native / fluent',
        'nonnative': 'Non-native',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get influencerProfileCrmCpmExplain =>
      'Cost per 1,000 views, from the median. Change either box.';

  @override
  String get influencerProfileCrmCut => 'Your cut %';

  @override
  String get influencerProfileCrmSplitYours => 'You earn';

  @override
  String get influencerProfileCrmSplitTheirs => 'They earn';

  @override
  String influencerProfileCrmSplitOf(String price, String percent) {
    return 'of $price at $percent%';
  }

  @override
  String get influencerProfileCrmSplitHint =>
      'Enter a price and your cut % below to see who earns what.';

  @override
  String get influencerProfileCrmEmpty =>
      'No usable videos yet. Every stored upload is missing its view count — run the enrichment tool, or pull more uploads above.';

  @override
  String get influencerProfileCrmNoViewCount => 'No view count';

  @override
  String get influencerProfileProvidedTitle => 'Data the influencer sent us';

  @override
  String get influencerProfileProvidedEmpty =>
      'Nothing recorded. Add what they sent — audience split, their own analytics — as name/value pairs.';

  @override
  String get influencerProfileProvidedKey => 'Field';

  @override
  String get influencerProfileProvidedValue => 'Value';

  @override
  String get influencerProfileProvidedAdd => 'Add field';

  @override
  String get influencerProfileProvidedUnverified =>
      'Reported by the influencer, not measured by us.';

  @override
  String get influencerProfileEmailsTitle => 'Email history';

  @override
  String get influencerProfileEmailsSource =>
      'Read-only here. The Emails page is where these are managed.';

  @override
  String get influencerProfileEmailsOpen => 'Open in Emails';

  @override
  String get influencerProfileNoEmails =>
      'No emails logged with this influencer yet.';

  @override
  String get influencerProfileEmailOutbound => 'Sent';

  @override
  String get influencerProfileEmailInbound => 'Received';

  @override
  String influencerProfileEmailEventSent(String date) {
    return 'Sent an email on $date';
  }

  @override
  String influencerProfileEmailEventFollowUp(String date) {
    return 'Sent a follow-up on $date';
  }

  @override
  String influencerProfileEmailEventReply(String date) {
    return 'Received a reply on $date';
  }

  @override
  String get influencerListSearchHint => 'Search name or handle';

  @override
  String get influencerListViewAsList => 'List view';

  @override
  String get influencerListViewAsCards => 'Card view';

  @override
  String get influencerListFilters => 'Filters';

  @override
  String get influencerListClearFilters => 'Clear filters';

  @override
  String get influencerListNoMatches => 'No channels match these filters.';

  @override
  String get influencerListLoadingMore => 'Loading more…';

  @override
  String get influencerListEndOfList => 'That\'s everyone.';

  @override
  String influencerListShowingCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString shown';
  }

  @override
  String get influencerFilterCountry => 'Country';

  @override
  String get influencerFilterChannelTag => 'Channel tag';

  @override
  String get influencerFilterInclude => 'Include';

  @override
  String get influencerFilterExclude => 'Exclude';

  @override
  String get influencerFilterStage => 'Stage';

  @override
  String get influencerFilterAny => 'Any';

  @override
  String get influencerFilterMinSubscribers => 'Min subscribers';

  @override
  String get influencerFilterMaxSubscribers => 'Max subscribers';

  @override
  String get influencerFilterMedianViews => 'Median views this month';

  @override
  String get influencerFilterDaysSinceDeal => 'Days since last deal';

  @override
  String get influencerFilterMin => 'Min';

  @override
  String get influencerFilterMax => 'Max';

  @override
  String get influencerFilterDealsOnlyNote =>
      'Only channels that have had a deal can match this.';

  @override
  String get influencerListSortVideosThisMonth => 'Videos this month';

  @override
  String get influencerListSortDaysSinceDeal => 'Time since last deal';

  @override
  String get influencerListSortDiscovered => 'Recently discovered';

  @override
  String influencerVideosThisMonth(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString videos this month';
  }

  @override
  String influencerAverageViewsShort(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString median views';
  }

  @override
  String get influencerNoUploadsThisMonth => 'No uploads this month';

  @override
  String get influencerCountryUnknown => 'Country unknown';

  @override
  String influencerTagContactAttempts(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString attempts';
  }

  @override
  String influencerTagDaysSinceDeal(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '${countString}d since deal';
  }

  @override
  String get influencerTagNeverContacted => 'Not contacted';

  @override
  String get pipelineStageNew => 'New';

  @override
  String get pipelineStageContacted => 'Contacted';

  @override
  String get pipelineStageInterested => 'Interested';

  @override
  String get pipelineStageRoster => 'Roster';

  @override
  String get pipelineStageNegotiating => 'Negotiating';

  @override
  String get pipelineStageContract => 'Contract';

  @override
  String get pipelineStageAwaitingDelivery => 'Awaiting delivery';

  @override
  String get pipelineStagePaid => 'Paid';

  @override
  String get pipelineStageLost => 'Lost';

  @override
  String get influencerAddTitle => 'Add a channel';

  @override
  String get influencerAddIntro =>
      'For a channel you found by hand that no keyword search has surfaced.';

  @override
  String get influencerAddHandle => 'Handle';

  @override
  String get influencerAddHandleHint => '@channelname';

  @override
  String get influencerAddHandleRequired => 'A handle is required.';

  @override
  String get influencerAddChannelId => 'YouTube channel ID (optional)';

  @override
  String get influencerAddChannelIdHelp =>
      'Starts with UC. Without it this entry cannot merge with the same channel when a search later finds it.';

  @override
  String get influencerAddName => 'Channel name (optional)';

  @override
  String get influencerAddUrl => 'Channel URL (optional)';

  @override
  String get influencerAddSubscribers => 'Subscribers (optional)';

  @override
  String get influencerAddCountry => 'Country (optional)';

  @override
  String get influencerAddNotes => 'Notes (optional)';

  @override
  String get influencerAddSubmit => 'Add channel';

  @override
  String get influencerAddSucceeded => 'Channel added.';

  @override
  String get influencerAddFailed => 'Couldn\'t add that channel.';

  @override
  String get searchKeywordsLabel => 'Keywords';

  @override
  String get searchKeywordsHint => 'One keyword per line';

  @override
  String searchKeywordsCount(String count) {
    return '$count keywords';
  }

  @override
  String searchKeywordsProgressCount(String done, String total) {
    return '$done/$total keywords';
  }

  @override
  String get searchKeywordsReopenTooltip => 'Run a finished keyword again';

  @override
  String searchKeywordsDoneCount(String count) {
    return '$count done';
  }

  @override
  String get searchKeywordsReopenAll => 'Redo all';

  @override
  String get searchKeywordsReopenTitle => 'Redo a finished keyword';

  @override
  String get searchKeywordsReopenHeader => 'Finished — pick one to run again';

  @override
  String get searchKeywordsStartAtTooltip => 'Start at a specific keyword';

  @override
  String get searchKeywordsStartAtTitle => 'Start at keyword #';

  @override
  String get searchKeywordsStartAtHint =>
      'Skips everything before it for this run only — it doesn\'t change which keywords are marked done.';

  @override
  String searchKeywordsStartAtLabel(String max) {
    return 'Keyword number (1–$max)';
  }

  @override
  String get searchKeywordsStartAtAction => 'Start here';

  @override
  String get searchProgressStarting => 'Starting the pipeline…';

  @override
  String get searchWarmupRunning =>
      'Getting the team\'s latest data — a search started now waits a few seconds for it.';

  @override
  String get searchWarmupReady => 'Team data is up to date.';

  @override
  String searchWarmupReadyAge(int minutes) {
    return 'Team data updated $minutes min ago.';
  }

  @override
  String get searchWarmupStale =>
      'Team data refreshes in the background, before you search.';

  @override
  String get searchWarmupFailed =>
      'Couldn\'t refresh the team\'s data — the search will fetch it itself.';

  @override
  String get searchWarmupRefresh => 'Refresh now';

  @override
  String searchProgressOnKeyword(int index, int total, String keyword) {
    return 'Keyword $index of $total — $keyword';
  }

  @override
  String searchProgressCompleted(int channelsFound) {
    return 'Run complete — $channelsFound channels found';
  }

  @override
  String searchProgressStopped(int done) {
    return 'Stopped after $done keyword(s) — everything found is saved';
  }

  @override
  String get searchProgressFailed =>
      'The run ended unexpectedly. Check the log below.';

  @override
  String searchProgressChannels(String count) {
    return '$count channels';
  }

  @override
  String searchProgressVideos(String count) {
    return '$count videos';
  }

  @override
  String searchBackoffWaiting(String seconds) {
    return 'Waiting ${seconds}s before retrying...';
  }

  @override
  String get searchTryAgainNow => 'Try again now';

  @override
  String get searchRouteDirectOnly =>
      'No AWS or proxies: every request goes out from this computer';

  @override
  String searchRouteAwsInUse(String count) {
    return 'AWS in use · $count requests';
  }

  @override
  String get searchRouteAwsIdle => 'AWS ready · not used yet';

  @override
  String searchRouteProxiesInUse(String count) {
    return 'Proxies in use · $count requests';
  }

  @override
  String get searchRouteProxiesIdle => 'Proxies ready · not used yet';

  @override
  String searchRouteThisMachine(String count) {
    return 'This computer · $count requests';
  }

  @override
  String searchRouteParallel(int workers) {
    return '$workers keywords at a time · Normal speed';
  }

  @override
  String get searchRouteOneAtATimeFast => 'One keyword at a time · Fast speed';

  @override
  String get searchRouteOneAtATimeNormal =>
      'One keyword at a time · Normal speed';

  @override
  String searchRouteLast(String label) {
    return 'Last request through $label';
  }

  @override
  String searchAlsoRunning(String keywords) {
    return 'Also running: $keywords';
  }

  @override
  String get searchStopButton => 'Stop searching';

  @override
  String get searchStopRequested =>
      'Stopping — the run finishes its current step first.';

  @override
  String get searchResumeButton => 'Resume searching';

  @override
  String get searchStartFromTop => 'Start from the top';

  @override
  String get searchAllKeywordsDone =>
      'Every keyword in the list is already done. Start from the top to run them again.';

  @override
  String searchResumeNotice(int done, int total, String nextKeyword) {
    return '$done of $total done — Start resumes at “$nextKeyword”.';
  }

  @override
  String get searchSettingsTitle => 'Search settings';

  @override
  String get searchSortByLabel => 'Sort by';

  @override
  String get searchSortByRelevance => 'Relevance';

  @override
  String get searchSortByUploadDate => 'Upload date';

  @override
  String get searchSortByViewCount => 'View count';

  @override
  String get searchSortByRating => 'Rating';

  @override
  String get searchResultsTypeLabel => 'Results type';

  @override
  String get searchResultsTypeVideo => 'Videos';

  @override
  String get searchResultsTypeChannel => 'Channels';

  @override
  String get searchCountryLabel => 'Countries';

  @override
  String get searchCountryHint => 'e.g. US, EG — leave blank for any';

  @override
  String get searchCountryPickTitle => 'Target countries';

  @override
  String get searchCountryClearAll => 'Clear all';

  @override
  String get searchCountryEnglishMarkets => 'English markets';

  @override
  String get searchHandleLimitLabel => 'Handle limit';

  @override
  String get searchOverrideHint => 'Leave blank to use the shared default';

  @override
  String get searchStartButton => 'Start searching';

  @override
  String get searchNoKeywordsError => 'Add at least one keyword first.';

  @override
  String get searchStartedByThisDevice => 'This device';

  @override
  String get searchStarted =>
      'Search started — it\'s now running on this machine.';

  @override
  String searchStartFailed(String error) {
    return 'Couldn\'t start the search: $error';
  }

  @override
  String get searchUploadButtonLabel => 'Send keywords';

  @override
  String get searchUploadDialogTitle => 'Send keywords to a teammate';

  @override
  String searchUploadDialogTitleTo(String name) {
    return 'Send keywords to $name';
  }

  @override
  String get searchUploadKeywordsHint => 'One keyword per line';

  @override
  String get searchUploadRecipientSectionTitle => 'Send to';

  @override
  String get searchUploadOnlineLabel => 'Online';

  @override
  String get searchUploadOfflineLabel => 'Offline';

  @override
  String get searchUploadSendButton => 'Send';

  @override
  String get searchUploadNoTeammates => 'No other teammates yet.';

  @override
  String get searchUploadNoRecipientError =>
      'Choose who to send these keywords to.';

  @override
  String searchUploadSent(String name, int count) {
    return 'Sent $name $count keyword(s).';
  }

  @override
  String searchUploadSendFailed(String error) {
    return 'Couldn\'t send: $error';
  }

  @override
  String get searchProgressTitle => 'Progress';

  @override
  String get progressMaximizeTooltip => 'Maximize progress';

  @override
  String get progressRestoreTooltip => 'Restore';

  @override
  String get searchProgressEmpty => 'No search has been run yet.';

  @override
  String get backfillProgressTitle => 'Video backfill';

  @override
  String backfillProgressRunning(String handle) {
    return 'Pulling older uploads for @$handle';
  }

  @override
  String backfillProgressCompleted(int count, String handle) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count new videos added',
      one: '1 new video added',
      zero: 'No new videos found',
    );
    return '$_temp0 for @$handle';
  }

  @override
  String backfillProgressFailed(String handle) {
    return 'The backfill for @$handle ended unexpectedly. Check the log below.';
  }

  @override
  String get reenrichProgressTitle => 'Freed from the archive';

  @override
  String reenrichProgressRunning(String handle) {
    return 'Enriching $handle…';
  }

  @override
  String reenrichProgressCompleted(String handle) {
    return '$handle enriched — it is back in the Influencers list';
  }

  @override
  String reenrichProgressFailed(String handle) {
    return 'Enriching $handle ended unexpectedly. Check the log below.';
  }

  @override
  String get navBadgeRunning => 'Something is running in the background';

  @override
  String get navBadgeSuccess => 'Finished — open Search to see the result';

  @override
  String get navBadgeError => 'Something went wrong — open Search for details';

  @override
  String get commonAdd => 'Add';

  @override
  String get commonCopy => 'Copy';

  @override
  String get commonSave => 'Save';

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonDelete => 'Delete';

  @override
  String get commonCreate => 'Create';

  @override
  String get brandListEmpty => 'No brands yet.';

  @override
  String get brandNotFound => 'Brand not found.';

  @override
  String get brandProfileContactTitle => 'Contact';

  @override
  String get brandProfileContactPhone => 'Phone';

  @override
  String get brandProfileWebsite => 'Website';

  @override
  String get brandProfileBudget => 'Budget';

  @override
  String get brandProfileCampaignBrief => 'Campaign brief';

  @override
  String get brandProfilePreferredCriteriaTitle =>
      'Preferred influencer criteria';

  @override
  String get brandProfileNotesHint => 'Notes for future deals with this brand';

  @override
  String get brandProfileDealHistoryEmpty => 'No deals yet with this brand.';

  @override
  String get dealListEmpty => 'No deals yet.';

  @override
  String get dealNotFound => 'Deal not found.';

  @override
  String get dealDetailStageLabel => 'Stage';

  @override
  String get dealDetailPricingTitle => 'Pricing';

  @override
  String get dealDetailBrandPays => 'Brand pays';

  @override
  String get dealDetailInfluencerReceives => 'Influencer receives';

  @override
  String get dealDetailMargin => 'Agency margin';

  @override
  String get dealDetailDeliverablesTitle => 'Deliverables';

  @override
  String get dealDetailDeadlineLabel => 'Deadline';

  @override
  String get dealDetailNoDeadline => 'No deadline set';

  @override
  String get dealDetailContractTitle => 'Contract';

  @override
  String get dealDetailCopyContractLink => 'Copy link';

  @override
  String get dealDetailWorkingDaysLabel => 'Working days';

  @override
  String get dealDetailPartiesTitle => 'Parties';

  @override
  String get dealDetailBrandLabel => 'Brand';

  @override
  String get dealDetailInfluencerLabel => 'Influencer';

  @override
  String get dealDetailNotesHint => 'Notes about this specific deal round';

  @override
  String dealDetailCreatedAt(String date) {
    return 'Created $date';
  }

  @override
  String dealDetailUpdatedAt(String date) {
    return 'Last updated $date';
  }

  @override
  String get outreachTemplatesTitle => 'Template library';

  @override
  String get outreachAddTemplate => 'New template';

  @override
  String get outreachEditTemplateTitle => 'Edit template';

  @override
  String get outreachNewTemplateTitle => 'New template';

  @override
  String get outreachTemplateNameLabel => 'Name';

  @override
  String get outreachTemplateSubjectLabel => 'Subject';

  @override
  String get outreachTemplateBodyLabel => 'Body';

  @override
  String get outreachTemplateKindEmail => 'Email';

  @override
  String get outreachTemplateKindDm => 'DM';

  @override
  String get outreachTemplateTokenHint =>
      'Placeholders in double curly braces are filled from the influencer: handle, name, lastVideoTitle, lastVideoDate, subscriberCount, country';

  @override
  String get outreachThreadsTitle => 'Conversations';

  @override
  String get outreachThreadListEmpty => 'No outreach threads yet.';

  @override
  String get outreachSelectThreadHint =>
      'Select a conversation to see its history and draft a message.';

  @override
  String get outreachStatusNotContactedYet => 'Not contacted';

  @override
  String get outreachStatusAwaitingReply => 'Awaiting reply';

  @override
  String get outreachStatusReplied => 'Replied';

  @override
  String get outreachStatusNeedsFollowUp => 'Needs follow-up';

  @override
  String get outreachMessagesTitle => 'Messages';

  @override
  String get outreachNoMessages => 'No messages yet.';

  @override
  String get outreachComposeTitle => 'Draft a message';

  @override
  String outreachComposeWordCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count words',
      one: '1 word',
      zero: '0 words',
    );
    return '$_temp0';
  }

  @override
  String get outreachSelectTemplateLabel => 'Template';

  @override
  String get outreachNoTemplateOption => 'No template — write from scratch';

  @override
  String get outreachAiProviderLabel => 'AI provider';

  @override
  String get outreachGenerateDraft => 'Generate draft';

  @override
  String get outreachDraftGenerated => 'Draft generated.';

  @override
  String get outreachSubjectLabel => 'Subject';

  @override
  String get outreachBodyLabel => 'Body';

  @override
  String get outreachRecordSent => 'Record as sent';

  @override
  String get outreachMessageRecorded => 'Message recorded.';

  @override
  String get outreachMarkReplied => 'Mark as replied';

  @override
  String get outreachThreadMarkedReplied => 'Marked as replied.';

  @override
  String get outreachWritingRulesTitle => 'My writing rules';

  @override
  String get outreachWritingRulesHint =>
      'e.g. always mention we\'re a boutique agency, keep it under 120 words';

  @override
  String get outreachBackToList => 'Back to conversations';

  @override
  String outreachDraftGenerationFailed(String error) {
    return 'Couldn\'t generate a draft: $error';
  }

  @override
  String get settingsGeneralTitle => 'General';

  @override
  String get settingsLanguageLabel => 'Language';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsLanguageArabic => 'Arabic';

  @override
  String get settingsThemeLabel => 'Theme';

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsTimeZoneLabel => 'Display time zone';

  @override
  String get settingsTimeZoneSubtitle =>
      'Every date and time in the app is shown in this zone. Stored data always stays in UTC, so changing this is safe.';

  @override
  String settingsTimeZoneSystemDefault(String zone) {
    return 'Device default ($zone)';
  }

  @override
  String get settingsTimeZoneChange => 'Change zone';

  @override
  String settingsTimeZoneChangeButton(String zone) {
    return '$zone - Change zone';
  }

  @override
  String get settingsTimeZoneUseDevice => 'Use device default';

  @override
  String get settingsTimeZoneSearchHint => 'Search zones — e.g. Cairo';

  @override
  String get settingsTimeZoneNoMatches => 'No matching time zones.';

  @override
  String get settingsStartupTitle => 'Launch at startup';

  @override
  String get settingsStartupNoSupport => 'Not available on this platform.';

  @override
  String get settingsLaunchAtStartupLabel =>
      'Open automatically when you log in';

  @override
  String get settingsLaunchAtStartupOn =>
      'On: the app will open automatically next time you log in.';

  @override
  String get settingsLaunchAtStartupOff =>
      'Off: you\'ll need to open the app yourself.';

  @override
  String get settingsAlwaysOnTopTitle => 'Always on top';

  @override
  String get settingsAlwaysOnTopNoSupport => 'Not supported on this platform.';

  @override
  String get settingsAlwaysOnTopLabel => 'Keep window on top';

  @override
  String get settingsAlwaysOnTopOn => 'Currently on top of other windows.';

  @override
  String get settingsAlwaysOnTopOff => 'Not pinned above other windows.';

  @override
  String get settingsAiProvidersTitle => 'AI providers';

  @override
  String get settingsAiProvidersSubtitle =>
      'Register your own API key to draft outreach emails with a real AI model. The template-fill fallback always stays available and needs no key.';

  @override
  String get settingsAiProvidersEmpty =>
      'No AI providers registered yet — drafts fall back to template-fill only.';

  @override
  String settingsAiProviderSubtitle(String model, String maskedKey) {
    return '$model · key $maskedKey';
  }

  @override
  String get settingsAddAiProvider => 'Add provider';

  @override
  String get settingsNewAiProviderTitle => 'New AI provider';

  @override
  String get settingsEditAiProviderTitle => 'Edit AI provider';

  @override
  String get settingsAiProviderNameLabel => 'Name';

  @override
  String get settingsAiProviderKeyLabel => 'API key';

  @override
  String get settingsAiProviderModelLabel => 'Model';

  @override
  String get settingsAiProviderKeyHint =>
      'Stored encrypted on this device only — never synced or shared with the team.';

  @override
  String get settingsTeamSyncTitle => 'Team sync';

  @override
  String get settingsTeamSyncSubtitle =>
      'Connect to the team\'s shared PocketBase instance so brands, deals, and outreach sync across everyone\'s devices. Leave the URL blank to keep working locally on this device only.';

  @override
  String get settingsTeamSyncUrlLabel => 'PocketBase URL';

  @override
  String get settingsTeamSyncEmailLabel => 'Superuser email';

  @override
  String get settingsTeamSyncPasswordLabel => 'Superuser password';

  @override
  String get settingsTeamSyncHint =>
      'The whole team signs in with this same login — it isn\'t a personal account, so anyone can enter it here from any device.';

  @override
  String get settingsTeamSyncTestConnection => 'Test connection';

  @override
  String get settingsTeamSyncTestSuccess => 'Connected successfully.';

  @override
  String settingsTeamSyncTestFailure(String error) {
    return 'Connection failed: $error';
  }

  @override
  String get settingsTeamSyncEnterUrlFirst => 'Enter a PocketBase URL first.';

  @override
  String get settingsTeamSyncSaved => 'Team sync settings saved.';

  @override
  String get settingsTeamSyncStatusNotConfigured => 'Local-only';

  @override
  String get settingsTeamSyncStatusChecking => 'Checking…';

  @override
  String get settingsTeamSyncStatusConnected => 'Connected';

  @override
  String get settingsTeamSyncStatusFailed => 'Not connected';

  @override
  String get settingsPythonEnvironmentTitle => 'Python environment';

  @override
  String get settingsPythonEnvironmentSubtitle =>
      'How this machine launches the local search pipeline — per-device, not shared with the team.';

  @override
  String get settingsPythonExecutableLabel =>
      'Python executable (blank = the one shipped with the app)';

  @override
  String get settingsProjectRootOverrideLabel => 'Project root override';

  @override
  String get settingsProjectRootOverrideHint =>
      'Leave blank unless the pipeline lives in another folder';

  @override
  String get settingsPythonEnvironmentSaved =>
      'Python environment settings saved.';

  @override
  String get settingsSearchTuningTitle => 'Advanced Search Tuning';

  @override
  String get settingsSearchTuningSubtitle =>
      'Pacing, proxy, and threshold settings the scraper uses';

  @override
  String get settingsSearchTuningSaved => 'Search tuning settings saved.';

  @override
  String get settingsSearchTuningDesktopOnly =>
      'Search tuning only applies on the desktop machine that runs the scraper.';

  @override
  String get settingsThresholdsTitle => 'Thresholds';

  @override
  String get settingsMinimumSubscribersLabel => 'Minimum subscribers';

  @override
  String get settingsHandlesLimitLabel => 'Handles per search run';

  @override
  String get settingsRecentVideosMonthsLabel => 'Recent-video window (months)';

  @override
  String get settingsPacingTitle => 'Pacing';

  @override
  String get settingsPacingHint =>
      'Each delay is sampled randomly between its min and max on every request.';

  @override
  String get settingsPacingNormalTab => 'Normal';

  @override
  String get settingsPacingFastTab => 'Fast (rotated IP)';

  @override
  String get settingsPacingFastLockedHint =>
      'Only applied while proxy rotation or the AWS Gateway is on -- every request goes out under a different IP then, so these can run much faster without burning one address. Safe to edit now; the scraper won\'t use it until rotation is enabled.';

  @override
  String get settingsHumanScrollDelayLabel => 'Human scroll delay';

  @override
  String get settingsJitterDelayLabel => 'Jitter delay';

  @override
  String get settingsRecentVideosDelayLabel => 'Recent-videos fetch delay';

  @override
  String get settingsFastSubCountDelayLabel => 'Fast sub-count check delay';

  @override
  String get settingsFoundChannelsDelayLabel => 'Found-channels delay';

  @override
  String get settingsIpCooldownLabel => 'IP cooldown duration';

  @override
  String settingsIpCooldownChanceLabel(String percent) {
    return 'IP cooldown chance: $percent%';
  }

  @override
  String get settingsProxyTitle => 'Proxy';

  @override
  String get settingsProxyHostLabel => 'Host';

  @override
  String get settingsProxyPortLabel => 'Port';

  @override
  String get settingsProxyUsernameLabel => 'Username';

  @override
  String get settingsProxyPasswordLabel => 'Password';

  @override
  String get settingsProxyEnableRotationLabel => 'Enable proxy rotation';

  @override
  String get settingsProxyIncludeDirectLabel =>
      'Include this machine (no proxy)';

  @override
  String get settingsProxyIncludeDirectHint =>
      'Lets requests keep going out from this machine\'s own connection sometimes, not only through the proxies below.';

  @override
  String get settingsProxyLabelField => 'Label';

  @override
  String get settingsProxyEnabledLabel => 'Enabled';

  @override
  String get settingsProxyListEmpty => 'No proxies added yet.';

  @override
  String get settingsAddProxy => 'Add proxy';

  @override
  String get settingsNewProxyTitle => 'New proxy';

  @override
  String get settingsEditProxyTitle => 'Edit proxy';

  @override
  String get settingsAwsGatewayTitle => 'AWS Gateway IP rotation';

  @override
  String get settingsAwsGatewayHint =>
      'Routes requests through AWS API Gateway endpoints in different regions instead of a proxy list. Deployed and destroyed separately, with tools/aws_gateway_setup.py.';

  @override
  String get settingsAwsGatewayEmpty =>
      'No gateways deployed yet. Run \"python tools/aws_gateway_setup.py deploy\" on the machine that runs searches.';

  @override
  String get settingsAwsGatewayEnabledToast => 'AWS Gateway rotation enabled.';

  @override
  String get settingsAwsGatewayDisabledToast =>
      'AWS Gateway rotation disabled.';

  @override
  String get settingsParallelTitle => 'Parallel search';

  @override
  String get settingsParallelHint =>
      'Works several keywords at once, one per AWS gateway or proxy (never two on the same one), at the Normal speed. Off by default.';

  @override
  String get settingsParallelMaxWorkersLabel => 'Most keywords at once';

  @override
  String settingsParallelNeedsTwo(int count) {
    return 'Needs at least two AWS gateways or proxies. With $count, runs stay one keyword at a time.';
  }

  @override
  String settingsParallelActive(int workers) {
    return 'The next run works $workers keywords at a time, at the Normal speed.';
  }

  @override
  String get settingsAwsAccountsTitle => 'AWS Accounts';

  @override
  String get settingsAwsAccountsSubtitle =>
      'Each teammate\'s own AWS IAM key for the gateway-deployer script, with history.';

  @override
  String get settingsAwsAccountsNoTeammates =>
      'No teammates yet — once people sign in, each gets a tab here.';

  @override
  String settingsAwsAccountsOthersLocked(String name) {
    return 'Only $name can view or edit their own AWS credentials.';
  }

  @override
  String get settingsAwsAccountsNotSignedIn =>
      'Sign in to manage your own AWS credentials.';

  @override
  String get settingsAwsAccountsLoadFailed =>
      'Couldn\'t load your AWS credentials.';

  @override
  String get settingsAwsAccountsAccessKeyLabel => 'Access key ID';

  @override
  String get settingsAwsAccountsSecretKeyLabel => 'Secret access key';

  @override
  String get settingsAwsAccountsShowSecret => 'Show';

  @override
  String get settingsAwsAccountsHideSecret => 'Hide';

  @override
  String get settingsAwsAccountsRegionsLabel => 'Default region(s)';

  @override
  String get settingsAwsAccountsRegionsHint =>
      'Comma-separated, e.g. us-east-1, eu-west-1';

  @override
  String get settingsAwsAccountsSaveButton => 'Save';

  @override
  String get settingsAwsAccountsSavedToast => 'AWS credentials saved.';

  @override
  String settingsAwsAccountsSaveFailedToast(String error) {
    return 'Couldn\'t save: $error';
  }

  @override
  String get settingsAwsAccountsNotWiredNote =>
      'This just records your key for the team. tools/aws_gateway_setup.py still reads its own data/.env on whichever machine runs it, independently of what\'s saved here — wiring the two together is a planned follow-up.';

  @override
  String get settingsAwsAccountsSetupTitle => 'How to set this up';

  @override
  String get settingsAwsAccountsSetupStep1 =>
      '1. Sign in to the AWS console (console.aws.amazon.com), or create a free account if you don\'t have one.';

  @override
  String get settingsAwsAccountsSetupStep2 =>
      '2. Open IAM → Users → Create user. Give it a name such as gratovo-gateway-deployer — it doesn\'t need console access, only programmatic access.';

  @override
  String get settingsAwsAccountsSetupStep3 =>
      '3. Attach a permissions policy: the AWS managed policy \"AmazonAPIGatewayAdministrator\" is the simplest choice. For a tighter scope, a custom policy allowing just the apigateway:* actions is enough — this only ever creates/deletes HTTP APIs, integrations, routes and stages.';

  @override
  String get settingsAwsAccountsSetupStep4 =>
      '4. Open the new user → Security credentials tab → Create access key → choose \"Application running outside AWS\". The secret access key is shown only once, so copy both values immediately.';

  @override
  String get settingsAwsAccountsSetupStep5 =>
      '5. Paste the Access key ID and Secret access key below, add the region(s) you plan to deploy to (e.g. us-east-1, eu-west-1), and press Save.';

  @override
  String get settingsAwsAccountsSetupStep6 =>
      '6. To actually deploy the gateways, run \"python tools/aws_gateway_setup.py deploy --regions <your regions>\" on the machine that runs searches, with the same key pair set as AWS_IAM_ACCESS_KEY_ID / AWS_IAM_SECRET_ACCESS_KEY in its data/.env.local file.';

  @override
  String get settingsAwsAccountsHistoryTitle => 'History';

  @override
  String get settingsAwsAccountsHistoryEmpty => 'No saved versions yet.';

  @override
  String get settingsAwsAccountsHistoryRestore => 'Restore';

  @override
  String get settingsAwsAccountsHistoryRestoredToast =>
      'Loaded into the fields below — press Save to keep it.';

  @override
  String get settingsAwsAccountsHistoryEntryBlank => 'Cleared';

  @override
  String settingsAwsAccountsHistoryEntryKey(String last4) {
    return 'Key ending $last4';
  }

  @override
  String get settingsAwsAccountsRetry => 'Try again';

  @override
  String get settingsAwsAccountsRotationOn => 'IP rotation on';

  @override
  String get settingsAwsAccountsRotationOff => 'IP rotation off';

  @override
  String get searchKeywordsExpand => 'Expand to full height';

  @override
  String get searchKeywordsCollapse => 'Shrink back down';

  @override
  String get searchInputsReadOnlyHint =>
      'Read-only here — keywords and search settings can only be edited on a desktop.';

  @override
  String get searchCountryAny => 'Any';

  @override
  String searchMaxVideosValue(String count) {
    return 'max $count';
  }

  @override
  String get searchMaxVideosLabel => 'Max videos/search';

  @override
  String get searchMaxVideosTooltip =>
      'How many YouTube search results this run pulls in for each keyword before moving on — videos when Results Type is Video, channel entries when it\'s Channel.\n\nThis is a raw result cap, not a count of channels. Many videos come from the same uploader, and results for channels already in your database still count against it, so a higher number finds proportionally fewer new channels. The scraper keeps paging until it reaches this many results or YouTube runs out, whichever comes first.\n\nLeave blank to use the team\'s shared default.';

  @override
  String get searchInstalledAppRequired =>
      'Searching runs the scraper on your own machine, which a browser tab can\'t do. Open the installed desktop app to start a run — everything else on this page works here.';

  @override
  String get settingsFontScaleLabel => 'Text size';

  @override
  String settingsFontScaleLabelWithPercent(String percent) {
    return 'Text size - $percent%';
  }

  @override
  String get settingsFontScaleReset => 'Reset to 100%';

  @override
  String get commonUnknown => 'Unknown';

  @override
  String get emailsAccessLevelTitle => 'Your access level';

  @override
  String get emailsAccessLevelFull =>
      'Full access. You see every email in full, including names, brands and prices.';

  @override
  String get emailsAccessLevelBasic =>
      'Basic access. You see that emails happened and when, but names, channels, brands, prices and addresses are removed before they leave the server.';

  @override
  String get emailsAccessDeniedTitle => 'No access to email data';

  @override
  String get emailsAccessDeniedBody =>
      'This account has not been granted access to email data. An admin has to raise your access level before anything here will load — it is refused by the database, not hidden by the app.';

  @override
  String get emailsRedactedNote =>
      'The ••• marks are deliberate. Those fields were removed on the server for your access level, not lost.';

  @override
  String get emailsRedactedFieldTooltip => 'Hidden at your access level';

  @override
  String get emailsActionUnavailable => 'Not available at your access level';

  @override
  String get authSignInSubtitle => 'Sign in with the account you were given.';

  @override
  String get authEmailLabel => 'Email';

  @override
  String get authEmailInvalid => 'Enter a valid email address.';

  @override
  String get authPasswordLabel => 'Password';

  @override
  String get authPasswordRequired => 'Enter your password.';

  @override
  String get authSignInButton => 'Sign in';

  @override
  String get authSignOutButton => 'Sign out';

  @override
  String get authNoSelfSignupNotice =>
      'Accounts are created by your administrator — there is no sign-up here.';

  @override
  String get authAdvancedToggle => 'Advanced — server address';

  @override
  String authServerUnreachable(String error) {
    return 'Can\'t reach the server. Check the address under Advanced, then restart the app.\n$error';
  }

  @override
  String get authErrorInvalidCredentials =>
      'That email and password don\'t match an account.';

  @override
  String get authErrorEmailNotConfirmed =>
      'This account hasn\'t been confirmed yet. Ask your administrator to confirm it.';

  @override
  String get authErrorOffline =>
      'No connection. Check your internet and try again.';

  @override
  String get authErrorNotConfigured =>
      'No server is configured. Open Advanced below and enter the address.';

  @override
  String authErrorUnknown(String detail) {
    return 'Couldn\'t sign in: $detail';
  }

  @override
  String get authAccessPendingTitle => 'Waiting for access';

  @override
  String authAccessPendingBody(String email) {
    return 'You\'re signed in as $email, but your account hasn\'t been given an access level yet. Ask your administrator to grant it, then check again.';
  }

  @override
  String get authAccessPendingRecheck => 'Check again';

  @override
  String get settingsAboutTitle => 'About';

  @override
  String settingsAboutVersion(String version, String build) {
    return 'Version $version (build $build)';
  }

  @override
  String get settingsAboutCopyVersion => 'Copy';

  @override
  String get settingsAboutVersionCopied => 'Version copied to clipboard.';

  @override
  String settingsUpdateAvailable(String version) {
    return 'Version $version is ready to install.';
  }

  @override
  String settingsUpdateDownloading(String version) {
    return 'Downloading version $version…';
  }

  @override
  String get settingsUpdateInstalling => 'Restarting to install…';

  @override
  String get settingsUpdateInstall => 'Update';

  @override
  String get settingsUpdateUpToDate => 'Up to date';

  @override
  String get settingsUpdateCheckNow => 'Check for updates';

  @override
  String get settingsUpdateConfirmTitle => 'Finish syncing first?';

  @override
  String get settingsUpdateConfirmBody =>
      'Changes made on this machine are still being uploaded. Installing now restarts the app before they finish.';

  @override
  String settingsUpdateConfirmSideBySide(String version) {
    return 'Version $version installs in its own folder. Your current version stays where it is until you delete it.';
  }

  @override
  String get settingsUpdateConfirmWait => 'Wait for it';

  @override
  String settingsUpdateConfirmCountdown(String seconds) {
    return 'Install anyway ($seconds)';
  }

  @override
  String get settingsUpdateConfirmInstall => 'Install anyway';

  @override
  String get settingsUpdateConfirmPaused =>
      'Move the mouse or press a key to continue.';

  @override
  String get settingsAttentionUpdate => 'Update ready';

  @override
  String get settingsAttentionRejected => 'Sign-in refused';

  @override
  String get settingsAttentionExpiring => 'Expiring soon';

  @override
  String get settingsGithubTitle => 'GitHub (app updates)';

  @override
  String get settingsGithubBody =>
      'Updates come from the private repository. Sign in with the GitHub account that has access to it.';

  @override
  String get settingsGithubSignIn => 'Sign in with GitHub';

  @override
  String get settingsGithubSignOut => 'Sign out';

  @override
  String get settingsGithubRecheck => 'Check access';

  @override
  String settingsGithubSignedInAs(String login) {
    return 'Signed in as $login';
  }

  @override
  String settingsGithubCodeInstruction(String url) {
    return 'Open $url and enter this code:';
  }

  @override
  String get settingsGithubCodeCopied => 'Code copied.';

  @override
  String get settingsGithubAccessGranted =>
      'This account can see the releases.';

  @override
  String settingsGithubAccessDenied(String login) {
    return 'This account cannot see the releases. Add $login to the repository on GitHub, then check again.';
  }

  @override
  String get settingsGithubTokenRejected =>
      'GitHub rejected the stored sign-in. Sign in again.';

  @override
  String get settingsGithubAccessUnknown =>
      'Couldn\'t reach GitHub to check access.';

  @override
  String get settingsGithubNotConfigured =>
      'This build has no GitHub client ID, so sign-in is unavailable. Rebuild with --dart-define=GRATOVO_GITHUB_CLIENT_ID=...';

  @override
  String get settingsGithubDenied => 'The sign-in was refused in the browser.';

  @override
  String get settingsGithubExpired =>
      'The code expired before it was entered. Try again.';

  @override
  String get settingsGithubUnreachable => 'Couldn\'t reach GitHub.';

  @override
  String get settingsGithubStorageFailed =>
      'GitHub signed you in, but this computer couldn\'t save the token. Try again.';

  @override
  String get settingsGithubSharedToken =>
      'Updates use a shared access token built into this app.';

  @override
  String get settingsGithubSharedTokenOk =>
      'The built-in token can read the releases.';

  @override
  String get settingsGithubSharedRejected =>
      'The built-in token was refused — expired or revoked. Everyone on this version is affected; a new build is needed. You can sign in with your own GitHub account to keep updating meanwhile.';

  @override
  String get settingsGithubNoToken =>
      'This build has no way to reach the releases, so it will never find an update.';

  @override
  String get settingsGithubSignInOptional => 'Sign in as yourself (optional)';

  @override
  String get settingsAccountTitle => 'Supabase Account';

  @override
  String get settingsAccountSignedOut => 'Not signed in.';

  @override
  String settingsAccountProfileError(String error) {
    return 'Couldn\'t load your profile: $error';
  }

  @override
  String get settingsAccountColorLabel => 'Your color';

  @override
  String get settingsAccountColorHelp =>
      'Teammates see this color around whatever you\'re editing.';

  @override
  String get settingsAccountColorButton => 'Change your color';

  @override
  String get settingsAccountColorOthersLabel => 'Other accounts, for reference';

  @override
  String get settingsAccountStatusConnected => 'Connected';

  @override
  String get settingsAccountStatusSignedOut => 'Signed out';

  @override
  String get settingsAccountStatusUnreachable => 'Unreachable';

  @override
  String get settingsServerAdvancedTitle => 'Advanced — server address';

  @override
  String get settingsServerAdvancedHelp =>
      'Only change these if you\'re moving to a different Supabase project. Neither value is a secret; the key that is (service_role) is never stored in this app.';

  @override
  String get settingsServerUrlLabel => 'Project URL';

  @override
  String get settingsServerAnonKeyLabel => 'Public (anon) key';

  @override
  String get settingsServerAnonKeyHelp =>
      'The anon/public key — safe to store here. Never paste the service_role key.';

  @override
  String get settingsSyncTitle => 'Team sync';

  @override
  String get settingsSyncDisabled =>
      'No local database on this machine, so nothing can be saved or synced. The app is showing sample data.';

  @override
  String get settingsSyncPreparing =>
      'Not synced with the team yet. Everything shown is what this machine already holds; your edits are saved here and upload once the first sync runs.';

  @override
  String get settingsSyncActive =>
      'In sync with the team. Edits save here first and upload in the background; teammates’ changes and the shared catalog come down on each tick.';

  @override
  String get settingsSyncOffline =>
      'Offline. Your edits are saved here and will upload when you reconnect.';

  @override
  String get settingsSyncBusy => 'Syncing with the server…';

  @override
  String get settingsSyncConnecting => 'Connecting to the server…';

  @override
  String get settingsSyncUploading => 'Sending your changes to the server…';

  @override
  String get settingsSyncDownloading => 'Downloading changes from the server…';

  @override
  String settingsSyncDetailTable(String table, String rows) {
    return 'Updating $table — $rows rows';
  }

  @override
  String settingsSyncProgress(int done, int total) {
    return '$done of $total tables';
  }

  @override
  String settingsSyncDetailUpload(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Sending $count local changes',
      one: 'Sending 1 local change',
    );
    return '$_temp0';
  }

  @override
  String settingsSyncLastSynced(String when) {
    return 'Last synced at $when';
  }

  @override
  String get settingsSyncDeferred =>
      'Paused while a search runs, so the search keeps the connection. Your edits still upload.';

  @override
  String settingsSyncError(String detail) {
    return 'Sync problem: $detail';
  }

  @override
  String settingsSyncLocalFault(String detail) {
    return 'The database on this machine stopped responding. Nothing already saved is lost, but nothing new can be saved until it answers again — check the disk. $detail';
  }

  @override
  String get settingsSyncLogButton => 'Sync details';

  @override
  String get settingsSyncLogTitle => 'What the sync has been doing';

  @override
  String get settingsSyncLogIntro =>
      'Every request this machine has made to the server since the app started, newest at the bottom. Copy this into a bug report — it says which table was being downloaded, how long each page took and what the server answered.';

  @override
  String get settingsSyncLogEmpty =>
      'Nothing recorded yet. The first sync writes here.';

  @override
  String settingsSyncLogFile(String path) {
    return 'The full history, across restarts, is kept at:\n$path';
  }

  @override
  String get settingsSyncLogCopy => 'Copy';

  @override
  String get settingsSyncLogCopied => 'Sync log copied.';

  @override
  String settingsSyncLogCounts(int passes, int failed) {
    String _temp0 = intl.Intl.pluralLogic(
      passes,
      locale: localeName,
      other: '$passes passes so far',
      one: '1 pass so far',
      zero: 'No passes yet',
    );
    String _temp1 = intl.Intl.pluralLogic(
      failed,
      locale: localeName,
      other: '$failed with problems',
      one: '1 with problems',
      zero: 'none with problems',
    );
    return '$_temp0, $_temp1.';
  }

  @override
  String get syncNowTooltip => 'Sync data with server';

  @override
  String get syncNowInProgress => 'Syncing…';

  @override
  String get syncNowDone => 'Up to date';

  @override
  String get syncNowLocalPushFailed =>
      'Synced, but this machine\'s search results could not be uploaded.';

  @override
  String get syncNowLocalPullFailed =>
      'Synced your edits, but the latest search data could not be downloaded.';

  @override
  String get syncNowPipelineBusy =>
      'Synced your edits. Search results are shared by the search itself while it runs.';

  @override
  String syncNowError(String detail) {
    return 'Could not reach the server: $detail';
  }

  @override
  String settingsSyncLastManual(String when, String detail) {
    return 'Last manual sync at $when: $detail';
  }

  @override
  String get settingsServerResetDefaults => 'Reset to defaults';

  @override
  String get settingsServerSavedRestart =>
      'Saved. Restart the app for it to take effect.';

  @override
  String get settingsServerClearSaved => 'Clear saved values';

  @override
  String get settingsServerResetDone =>
      'Back to the defaults this build shipped with.';

  @override
  String get settingsServerCleared => 'Saved values cleared.';

  @override
  String settingsServerActionFailed(String error) {
    return 'Could not change the server address: $error';
  }

  @override
  String get settingsServerStatusRestart =>
      'Restart the app to use these values.';

  @override
  String get settingsServerStatusUnsaved => 'Unsaved changes.';

  @override
  String get settingsServerStatusCustom => 'This computer uses its own values.';

  @override
  String get settingsServerStatusDefaults =>
      'Using the defaults this build shipped with.';

  @override
  String get settingsServerShippedTitle => 'Shipped with this build';

  @override
  String get settingsServerShippedNone =>
      'This build shipped without a server address. Enter one above.';

  @override
  String get accessLevelFull => 'Full authority';

  @override
  String get accessLevelFullExplanation =>
      'You can see everything, including email contents, prices, brands, and contact addresses.';

  @override
  String get accessLevelBasic => 'Basic authority';

  @override
  String get accessLevelBasicExplanation =>
      'You can see that emails and deals happened, and their status and timing. Influencer names, channels, brands, prices, and email addresses are removed by the server before they reach you.';

  @override
  String get accessLevelUnauthorized => 'No access yet';

  @override
  String get accessLevelUnauthorizedExplanation =>
      'Your account hasn\'t been given an access level. Ask your administrator to grant one.';

  @override
  String get navLogs => 'Logs';

  @override
  String get logsSearchHint => 'Search people, records, fields';

  @override
  String get logsFilterActor => 'Person';

  @override
  String get logsFilterAction => 'Action';

  @override
  String get logsFilterEntity => 'Record';

  @override
  String get logsFilterAllPeople => 'Everyone';

  @override
  String get logsFilterAllActions => 'All actions';

  @override
  String get logsFilterAllEntities => 'All records';

  @override
  String get logsRangeToday => 'Today';

  @override
  String get logsRange7Days => 'Last 7 days';

  @override
  String get logsRange30Days => 'Last 30 days';

  @override
  String get logsClearFilters => 'Clear filters';

  @override
  String get logsEmpty =>
      'Nothing has been recorded yet. Actions show up here as they happen.';

  @override
  String get logsNoMatches => 'No actions match these filters.';

  @override
  String get logsEndOfList => 'That is the whole log.';

  @override
  String logsShowingCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString entries so far';
  }

  @override
  String logsNewCount(int count) {
    return '$count new';
  }

  @override
  String get logsLoadingMore => 'Loading more…';

  @override
  String get logsDeletedAccount => 'account deleted';

  @override
  String get logsDeletedAccountTooltip =>
      'This account has been removed. What they did is kept.';

  @override
  String logsActorRole(String role) {
    return 'as $role';
  }

  @override
  String logsValueChange(String from, String to) {
    return '$from → $to';
  }

  @override
  String logsNotesLengthChange(int before, int after) {
    final intl.NumberFormat beforeNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String beforeString = beforeNumberFormat.format(before);
    final intl.NumberFormat afterNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String afterString = afterNumberFormat.format(after);

    return '$beforeString → $afterString characters';
  }

  @override
  String get logsContentNotRecorded =>
      'Contents are deliberately not recorded.';

  @override
  String get logsOpenRecord => 'Open';

  @override
  String get logsActionCreated => 'Created';

  @override
  String get logsActionUpdated => 'Updated';

  @override
  String get logsActionDeleted => 'Deleted';

  @override
  String get logsActionTagsChanged => 'Tags changed';

  @override
  String get logsActionStageChanged => 'Stage changed';

  @override
  String get logsActionVettingChanged => 'Vetting changed';

  @override
  String get logsActionNotesChanged => 'Notes edited';

  @override
  String get logsActionContactsChanged => 'Contacts changed';

  @override
  String get logsActionContactAttempt => 'Outreach attempt';

  @override
  String get logsActionEmailSent => 'Email sent';

  @override
  String get logsActionSearchStarted => 'Search started';

  @override
  String get logsActionVideosPulled => 'Videos pulled';

  @override
  String get logsActionUnknown => 'Other';

  @override
  String get logsEntityChannel => 'Channel';

  @override
  String get logsEntityDeal => 'Deal';

  @override
  String get logsEntityBrand => 'Brand';

  @override
  String get logsEntityThread => 'Email thread';

  @override
  String get logsEntityRun => 'Search run';

  @override
  String get logsEntitySettings => 'Settings';

  @override
  String get logsEntityOther => 'Other';

  @override
  String get logsActivityTitle => 'Activity';

  @override
  String get logsActivityEmpty => 'Nothing recorded for this channel yet.';

  @override
  String get logsActivitySeeAll => 'See the whole log';

  @override
  String get notificationsTitle => 'Notifications';

  @override
  String get notificationsBellTooltip => 'Notifications';

  @override
  String get notificationsEmpty =>
      'Nothing yet. Toasts you see will be kept here.';

  @override
  String get notificationsClearAll => 'Clear all';

  @override
  String notificationsUnreadCount(int count) {
    return '$count new';
  }

  @override
  String get commonExpand => 'Expand';

  @override
  String get commonCollapse => 'Collapse';

  @override
  String get commonCopied => 'Copied to the clipboard';

  @override
  String get commonDay => 'Day';

  @override
  String get commonMonth => 'Month';

  @override
  String get commonYear => 'Year';

  @override
  String get commonHour => 'Hour';

  @override
  String get commonMinute => 'Minute';

  @override
  String get commonSpinHint =>
      'Scroll or use the arrow keys over a box to change it.';

  @override
  String get influencerProfileNoDescription =>
      'This channel has no description.';

  @override
  String get influencerProfileShowFullDescription =>
      'Show the full description';

  @override
  String get influencerProfileShowLessDescription => 'Show less';

  @override
  String get influencerProfileViewProfilePicture => 'View the profile picture';

  @override
  String get influencerProfileViewBanner => 'View the banner';

  @override
  String get influencerProfileImageZoomHint =>
      'Scroll or pinch to zoom · drag to move';

  @override
  String get influencerProfileImageResetZoom => 'Reset zoom';

  @override
  String get influencerProfileImageClose => 'Close';

  @override
  String get influencerProfileContactsTitle => 'How to reach them';

  @override
  String get influencerProfileNoContacts => 'No contact method recorded yet.';

  @override
  String get influencerProfileAddContact => 'Add a contact';

  @override
  String get influencerProfileContactValueHint => 'Address, number or handle';

  @override
  String get influencerProfileContactLabelHint => 'Whose? (optional)';

  @override
  String get influencerProfileContactPrimary => 'Primary';

  @override
  String get influencerProfileContactMakePrimary =>
      'Make this the primary contact';

  @override
  String get influencerProfileContactRemove => 'Remove this contact';

  @override
  String get influencerProfileContactCopy => 'Copy';

  @override
  String get influencerProfileContactsSaved => 'Contacts saved';

  @override
  String get contactMethodEmail => 'Email';

  @override
  String get contactMethodWhatsapp => 'WhatsApp';

  @override
  String get contactMethodPhone => 'Phone';

  @override
  String get contactMethodInstagram => 'Instagram';

  @override
  String get contactMethodTelegram => 'Telegram';

  @override
  String get contactMethodTwitter => 'X / Twitter';

  @override
  String get contactMethodDiscord => 'Discord';

  @override
  String get contactMethodOther => 'Other';

  @override
  String influencerProfileCrmBasisCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'Based on $countString stored uploads';
  }

  @override
  String get influencerProfileCrmBasisWindow =>
      'A search stores roughly the last month of uploads. Pull more to widen what this is calculated from.';

  @override
  String influencerProfileCrmSpanDays(int days) {
    final intl.NumberFormat daysNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String daysString = daysNumberFormat.format(days);

    return 'covering $daysString days';
  }

  @override
  String get influencerProfileVideosAsList => 'List view';

  @override
  String get influencerProfileVideosAsCards => 'Card view';

  @override
  String get influencerProfileVideoNoDescription => 'No description stored.';

  @override
  String influencerProfileVideoCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString stored';
  }

  @override
  String get influencerListHideImages => 'Turn pictures off for this page';

  @override
  String get influencerListShowImages => 'Turn pictures back on';

  @override
  String get influencerListShowLatestVideo =>
      'Show the latest upload on each card';

  @override
  String get influencerListHideLatestVideo => 'Hide the latest upload';

  @override
  String get influencerListNoLatestVideo => 'No uploads stored';

  @override
  String get influencerListOpenChannel => 'Open this channel';

  @override
  String get influencerListRightClickHint =>
      'Right-click a channel to change its status or tags.';

  @override
  String get influencerListScrollToBottom => 'Scroll to bottom';

  @override
  String get influencerListPinPosition => 'Pin this position';

  @override
  String get influencerListReturnToPin => 'Return to pinned position';

  @override
  String get influencerContextMenuStatus => 'Status';

  @override
  String get influencerContextMenuChannelTag => 'Channel tag';

  @override
  String get influencerQuickTagPresetTooltip => 'Quick-tag preset';

  @override
  String get influencerQuickTagPresetDialogTitle => 'Quick-tag preset';

  @override
  String get influencerQuickTagPresetDialogDescription =>
      'Pick the tags to add with Ctrl + right-click, or remove with Alt + right-click, on a channel.';

  @override
  String get influencerQuickTagPresetEmpty =>
      'No quick-tag preset set. Pick one with the brush icon first.';

  @override
  String get channelTagUndecided => 'Undecided';

  @override
  String get channelTagQualified => 'Qualified';

  @override
  String get channelTagHaramStuff => 'Haram stuff';

  @override
  String get channelTagIrrelevant => 'Irrelevant';

  @override
  String get channelTagInactive => 'Inactive';

  @override
  String get settingsImagesTitle => 'Saved Pictures';

  @override
  String get settingsAutoDownloadImagesLabel => 'Save pictures on this machine';

  @override
  String get settingsAutoDownloadImagesOn =>
      'Profile pictures, banners and thumbnails are kept after they load once, so this machine never fetches the same picture twice.';

  @override
  String get settingsAutoDownloadImagesOff =>
      'Pictures are fetched when they are shown and nothing is written to disk. A picture already saved is still used before the network either way.';

  @override
  String get settingsImagesNoStorage =>
      'This build has no filesystem to save into, so every picture is fetched when it is shown.';

  @override
  String settingsImageCacheSize(String size) {
    return '$size saved';
  }

  @override
  String get settingsImageCacheEmpty => 'Nothing saved yet.';

  @override
  String settingsClearImageCache(String size) {
    return 'Delete $size saved pictures';
  }

  @override
  String settingsImageCacheCleared(String size) {
    return 'Deleted $size of saved pictures.';
  }

  @override
  String get logsRangeAny => 'Any time';

  @override
  String get outreachNewMessage => 'New message';

  @override
  String get outreachPickInfluencerTitle => 'Who do you want to message?';

  @override
  String get outreachPickInfluencerHint => 'Search channels by name or handle';

  @override
  String get outreachPickInfluencerEmpty => 'No channels match.';

  @override
  String outreachNotifyReplyTitle(String who) {
    return '$who replied';
  }

  @override
  String get outreachNotifyReplyAnonymousTitle => 'A creator replied';

  @override
  String get outreachNotifyFollowUpFailedTitle =>
      'A follow-up could not be sent';

  @override
  String get archiveBulkCleanStop => 'Stop';

  @override
  String get outreachComposeOpening => 'Opening conversation…';

  @override
  String get outreachReminderDueToday => 'Due today';

  @override
  String outreachReminderDueInDays(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'Due in $countString days';
  }

  @override
  String outreachReminderOverdueByDays(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'Overdue by $countString days';
  }

  @override
  String get outreachLogReply => 'Log a reply';

  @override
  String get outreachShowProfile => 'Show profile';

  @override
  String get outreachHideProfile => 'Hide profile';

  @override
  String get outreachOpenFullProfile => 'Open full profile';

  @override
  String get outreachComposeMethodLabel => 'Contact method';

  @override
  String outreachComposeSendVia(String method) {
    return 'Sending via $method';
  }

  @override
  String get outreachComposeToLabel => 'To';

  @override
  String get outreachComposeMessageLabel => 'Message';

  @override
  String get outreachComposeNoContactYet =>
      'No contact on file for this channel. Add one to start the conversation.';

  @override
  String outreachComposeAddContactFor(String method) {
    return 'Add a $method contact';
  }

  @override
  String get outreachComposeNothingToSend =>
      'Write a message before marking it sent.';

  @override
  String get outreachOpenMailApp => 'Open mail app';

  @override
  String get outreachMailAppRefused =>
      'Couldn\'t open a mail app — the message is on your clipboard instead.';

  @override
  String get outreachBodyTooLongForMail =>
      'The draft is long, so the mail app opened with just the subject — the body is on your clipboard to paste in.';

  @override
  String get outreachCopyBody => 'Copy body';

  @override
  String get outreachCopyMessage => 'Copy message';

  @override
  String outreachCopyContactValue(String method) {
    return 'Copy $method';
  }

  @override
  String get outreachOpenContactLink => 'Open link';

  @override
  String get outreachMarkSent => 'Mark as sent';

  @override
  String outreachMessageSentVia(String method) {
    return 'Logged as sent via $method.';
  }

  @override
  String get outreachAddContactValueHint => 'Address, number or handle';

  @override
  String get outreachAddContactAdd => 'Add & use';

  @override
  String get outreachRecentUploadsTitle => 'Recent uploads — timing reference';

  @override
  String get commonDateUnknown => 'date unknown';

  @override
  String get outreachScheduleFollowUp => 'Schedule follow-up';

  @override
  String outreachFollowUpDefaultTitle(String handle) {
    return 'Follow up with $handle';
  }

  @override
  String get outreachFollowUpReminderLabel => 'Reminder note';

  @override
  String get outreachFollowUpWhenLabel => 'When';

  @override
  String get outreachFollowUpTomorrow => 'Tomorrow';

  @override
  String get outreachFollowUpIn3Days => 'In 3 days';

  @override
  String get outreachFollowUpInAWeek => 'In a week';

  @override
  String get outreachFollowUpCustom => 'Custom…';

  @override
  String get outreachFollowUpPickDateTime => 'Pick date & time';

  @override
  String outreachFollowUpScheduled(String date) {
    return 'Follow-up set for $date.';
  }

  @override
  String get outreachFollowUpSavedNoNotif =>
      'Follow-up saved — you\'ll see it on the dashboard.';

  @override
  String get outreachFollowUpMarkedDone => 'Follow-up cleared.';

  @override
  String get outreachFollowUpsSectionTitle => 'Scheduled follow-ups';

  @override
  String get outreachFollowUpClear => 'Mark done';

  @override
  String outreachFollowUpNumbered(int number, int total) {
    return 'Follow-up $number of $total';
  }

  @override
  String outreachFollowUpLeft(String duration) {
    return '$duration left';
  }

  @override
  String outreachFollowUpOverdue(String duration) {
    return '$duration overdue';
  }

  @override
  String outreachDurationDaysHours(int days, int hours) {
    return '${days}d ${hours}h';
  }

  @override
  String outreachDurationHoursMinutes(int hours, int minutes) {
    return '${hours}h ${minutes}m';
  }

  @override
  String outreachDurationMinutes(int minutes) {
    return '${minutes}m';
  }

  @override
  String get outreachFollowUpsEmpty => 'No follow-up scheduled.';

  @override
  String get outreachFollowUpsSequenceDone =>
      'Three follow-ups sent with no reply. Wait two weeks to two months, then start a new thread with a new angle.';

  @override
  String get outreachFollowUpsApproval =>
      'Each follow-up is written and approved when it\'s due. Nothing is sent by itself.';

  @override
  String get outreachNoFollowUps => 'No follow-ups scheduled.';

  @override
  String get outreachLogReplyTitle => 'Log a reply';

  @override
  String get outreachLogReplyBodyLabel => 'What they said';

  @override
  String get outreachLogReplyMethodLabel => 'Came in via';

  @override
  String get outreachLogReplyReceivedLabel => 'Received';

  @override
  String get outreachReplyLogged => 'Reply logged.';

  @override
  String get influencerProfileContactAction => 'Contact';

  @override
  String get influencerProfileOpenConversation => 'Open conversation';

  @override
  String get navArchive => 'Archive';

  @override
  String get archiveTitle => 'Archive';

  @override
  String get archiveExplanation =>
      'Channels tagged haram stuff or irrelevant are reduced to a short record 7 days after tagging, and everything else about them is deleted: videos, notes, contacts, description. Only what you see here is kept.';

  @override
  String archiveHoldingCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count archived channels',
      one: '1 archived channel',
      zero: 'Nothing archived yet',
    );
    return '$_temp0';
  }

  @override
  String get archiveSearchHint => 'Search by handle';

  @override
  String get archiveFilterLabel => 'Reason';

  @override
  String get archiveFilterAllLabels => 'All reasons';

  @override
  String get archiveSortLabel => 'Sort by';

  @override
  String get archiveSortArchivedAt => 'Date archived';

  @override
  String get archiveSortHandle => 'Handle';

  @override
  String get archiveSortSubscribers => 'Subscribers';

  @override
  String get archiveSortVideos => 'Videos found';

  @override
  String get archiveSortAverageViews => 'Median views';

  @override
  String get archiveEmpty => 'Nothing has been archived yet.';

  @override
  String get archiveEmptyHint =>
      'A channel arrives here 7 days after it is tagged haram stuff or irrelevant.';

  @override
  String get archiveNoMatches => 'No archived channel matches this filter.';

  @override
  String get archiveColumnSubscribers => 'Subscribers';

  @override
  String get archiveColumnAvgViews => 'Median views';

  @override
  String get archiveColumnVideos => 'Videos found';

  @override
  String archiveArchivedOn(String date) {
    return 'Archived $date';
  }

  @override
  String archiveFoundOn(String date) {
    return 'Found $date';
  }

  @override
  String get archiveNoAverage => 'No view counts were ever recorded';

  @override
  String get archiveMedianNotFetched =>
      'Rejected on its subscriber count during the search, before any video was fetched — there was never a median to record';

  @override
  String get archiveMedianLifetime =>
      'Median over every stored video. Nothing was uploaded in the 30 days before this channel was last read, so the usual 30-day figure has nothing to average';

  @override
  String get archiveMedianWindow30 =>
      'Median views over the 30 days before this channel was last read — the same figure the Influencers list shows';

  @override
  String get archiveVideosNotCounted =>
      'Never counted — no videos were fetched for this channel before it was archived';

  @override
  String get archiveVideosNone =>
      'The channel\'s videos were read and there were none';

  @override
  String get archiveOpenOnYoutube => 'Open on YouTube';

  @override
  String get archiveLoadMore => 'Load more';

  @override
  String get archiveLoadFailed => 'Couldn\'t load the archive.';

  @override
  String get archiveRestoreNote =>
      'Use the ✕ on a row to free a channel: it is queued for enrichment and comes back to the Influencers list as a new find. Nothing that was deleted returns.';

  @override
  String get archiveChangeReasonTooltip => 'Change the reason';

  @override
  String archiveReasonChanged(String reason) {
    return 'Reason changed to $reason';
  }

  @override
  String get archiveReasonChangeFailed => 'Couldn\'t change the reason.';

  @override
  String get archiveFreeTooltip => 'Free this channel and re-enrich it';

  @override
  String get archiveFreeUnavailable =>
      'Freeing a channel re-enriches it, which needs the installed desktop app.';

  @override
  String archiveFreeConfirmTitle(String handle) {
    return 'Free $handle from the archive?';
  }

  @override
  String get archiveFreeConfirmBody =>
      'The record is removed and the channel is queued for enrichment. It comes back to the Influencers list as a new, un-vetted find — with no tags and no countdown. Nothing that was deleted when it was archived returns.';

  @override
  String get archiveFreeConfirmAction => 'Free & enrich';

  @override
  String archiveFreeStarted(String handle) {
    return 'Freed $handle — enriching now. See the Search page for progress.';
  }

  @override
  String get archiveFreeBusy =>
      'The pipeline is busy right now. Try again once the current run finishes.';

  @override
  String get archiveFreeFailed => 'Couldn\'t free the channel.';

  @override
  String influencerArchivesIn(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Archives in $days days',
      one: 'Archives tomorrow',
      zero: 'Archives today',
    );
    return '$_temp0';
  }

  @override
  String get influencerArchivePendingTitle => 'Scheduled for archiving';

  @override
  String influencerArchivePendingBody(String label, String date) {
    return 'This channel is tagged $label. On $date it will be reduced to a handle, its counts and that label, and everything else — every video, note and contact — will be deleted. Remove the tag to keep it.';
  }

  @override
  String get influencerArchiveNow => 'Archive now';

  @override
  String get influencerArchiveNowConfirmTitle => 'Archive this channel now?';

  @override
  String get influencerArchiveNowConfirmBody =>
      'It will be reduced to its handle, subscriber count, median views, video count and label right now. Its videos, notes and contacts will be deleted and cannot be recovered.';

  @override
  String get influencerArchiveNowConfirm => 'Archive it';

  @override
  String get influencerArchiveScheduled => 'Archiving now.';

  @override
  String get influencerArchiveKeep => 'Keep this channel';

  @override
  String get influencerArchiveKept => 'Archiving cancelled.';

  @override
  String get commonRefresh => 'Refresh';

  @override
  String get commonSortAscending => 'Ascending';

  @override
  String get commonSortDescending => 'Descending';

  @override
  String get navConflicts => 'Conflicts';

  @override
  String get conflictDetectedSnack =>
      'Somebody edited this first. Your version is saved on the Conflicts page.';

  @override
  String get conflictChannelGone => 'That channel no longer exists.';

  @override
  String get conflictsTitle => 'Conflicts';

  @override
  String get conflictsExplanation =>
      'An edit lands here only when it was written against a value somebody had already changed — so neither version contains the other. Editing on top of a colleague\'s saved work never appears here.';

  @override
  String get conflictsNone => 'No conflicts.';

  @override
  String get conflictsNoneHint =>
      'Edits that build on each other are applied silently; only genuinely diverging ones need a decision.';

  @override
  String get conflictsOpenSection => 'Waiting for a decision';

  @override
  String get conflictsResolvedSection => 'Recently settled';

  @override
  String conflictsOpenCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count conflicts',
      one: '1 conflict',
      zero: 'No conflicts',
    );
    return '$_temp0';
  }

  @override
  String conflictsShellBanner(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count edits are waiting for a decision',
      one: 'An edit is waiting for a decision',
    );
    return '$_temp0';
  }

  @override
  String get conflictFieldNotes => 'Notes';

  @override
  String get conflictFieldTags => 'Channel tags';

  @override
  String get conflictFieldStage => 'Pipeline stage';

  @override
  String get conflictFieldVetting => 'Vetting status';

  @override
  String get conflictFieldCriteria => 'Relevance criteria';

  @override
  String get conflictFieldProvided => 'Provided data';

  @override
  String get conflictFieldContacts => 'Contacts';

  @override
  String conflictOnChannel(String field, String channel) {
    return '$field on $channel';
  }

  @override
  String conflictMineBy(String name) {
    return '$name wrote';
  }

  @override
  String conflictTheirsBy(String name) {
    return '$name wrote';
  }

  @override
  String get conflictTheirsUnknown => 'Someone else wrote';

  @override
  String get conflictBaseWas => 'Both started from';

  @override
  String get conflictKeepMine => 'Keep this one';

  @override
  String get conflictKeepTheirs => 'Keep this one';

  @override
  String get conflictMerge => 'Write something else';

  @override
  String get conflictMergeTitle => 'Combine both versions';

  @override
  String get conflictMergeHint =>
      'Both versions are above. Edit this into what the field should say.';

  @override
  String get conflictMergeSave => 'Save this';

  @override
  String conflictResolvedBy(String name) {
    return 'Settled by $name';
  }

  @override
  String conflictResolutionMine(String name) {
    return 'kept $name\'s version';
  }

  @override
  String conflictResolutionTheirs(String name) {
    return 'kept $name\'s version';
  }

  @override
  String get conflictResolutionMerged => 'combined both';

  @override
  String get conflictResolveFailed => 'Couldn\'t settle that conflict.';

  @override
  String get conflictAlreadyResolved => 'Somebody already settled that one.';

  @override
  String get conflictOpenChannel => 'Open the channel';

  @override
  String conflictProfileBannerTitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count edits to this channel need a decision',
      one: 'An edit to this channel needs a decision',
    );
    return '$_temp0';
  }

  @override
  String get conflictProfileBannerAction => 'Review';

  @override
  String conflictDetectedAt(String date) {
    return 'Detected $date';
  }

  @override
  String get conflictEmptyValue => '(empty)';

  @override
  String get archiveBulkCleanAction => 'Bulk clean';

  @override
  String get archiveBulkCleanTitle => 'Reject many channels at once, by size';

  @override
  String get archiveBulkCleanBody =>
      'Tags every channel whose size falls inside the ranges below as rejected, in one pass. Nothing is deleted today: a tagged channel is archived 7 days later, and clearing the tag before then keeps it.';

  @override
  String get archiveBulkCleanSubsSection => 'Subscriber range to reject';

  @override
  String get archiveBulkCleanAvgSection => 'Median-views range to reject';

  @override
  String get archiveBulkCleanRangeTip =>
      'A reject band — the opposite of the search page\'s keep band. A channel inside every range you fill in is tagged; anything outside is left alone.';

  @override
  String get archiveBulkCleanMinLabel => 'From (subscribers)';

  @override
  String get archiveBulkCleanMaxLabel => 'To (subscribers)';

  @override
  String get archiveBulkCleanAvgMinLabel => 'From (median views)';

  @override
  String get archiveBulkCleanAvgMaxLabel => 'To (median views)';

  @override
  String get archiveBulkCleanBoundsHint =>
      'Leave a side empty for an open end. A channel is rejected only when it is inside every range you fill in.';

  @override
  String get archiveBulkCleanNeedsBound => 'Set at least one end of one range.';

  @override
  String get archiveBulkCleanLabelLabel => 'Tag them as';

  @override
  String get archiveBulkCleanImmediate => 'Delete now, skipping the 7 days';

  @override
  String get archiveBulkCleanImmediateHint =>
      'Permanent, and it cascades: every video, note and contact on these channels goes with them. The grace period is the only thing standing between a mistyped range and losing them all.';

  @override
  String get archiveBulkCleanPreview => 'Check the range';

  @override
  String get archiveBulkCleanRecheck => 'Re-check';

  @override
  String archiveBulkCleanDeleting(int done, int total) {
    return 'Deleting $done of $total…';
  }

  @override
  String archiveBulkCleanMatched(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels match',
      one: '1 channel matches',
      zero: 'No channel matches this range',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanSkippedTagged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count more are already tagged and counting down.',
      one: '1 more is already tagged and counting down.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanSkippedProtected(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count are left alone because there are deals or outreach histories with them.',
      one:
          '1 is left alone because there is a deal or an outreach history with them.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanSkippedUnknown(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count channels are missing a number these ranges need, and are in no range at all.',
      one:
          '1 channel is missing a number these ranges need, and is in no range at all.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanConfirmTag(int count) {
    return 'Tag $count';
  }

  @override
  String archiveBulkCleanConfirmDelete(int count) {
    return 'Delete $count now';
  }

  @override
  String archiveBulkCleanTagged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels tagged. They are archived in 7 days.',
      one: '1 channel tagged. It is archived in 7 days.',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanArchived(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels archived.',
      one: '1 channel archived.',
    );
    return '$_temp0';
  }

  @override
  String get archiveBulkCleanFailed => 'Couldn\'t run the bulk clean.';

  @override
  String get archiveBulkCleanUnavailable =>
      'Bulk cleaning needs full authority.';

  @override
  String get archiveBulkCleanModeLive => 'Live';

  @override
  String get archiveBulkCleanModeScheduled => 'Scheduled for archive';

  @override
  String get archiveBulkCleanDueTitle =>
      'Act on channels already counting down';

  @override
  String get archiveBulkCleanDueBody =>
      'Acts on channels already tagged and counting down to being archived. Narrow by the ranges below, or leave them blank to reach every channel currently due.';

  @override
  String archiveBulkCleanDueMatched(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels are currently due',
      one: '1 channel is currently due',
      zero: 'No channel is currently due in this range',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanConfirmArchiveNow(int count) {
    return 'Archive $count now';
  }

  @override
  String archiveBulkCleanConfirmUndo(int count) {
    return 'Undo archive for $count';
  }

  @override
  String get archiveBulkCleanArchiveNowHint =>
      'Skips whatever is left of the 7 days and deletes now. Permanent, and it cascades: every video, note and contact on these channels goes with them.';

  @override
  String get archiveBulkCleanUndoHint =>
      'Clears every tag on these channels, the same as unchecking them by hand. Cancels the countdown — nothing is deleted.';

  @override
  String archiveBulkCleanUndone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels untagged. The countdown is cancelled.',
      one: '1 channel untagged. The countdown is cancelled.',
    );
    return '$_temp0';
  }

  @override
  String get searchAutoCleanTitle => 'Auto-clean results';

  @override
  String get searchAutoCleanBody =>
      'Two keep bands — a subscriber range and an average-views range. A channel that lands inside both is collected as normal. A channel outside either one is acted on: for the subscriber band, during the run itself, before its videos cost anything; for both bands, by a sweep of that run\'s finds after it ends.';

  @override
  String get searchAutoCleanEnable => 'Apply this to every run';

  @override
  String get searchAutoCleanEnableHint =>
      'Runs on its own, with no confirmation step. The below/above actions decide what that means — leave it off unless those are choices you would make without reading a count first.';

  @override
  String get searchAutoCleanOff => 'Off — finished runs are left alone';

  @override
  String get searchAutoCleanNoBounds =>
      'On, but no range set — nothing will be cleaned';

  @override
  String get searchAutoCleanSubsSectionTitle => 'Subscriber range to keep';

  @override
  String get searchAutoCleanAvgSectionTitle => 'Median-views range to keep';

  @override
  String get searchAutoCleanKeepBandTip =>
      'A keep band. A channel whose number lands inside it is collected as normal; one outside it — on either side — is what this rule acts on.';

  @override
  String get searchAutoCleanActionSweepNote =>
      'Archive during the run — the channel is tagged rejected and synced up before its videos are fetched, and the after-the-run sweep tags it too.';

  @override
  String get searchAutoCleanActionDelayNote =>
      'Keep, fetch videos later — the channel stays and is not archived; its videos are skipped now and read later from the backlog.';

  @override
  String get searchAutoCleanActionOffNote =>
      'Treat as in range — nothing special; collected exactly like a channel inside the band.';

  @override
  String get searchAutoCleanAvgNote =>
      'Same keep band as above, but a channel\'s median views are not known until its videos are read — so one outside this range is always handled by the after-the-run sweep, never deferred.';

  @override
  String get searchAutoCleanHousePreset =>
      'Use the house rule: about 50K views, no size cap';

  @override
  String get searchAutoCleanKeepAvgMinLabel => 'Keep from (median views)';

  @override
  String get searchAutoCleanKeepAvgMaxLabel => 'Keep up to (median views)';

  @override
  String searchAutoCleanKeepSummary(String range) {
    return 'Keeps $range';
  }

  @override
  String searchAutoCleanRejectsSummary(String ranges) {
    return 'Rejects new finds $ranges';
  }

  @override
  String searchAutoCleanGateBelow(String action) {
    return 'below → $action';
  }

  @override
  String searchAutoCleanGateAbove(String action) {
    return 'above → $action';
  }

  @override
  String searchAutoCleanAlsoRejects(String ranges) {
    return 'also rejects $ranges';
  }

  @override
  String get searchAutoCleanActionSweep => 'archived';

  @override
  String get searchAutoCleanActionDelay => 'videos deferred';

  @override
  String get searchAutoCleanActionOff => 'left in range';

  @override
  String get searchAutoCleanBelowMinLabel => 'Below the range';

  @override
  String get searchAutoCleanAboveMaxLabel => 'Above the range';

  @override
  String get searchAutoCleanKeepMinLabel => 'Keep from (subscribers)';

  @override
  String get searchAutoCleanKeepMaxLabel => 'Keep up to (subscribers)';

  @override
  String get searchAutoCleanActionSweepOption => 'Archive it during the run';

  @override
  String get searchAutoCleanActionDelayOption =>
      'Keep it, fetch its videos later';

  @override
  String get searchAutoCleanActionOffOption => 'Treat it as in range';

  @override
  String get searchAutoCleanAnd => ' and ';

  @override
  String get searchAutoCleanSubscribersWord => 'subscribers';

  @override
  String get searchAutoCleanAvgViewsWord => 'median views';

  @override
  String searchAutoCleanUnder(String what, int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'under $valueString $what';
  }

  @override
  String searchAutoCleanOver(String what, int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'over $valueString $what';
  }

  @override
  String searchAutoCleanBetween(String what, int from, int to) {
    final intl.NumberFormat fromNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String fromString = fromNumberFormat.format(from);
    final intl.NumberFormat toNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String toString = toNumberFormat.format(to);

    return '$fromString–$toString $what';
  }

  @override
  String get searchAutoCleanBoundsHint =>
      'Leave a side of a range empty for an open end. With no range set at all, nothing is cleaned.';

  @override
  String get searchAutoCleanNeedsBound =>
      'Set at least one end of one range, or nothing will be cleaned.';

  @override
  String get searchAutoCleanScopeNote =>
      'Only channels the finished run itself found. A channel discovered by an earlier run, or one somebody has already looked at, is never touched.';

  @override
  String get searchAutoCleanGraceNote =>
      'Tagging only. The tagged channels are archived 7 days later, so removing the tag before then keeps them. Nothing is deleted automatically.';

  @override
  String searchAutoCleanRan(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Last run: $count channels tagged, archived in 7 days',
      one: 'Last run: 1 channel tagged, archived in 7 days',
      zero: 'Last run: nothing matched the ranges',
    );
    return '$_temp0';
  }

  @override
  String searchAutoCleanSkippedUnknown(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count more were left alone: no median views have been recorded for them, so they are in no range at all.',
      one:
          '1 more was left alone: no median views have been recorded for it, so it is in no range at all.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String get searchAutoCleanFailed =>
      'The automatic clean couldn\'t run. The search itself finished normally.';

  @override
  String get searchAutoCleanMinVideosLabel => 'Min videos (last 30 days)';

  @override
  String get searchAutoCleanMinVideosHint =>
      'Reject a channel that posted fewer than this many videos in the last 30 days. Leave blank to ignore how active a channel is.';

  @override
  String searchAutoCleanFewerVideos(int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'fewer than $valueString videos in 30 days';
  }

  @override
  String get dashboardAnalyticsTitle => 'Channel analytics';

  @override
  String get dashboardAnalyticsBody =>
      'Everything the pipeline has found, and what is in it. The filters only narrow what is shown and counted here — they change nothing and archive nothing. Min/Max are inclusive: a channel is shown when it sits at or inside every bound you set. Every figure below follows the filter.';

  @override
  String get dashboardAnalyticsFailed => 'Couldn\'t load the analytics.';

  @override
  String get dashboardAnalyticsNoChannels => 'No channel matches this filter.';

  @override
  String get dashboardAnalyticsFilterCountry => 'Country';

  @override
  String get dashboardAnalyticsFilterStage => 'Pipeline stage';

  @override
  String get dashboardAnalyticsFilterVetting => 'Vetting';

  @override
  String get dashboardAnalyticsFilterTag => 'Tag';

  @override
  String get dashboardAnalyticsFilterAny => 'Any';

  @override
  String get dashboardAnalyticsFilterMinSubs => 'Min subscribers';

  @override
  String get dashboardAnalyticsFilterMaxSubs => 'Max subscribers';

  @override
  String get dashboardAnalyticsFilterMinAvgViews => 'Min median views (30d)';

  @override
  String get dashboardAnalyticsFilterMaxAvgViews => 'Max median views (30d)';

  @override
  String get dashboardAnalyticsFilterMinVideos =>
      'Min videos uploaded last month';

  @override
  String get dashboardAnalyticsClearFilters => 'Clear filters';

  @override
  String get dashboardAnalyticsLegendLive => 'Live';

  @override
  String get dashboardAnalyticsLegendArchiveDue => 'Archive due';

  @override
  String get dashboardAnalyticsLegendArchived => 'Archived';

  @override
  String dashboardAnalyticsArchivedCount(String count) {
    return '+$count archived';
  }

  @override
  String dashboardAnalyticsArchivedValue(String value) {
    return '+$value archived';
  }

  @override
  String get dashboardAnalyticsArchivedViewsNote =>
      'Archived channels\' median views are taken over every stored video at archive time — a slightly wider span than the live 30-day figure.';

  @override
  String dashboardAnalyticsArchiveDueCount(String count) {
    return '-$count archive due';
  }

  @override
  String dashboardAnalyticsArchiveDueValue(String value) {
    return '-$value archive due';
  }

  @override
  String get dashboardAnalyticsStatChannels => 'Channels';

  @override
  String get dashboardAnalyticsStatMedianSubs => 'Median subscribers';

  @override
  String get dashboardAnalyticsStatMeanSubs => 'Mean subscribers';

  @override
  String get dashboardAnalyticsStatTotalSubs => 'Combined reach';

  @override
  String get dashboardAnalyticsStatFound => 'Found channels this month';

  @override
  String get dashboardAnalyticsStatUploads => 'Uploads this month';

  @override
  String get dashboardAnalyticsStatAvgViews => 'Median views (30d)';

  @override
  String get dashboardAnalyticsStatWithDeal => 'Have had a deal';

  @override
  String dashboardAnalyticsSubsCoverage(int known, int total) {
    return '$known of $total have a subscriber count';
  }

  @override
  String get dashboardAnalyticsMeanVsMedian =>
      'Subscriber counts are skewed: one large channel pulls the mean up, so the median is the one that describes a typical row.';

  @override
  String get dashboardAnalyticsChartTiers => 'Subscriber distribution';

  @override
  String get dashboardAnalyticsChartCountries => 'Countries';

  @override
  String get dashboardAnalyticsChartStages => 'Pipeline stage';

  @override
  String get dashboardAnalyticsChartVetting => 'Vetting';

  @override
  String get dashboardAnalyticsChartTags => 'Tags';

  @override
  String get dashboardAnalyticsChartDiscovered => 'Found per month';

  @override
  String get dashboardAnalyticsChartViewTiers => 'Median views distribution';

  @override
  String get dashboardAnalyticsToggleIndependent => 'Toggle independent scale';

  @override
  String dashboardAnalyticsViewsNote(int known, int total) {
    return '$known of $total have a measured 30-day median; the rest count as 0 under <10K. Same buckets as the subscriber chart above.';
  }

  @override
  String dashboardAnalyticsCountriesNote(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Top 12 by channel count. $count channels have no country recorded.',
      one: 'Top 12 by channel count. 1 channel has no country recorded.',
      zero: 'Top 12 by channel count.',
    );
    return '$_temp0';
  }

  @override
  String get dashboardAnalyticsTagsNote =>
      'A channel carrying two tags is counted under both, so these add up to more than the total.';

  @override
  String get dashboardAnalyticsUntagged => 'No tag';

  @override
  String get dashboardAnalyticsNothingHere => 'Nothing to draw yet.';

  @override
  String get navEmailLibrary => 'Email critique library';

  @override
  String get emailLibraryTitle => 'Email critique library';

  @override
  String get emailLibraryTabInfluencers => 'Influencers';

  @override
  String get emailLibraryTabBrands => 'Brands';

  @override
  String get emailLibraryNewRecord => 'New email record';

  @override
  String get emailLibraryNewRecordTitle => 'New email record';

  @override
  String get emailLibraryEditRecordTitle => 'Email record';

  @override
  String get emailLibraryManageTags => 'Manage tags';

  @override
  String get emailLibrarySearchHint =>
      'Search subject, body, context and critique';

  @override
  String get emailLibrarySourceAll => 'All';

  @override
  String get emailLibrarySourceVideo => 'From videos';

  @override
  String get emailLibrarySourceTestDraft => 'Test drafts';

  @override
  String get emailLibrarySourceAppDraft => 'My drafts';

  @override
  String get emailLibrarySourceMine => 'My examples';

  @override
  String get emailLibraryBadgeTestDraft => 'Test draft';

  @override
  String get emailLibraryBadgeAppDraft => 'My draft';

  @override
  String get emailLibraryBadgeMine => 'My example';

  @override
  String get emailLibraryVerdictGood => 'Good';

  @override
  String get emailLibraryVerdictBad => 'Bad';

  @override
  String get emailLibraryUnrated => 'Not rated';

  @override
  String get emailLibraryFieldVerdict => 'Verdict';

  @override
  String get emailLibraryVerdictWhyBad => 'Why is it bad?';

  @override
  String get emailLibraryVerdictWhyGood => 'What makes it good? (optional)';

  @override
  String get emailLibraryVerdictWhyHint =>
      'Good drafts become cases later skill versions must still pass. A bad one is drafted again with your reason, to check the fault is gone.';

  @override
  String get emailLibraryVerdictWhyRequired =>
      'Say what\'s wrong, so the next run knows what to look for.';

  @override
  String emailLibraryBenchImported(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count test drafts',
      one: '1 test draft',
    );
    return '$_temp0 imported from the last bench run.';
  }

  @override
  String get emailLibraryMyExample => 'My example';

  @override
  String get emailLibraryMyExampleHint =>
      'One of your own emails that worked. The skill factory reads it as an example, never as wording to copy.';

  @override
  String emailLibraryKnobs(String knobs) {
    return 'Written for: $knobs';
  }

  @override
  String get emailLibraryClearFilters => 'Clear filters';

  @override
  String get emailLibrarySortLastEdited => 'Last edited';

  @override
  String get emailLibrarySortLastCreated => 'Last created';

  @override
  String get emailLibrarySortVideoDate => 'Video date';

  @override
  String get emailLibraryEmpty =>
      'Nothing here yet. Add the first email and what the expert said about it.';

  @override
  String get emailLibraryNoMatches => 'No records match this filter.';

  @override
  String get emailLibraryLoadFailed => 'Could not read the local library.';

  @override
  String get emailLibraryUnavailable =>
      'There is no local email critique library on this machine.';

  @override
  String get emailLibraryUnavailableDetail =>
      'The library is a single file, data/database/email_library.db, next to the pipeline\'s own database. It is only available in the installed desktop app. If you are on desktop and still see this, check Settings -> Search Tuning -> Project root.';

  @override
  String get emailLibraryFieldVideoDate => 'Video date';

  @override
  String get emailLibraryNoDate => 'No date';

  @override
  String get emailLibraryVideoDateDay => 'Day';

  @override
  String get emailLibraryVideoDateMonth => 'Month';

  @override
  String get emailLibraryVideoDateYear => 'Year';

  @override
  String get emailLibraryFieldVideoUrl => 'Video URL';

  @override
  String get emailLibraryVideoUrlHint => 'Link to the training video';

  @override
  String get emailLibraryFieldTimecode => 'Timecode';

  @override
  String get emailLibraryTimecodeHint => '1:05:30';

  @override
  String get emailLibraryTimecodeInvalid =>
      'Use h:mm:ss, m:ss, or plain seconds.';

  @override
  String get emailLibraryTimecodeHours => 'Hours';

  @override
  String get emailLibraryTimecodeMinutes => 'Minutes';

  @override
  String get emailLibraryTimecodeSeconds => 'Seconds';

  @override
  String get emailLibraryTimecodeScrollHint =>
      'Scroll or use the arrow keys over a box to change it.';

  @override
  String get emailLibraryOpenAtTimecode => 'Open the video at this point';

  @override
  String get emailLibraryOpenVideo => 'Open the source video';

  @override
  String get emailLibraryOpenFailed => 'Could not open that link.';

  @override
  String get emailLibraryFieldStage => 'Stage';

  @override
  String get emailLibraryFieldNiche => 'Niches';

  @override
  String get emailLibraryNicheSearchHint => 'Search niches';

  @override
  String get emailLibraryNoNicheTags => 'No tags yet. Use + to add one.';

  @override
  String get emailLibraryFieldContext => 'Context';

  @override
  String get emailLibraryContextHint =>
      'Who it was written to, and what had happened before it';

  @override
  String get emailLibraryFieldSubject => 'Subject';

  @override
  String get emailLibraryFieldBody => 'Email body';

  @override
  String get emailLibraryBodyHint =>
      'Paste the email exactly as it was written';

  @override
  String get emailLibraryFieldCritique => 'Expert critique';

  @override
  String get emailLibraryCritiqueHint =>
      'What the expert said about it, and why';

  @override
  String get emailLibraryAddTag => 'Add tag';

  @override
  String get emailLibraryAddStageTag => 'New stage tag';

  @override
  String get emailLibraryAddNicheTag => 'New niche tag';

  @override
  String get emailLibraryTagLabel => 'Label';

  @override
  String get emailLibraryTagLabelHelp =>
      'An existing tag with this name is reused.';

  @override
  String get emailLibraryQuotedToContext => 'Added to the context note.';

  @override
  String get emailLibraryAddKeyword => 'Add a keyword';

  @override
  String emailLibraryAddKeywordNamed(String keyword) {
    return 'Add \"@$keyword\"';
  }

  @override
  String get emailLibraryAddPlaceholderTag => 'New keyword';

  @override
  String get emailLibraryPlaceholderHelp =>
      'One word. Spaces become underscores, so it can be typed back as @word.';

  @override
  String get emailLibrarySaveAndAnother => 'Save & add another';

  @override
  String get emailLibrarySaved => 'Saved.';

  @override
  String get emailLibrarySaveFailed => 'Could not save to the local library.';

  @override
  String get emailLibraryNothingToSave => 'Nothing typed yet.';

  @override
  String get emailLibraryDiscardTitle => 'Discard this record?';

  @override
  String get emailLibraryDiscardBody =>
      'What is typed here has not been saved.';

  @override
  String get emailLibraryDiscard => 'Discard';

  @override
  String get emailLibraryDeleteTitle => 'Delete this record?';

  @override
  String get emailLibraryDeleteBody =>
      'The email and its critique are removed from the local library. This cannot be undone.';

  @override
  String get emailLibraryNoSubject => 'No subject';

  @override
  String get emailLibraryRenameTag => 'Rename';

  @override
  String emailLibraryTagUsage(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'On $count records',
      one: 'On 1 record',
      zero: 'On no records',
    );
    return '$_temp0';
  }

  @override
  String emailLibraryDeleteTagTitle(String label) {
    return 'Delete \"$label\"?';
  }

  @override
  String emailLibraryDeleteTagBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'It is removed from $count records as well.',
      one: 'It is removed from 1 record as well.',
      zero: 'No records use this tag.',
    );
    return '$_temp0';
  }

  @override
  String get logsActionReplyReceived => 'Reply received';

  @override
  String get outreachSendWithGmail => 'Send with Gmail';

  @override
  String get outreachSendingWithGmail => 'Sending…';

  @override
  String outreachGmailSentAs(String account) {
    return 'Sent from $account.';
  }

  @override
  String outreachGmailSentWithFollowUps(String account, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups are queued',
      one: '1 follow-up is queued',
    );
    return 'Sent from $account. $_temp0 — cancelled the moment they reply.';
  }

  @override
  String outreachGmailSendFailed(String reason) {
    return 'Couldn’t send: $reason';
  }

  @override
  String outreachGmailNotEmail(String method) {
    return 'The mailbox sends email. Use the copy and open actions for $method.';
  }

  @override
  String get outreachGmailNotConnected =>
      'No outreach mailbox is connected on this machine.';

  @override
  String get outreachGmailConnectAction => 'Connect one';

  @override
  String get outreachGmailReconnectAction => 'Reconnect';

  @override
  String get outreachGmailSendUnavailableHint =>
      'Connect a mailbox in Settings to send from inside the app. Until then, the mail-app hand-off still works.';

  @override
  String get outreachFollowUpBodyLabel => 'Follow-up message';

  @override
  String get outreachCheckReplies => 'Check for replies';

  @override
  String get outreachCheckingReplies => 'Checking the mailbox…';

  @override
  String get outreachNoNewReplies => 'No new replies.';

  @override
  String outreachRepliesApplied(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count new replies',
      one: '1 new reply',
    );
    return '$_temp0 recorded.';
  }

  @override
  String outreachRepliesAppliedWithCancels(int replies, int cancelled) {
    String _temp0 = intl.Intl.pluralLogic(
      replies,
      locale: localeName,
      other: '$replies new replies',
      one: '1 new reply',
    );
    String _temp1 = intl.Intl.pluralLogic(
      cancelled,
      locale: localeName,
      other: '$cancelled queued follow-ups cancelled',
      one: '1 queued follow-up cancelled',
    );
    return '$_temp0 recorded, $_temp1.';
  }

  @override
  String outreachFollowUpsSentNote(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups went out',
      one: '1 follow-up went out',
    );
    return '$_temp0.';
  }

  @override
  String outreachMarkedInterested(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count channels moved to Interested',
      one: '1 channel moved to Interested',
    );
    return '$_temp0.';
  }

  @override
  String outreachSweepFailed(String reason) {
    return 'Couldn’t check the mailbox: $reason';
  }

  @override
  String outreachQueuedFollowUps(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups queued',
      one: '1 follow-up queued',
      zero: 'No follow-ups queued',
    );
    return '$_temp0';
  }

  @override
  String get outreachCancelFollowUps => 'Cancel the queued follow-ups';

  @override
  String outreachFollowUpsCancelled(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups cancelled',
      one: '1 follow-up cancelled',
      zero: 'Nothing was queued',
    );
    return '$_temp0.';
  }

  @override
  String get settingsMailboxTitle => 'Outreach mailbox';

  @override
  String get settingsMailboxSubtitle =>
      'The Gmail account outreach is sent from, and the follow-ups waiting behind it. Set up per machine — whoever runs the pipeline sends the mail.';

  @override
  String settingsMailboxConnectedAs(String account) {
    return 'Connected as $account';
  }

  @override
  String get settingsMailboxNotConnected => 'No mailbox connected';

  @override
  String settingsMailboxLabelledAs(String label) {
    return 'Sent mail is labelled “$label”';
  }

  @override
  String get settingsMailboxConnectHint =>
      'Connect the Gmail account outreach is sent from. A browser window opens for you to sign in as that address.';

  @override
  String get settingsMailboxSignIn => 'Sign in';

  @override
  String get settingsMailboxAddAnother => 'Add another mailbox';

  @override
  String get settingsMailboxConnecting => 'Waiting for browser…';

  @override
  String get settingsMailboxConnectingHint =>
      'Finish signing in in the browser window that just opened.';

  @override
  String get settingsMailboxConnected => 'Mailbox connected.';

  @override
  String get settingsMailboxSignOut => 'Sign out';

  @override
  String get settingsMailboxSignedOut => 'Mailbox signed out on this machine.';

  @override
  String settingsMailboxSignedOutOf(String account) {
    return 'Signed out of $account.';
  }

  @override
  String get settingsMailboxSignOutTitle => 'Sign out of this mailbox?';

  @override
  String get settingsMailboxSignOutBody =>
      'This machine stops sending outreach and following up until a mailbox is connected again. The Google account keeps its access until you revoke it at myaccount.google.com/permissions.';

  @override
  String settingsMailboxSignOutTitleFor(String account) {
    return 'Sign out of $account?';
  }

  @override
  String settingsMailboxSignOutBodyFor(String account) {
    return 'This machine stops sending outreach as $account and following up on its conversations until it is connected again. The Google account keeps its access until you revoke it at myaccount.google.com/permissions.';
  }

  @override
  String get settingsMailboxTokenExpiryNote =>
      'While the Google app is in Testing mode the connection lapses after seven days — sign in again to renew it.';

  @override
  String get settingsMailboxRefresh => 'Refresh';

  @override
  String get settingsMailboxTestSend => 'Send a test email';

  @override
  String settingsMailboxTestSent(String to) {
    return 'Test message sent to $to.';
  }

  @override
  String settingsMailboxCountersSent(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count messages sent',
      one: '1 message sent',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxCountersAwaiting(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count awaiting a reply',
      one: '1 awaiting a reply',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxCountersQueued(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups queued',
      one: '1 follow-up queued',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxFailedSteps(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count follow-ups gave up after repeated failures',
      one: '1 follow-up gave up after repeated failures',
    );
    return '$_temp0';
  }

  @override
  String get settingsMailboxDesktopOnly =>
      'Sending is done by the installed desktop app on the machine that runs the pipeline.';

  @override
  String get settingsMailboxAccountsRowTitle => 'Signed in';

  @override
  String settingsMailboxCapLine(int cap, int left) {
    return '$cap cold emails a day · $left left today';
  }

  @override
  String settingsMailboxWarmupWarming(int days) {
    return 'Warming up: day $days of at least 14';
  }

  @override
  String settingsMailboxWarmupDone(int days) {
    return 'Warmed up $days days';
  }

  @override
  String get settingsMailboxWarmupNotSet => 'Warm-up start not set';

  @override
  String get settingsMailboxEditLimits => 'Daily cap and warm-up';

  @override
  String settingsMailboxLimitsTitle(String account) {
    return 'Daily cap and warm-up for $account';
  }

  @override
  String settingsMailboxCapLabel(int cap) {
    return 'Cold emails a day: $cap';
  }

  @override
  String get settingsMailboxCapHelp =>
      '35 is the house default; anywhere from 10 to 50. Replies to people who wrote back never count.';

  @override
  String get settingsMailboxWarmupLabel => 'Warm-up started on';

  @override
  String get settingsMailboxWarmupHelp =>
      'The warm-up itself runs in Instantly. 14 days is the minimum before cold email; 30 to 90 is better.';

  @override
  String get settingsMailboxWarmupPick => 'Pick a date';

  @override
  String get settingsMailboxWarmupClear => 'Clear date';

  @override
  String get settingsMailboxLimitsSaved =>
      'Saved. The next send uses the new limits.';

  @override
  String get settingsAgencyTitle => 'Agency facts';

  @override
  String get settingsAgencySubtitle =>
      'What the drafting engine may say about the agency, who it refuses to work with, and the team\'s daily target. Shared with the whole team.';

  @override
  String get settingsAgencyName => 'Agency name';

  @override
  String get settingsAgencySender => 'Who signs the emails';

  @override
  String get settingsAgencyWhatWeDo => 'What we do';

  @override
  String get settingsAgencyWebsite => 'Website';

  @override
  String get settingsAgencyTrueClaims => 'True claims';

  @override
  String get settingsAgencyTrueClaimsHelp =>
      'One fact per line. The engine only claims what is here, in its own words, and only when it answers something.';

  @override
  String get settingsAgencyPastCampaigns => 'Past campaigns';

  @override
  String get settingsAgencyPastCampaignsHelp =>
      'One per line, for example the brand and the creator.';

  @override
  String get settingsAgencyIncubator =>
      'We are part of a group of experienced agency owners who review our work';

  @override
  String get settingsAgencyIncubatorHelp =>
      'Only if it is true. The engine uses it only as a last resort.';

  @override
  String get settingsAgencyBoycottSection => 'Boycott';

  @override
  String get settingsAgencyBoycottCountries => 'Boycotted countries';

  @override
  String get settingsAgencyBoycottCountriesHelp =>
      'Two-letter country codes, separated by commas. A brand from one of these gets no pitch and no creator.';

  @override
  String get settingsAgencyBoycottBrands => 'Boycotted brands';

  @override
  String get settingsAgencyBoycottBrandsHelp =>
      'One brand per line, including brands that support the occupation of Palestine.';

  @override
  String get settingsAgencyCountryInvalid =>
      'Use two-letter country codes, like IL.';

  @override
  String get settingsAgencyDailyTarget => 'Good emails a day (team target)';

  @override
  String get settingsAgencyDailyTargetInvalid =>
      'Enter a whole number from 1 to 500.';

  @override
  String get settingsAgencySaved => 'Agency facts saved for the team.';

  @override
  String get creatorPrescreenTitle => 'Pre-screen';

  @override
  String creatorPrescreenViewsMet(String views) {
    return '$views median views in 30 days, meets the ~50K bar';
  }

  @override
  String creatorPrescreenViewsBelow(String views) {
    return '$views median views in 30 days, under the ~50K bar';
  }

  @override
  String get creatorPrescreenViewsUnknown => 'Views not measured yet';

  @override
  String creatorPrescreenUploads(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count uploads in the last 30 days',
      one: '1 upload in the last 30 days',
      zero: 'No uploads in the last 30 days',
    );
    return '$_temp0';
  }

  @override
  String creatorPrescreenSponsored(int percent) {
    return 'Sponsorship disclosures in $percent% of the stored videos';
  }

  @override
  String get creatorPrescreenNotSponsored =>
      'No sponsorship disclosures in the stored videos';

  @override
  String get creatorPrescreenSponsorUnknown =>
      'Videos not read for sponsorships yet';

  @override
  String creatorPrescreenBrands(String brands) {
    return 'Seen with: $brands';
  }

  @override
  String creatorPrescreenCountry(String country) {
    return 'Country: $country';
  }

  @override
  String get creatorPrescreenCountryUnknown => 'Country not listed';

  @override
  String get creatorPrescreenAgent =>
      'Has an agent: take the discount path, buy below their ask and sell at it.';

  @override
  String get creatorGoldMine => 'Gold mine';

  @override
  String get creatorGoldMineHelp =>
      'No agent, and strong views or engagement for their size. Start with discounted deals; after 2-3 deals that prove we deliver, a person may propose exclusive management at 20-40% (about 25% to start).';

  @override
  String get creatorFlagLabel => 'Creator';

  @override
  String get creatorFlagNotRecorded => 'Not recorded';

  @override
  String get creatorFlagMale => 'Male';

  @override
  String get creatorFlagFemale => 'Female';

  @override
  String get creatorFlagCouple => 'Couple';

  @override
  String get creatorFlagUnknown => 'Can\'t tell';

  @override
  String get creatorFlagOutOfScope =>
      'Out of scope: the agency does not contact or pitch female creators or couple channels.';

  @override
  String get creatorFlagSaved => 'Creator flag saved.';

  @override
  String get mediaKitTitle => 'Media kit';

  @override
  String get mediaKitEdit => 'Edit media kit';

  @override
  String get mediaKitEmpty =>
      'No media kit yet. Ask the creator for their audience analytics (top countries, age) and their rates.';

  @override
  String get mediaKitReady => 'Ready to pitch';

  @override
  String get mediaKitNotReady => 'Not ready to pitch yet';

  @override
  String mediaKitAudienceShare(String share) {
    return '$share% of the audience in the US, UK and Canada';
  }

  @override
  String get mediaKitGapAnalytics =>
      'Missing: audience analytics (top countries and age band)';

  @override
  String get mediaKitGapRate => 'Missing: a rate agreed with the creator';

  @override
  String get mediaKitGapAudience =>
      'Under 20% of the audience in the US, UK and Canada, too little even in tech';

  @override
  String get mediaKitGapOutOfScope => 'Out of scope: female or couple channel';

  @override
  String mediaKitCountriesLine(String countries) {
    return 'Top countries: $countries';
  }

  @override
  String mediaKitAgeLine(String age) {
    return 'Main age band: $age';
  }

  @override
  String mediaKitEngagementLine(String rate) {
    return 'Engagement: $rate%';
  }

  @override
  String mediaKitLinkLine(String link) {
    return 'Kit: $link';
  }

  @override
  String mediaKitRateAgreed(String format, String price) {
    return '$format: $price, agreed';
  }

  @override
  String mediaKitRateAsking(String format, String price) {
    return '$format: $price, asking';
  }

  @override
  String get mediaKitCountriesLabel => 'Top countries';

  @override
  String get mediaKitCountryCode => 'Country code';

  @override
  String get mediaKitShare => 'Share (%)';

  @override
  String get mediaKitAddCountry => 'Add a country';

  @override
  String get mediaKitAgeBand => 'Main age band';

  @override
  String get mediaKitAgeBandHint => 'e.g. 18-34';

  @override
  String get mediaKitEngagement => 'Engagement (%)';

  @override
  String get mediaKitLink => 'Media kit link';

  @override
  String get mediaKitRatesLabel => 'Rate card (USD)';

  @override
  String get mediaKitFormat => 'Format';

  @override
  String get mediaKitPrice => 'Price';

  @override
  String get mediaKitAgreed => 'Agreed with the creator';

  @override
  String get mediaKitAddRate => 'Add a rate';

  @override
  String get mediaKitRemoveRow => 'Remove';

  @override
  String get mediaKitInvalidCode => 'Two letters';

  @override
  String get mediaKitInvalidNumber => 'A number';

  @override
  String get mediaKitSaved => 'Media kit saved.';

  @override
  String get influencerFilterShowOnly => 'Show only';

  @override
  String get influencerFilterHasEmail => 'Has an email';

  @override
  String get influencerFilterSponsored => 'Sponsored before';

  @override
  String get influencerFilterShortlisted => 'Shortlisted';

  @override
  String get influencerFilterReadyToPitch => 'Ready to pitch';

  @override
  String get influencerFilterNeverContacted => 'Never contacted';

  @override
  String get influencerContextMenuShortlist => 'Shortlist';

  @override
  String get influencerContextMenuUnshortlist => 'Remove from shortlist';

  @override
  String get influencerContextMenuAddToCampaign => 'Add to campaign';

  @override
  String get influencerContextMenuNoCampaigns =>
      'No active campaign to add to. Create one from a brand first.';

  @override
  String influencerContextMenuAddedToCampaign(String campaign) {
    return 'Added to $campaign.';
  }

  @override
  String influencerContextMenuAddedNotReady(String campaign) {
    return 'Added to $campaign, but not ready to pitch yet: get their audience analytics and an agreed rate before the proposal goes out.';
  }

  @override
  String get commonClose => 'Close';

  @override
  String get navRailCollapse => 'Show icons only';

  @override
  String get navRailExpand => 'Show labels';

  @override
  String get outreachHideThreadList => 'Hide the conversation list';

  @override
  String get outreachShowThreadList => 'Show the conversation list';

  @override
  String get outreachDeleteThread => 'Delete conversation';

  @override
  String get outreachDeleteThreadConfirm =>
      'This removes the conversation and every message in it, for everyone. A later reply to it will arrive with no conversation to attach to.';

  @override
  String get outreachThreadDeleted => 'Conversation deleted.';

  @override
  String get outreachDeleteMessage => 'Delete message';

  @override
  String get outreachDeleteMessageConfirm =>
      'This removes the record of this message. A message that really went out is not recalled by deleting it here.';

  @override
  String get outreachMessageDeleted => 'Message deleted.';

  @override
  String get outreachCopyAiBrief => 'Copy brief for AI';

  @override
  String get outreachAiBriefCopied =>
      'Channel brief and prompt copied — paste it into your AI.';

  @override
  String get outreachBriefDialogTitle => 'Brief for AI';

  @override
  String get outreachBriefDialogSubtitle =>
      'Everything the AI is given about this channel — and what it is asked to do with it. It is already on your clipboard.';

  @override
  String get outreachBriefCopyAgain => 'Copy again';

  @override
  String get outreachBriefPromptSection => 'What the AI is asked to do';

  @override
  String get outreachBriefSectionChannel => 'Channel';

  @override
  String get outreachBriefSectionAudience => 'Audience';

  @override
  String get outreachBriefSectionLatestUpload => 'Latest upload';

  @override
  String get outreachBriefSectionRecentUploads => 'Recent uploads';

  @override
  String get outreachBriefSectionFit => 'Why this channel';

  @override
  String get outreachBriefSectionDraft => 'Drafting with';

  @override
  String get outreachBriefSectionOther => 'Also included';

  @override
  String get outreachBriefFieldChannelName => 'Name';

  @override
  String get outreachBriefFieldChannelHandle => 'Handle';

  @override
  String get outreachBriefFieldContactName => 'Contact';

  @override
  String get outreachBriefFieldCountry => 'Country';

  @override
  String get outreachBriefFieldChannelUrl => 'Channel link';

  @override
  String get outreachBriefFieldChannelDescription => 'Description';

  @override
  String get outreachBriefFieldSubscriberCount => 'Subscribers';

  @override
  String get outreachBriefFieldMedianViews => 'Median views';

  @override
  String get outreachBriefFieldLastVideoTitle => 'Title';

  @override
  String get outreachBriefFieldLastVideoPublishedAt => 'Published';

  @override
  String get outreachBriefFieldLastVideoViews => 'Views';

  @override
  String get outreachBriefFieldLastVideoUrl => 'Link';

  @override
  String get outreachBriefFieldLastVideoDescription => 'Description';

  @override
  String get outreachBriefFieldRecentVideoTitles => 'Titles';

  @override
  String get outreachBriefFieldRelevanceCriteria => 'Relevance criteria';

  @override
  String get outreachBriefFieldNotes => 'Notes';

  @override
  String get outreachBriefFieldSenderName => 'Sending as';

  @override
  String get outreachBriefFieldWritingRules => 'Writing rules';

  @override
  String get outreachBriefFieldTemplateName => 'Template';

  @override
  String get outreachBriefFieldTemplateSubject => 'Template subject';

  @override
  String get outreachBriefFieldTemplateBody => 'Template body';

  @override
  String get outreachBriefThin =>
      'Almost nothing is recorded for this channel, so the draft has almost nothing to work with. Adding notes, relevance criteria or fresh uploads is what makes the difference here.';

  @override
  String get videoCatchUpTitle => 'Filling in missing videos';

  @override
  String get videoCatchUpWhat =>
      'Channels found by earlier searches that never had their recent uploads read. This runs quietly in the background so their median views fill in, and steps aside the moment you start a search.';

  @override
  String videoCatchUpProgress(String read, String saved, String total) {
    return '$read read · $saved saved of $total';
  }

  @override
  String get videoCatchUpStarting =>
      'Counting how many channels are still missing videos…';

  @override
  String videoCatchUpEta(String rate, String timeLeft) {
    return '≈ $rate channels/min · about $timeLeft left';
  }

  @override
  String get videoCatchUpResumeNote =>
      'Progress is saved as it goes — closing the app or starting a search won\'t lose it; the next run carries on from here.';

  @override
  String videoCatchUpCurrentChannel(String handle) {
    return 'Now reading $handle';
  }

  @override
  String videoCatchUpSharing(String shared, String total) {
    return 'Sharing finished channels with the team — $shared of $total uploaded. Reading resumes when this is done.';
  }

  @override
  String get videoCatchUpLayerReading => 'Uploads read';

  @override
  String get videoCatchUpLayerFetching => 'Details saved';

  @override
  String videoCatchUpDone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Filled in $count channels — done for now',
      one: 'Filled in 1 channel — done for now',
      zero: 'Nothing left to fill in',
    );
    return '$_temp0';
  }

  @override
  String videoCatchUpPaused(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Paused after $count channel(s) so the pipeline is free — it picks up where it left off',
      zero: 'Paused so the pipeline is free — it picks up where it left off',
    );
    return '$_temp0';
  }

  @override
  String get videoCatchUpFailed =>
      'Stopped early. Nothing is lost — it tries again on its own.';

  @override
  String channelArrivalsFromSearch(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count new channels just arrived from the search running on this computer',
      one:
          '1 new channel just arrived from the search running on this computer',
    );
    return '$_temp0';
  }

  @override
  String channelArrivalsFromTeam(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count new channels just arrived from the team\'s shared data',
      one: '1 new channel just arrived from the team\'s shared data',
    );
    return '$_temp0';
  }

  @override
  String get channelArrivalsDismiss => 'Dismiss';

  @override
  String searchResumedNotice(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Picked up last session\'s interrupted search — $count keywords left',
      one: 'Picked up last session\'s interrupted search — 1 keyword left',
    );
    return '$_temp0';
  }

  @override
  String get searchResumedAction => 'View';

  @override
  String get dashboardKeywordsTitle => 'Keyword evaluation';

  @override
  String get dashboardKeywordsBody =>
      'Every keyword the pipeline has searched, and how watched the channels it brought in are. Each channel sits in a tier by its trailing-30-day median views.';

  @override
  String get dashboardKeywordsFilterHint => 'Filter keywords';

  @override
  String get dashboardKeywordsSortLabel => 'Sort by';

  @override
  String get dashboardKeywordsSortWeighted => 'Tier-weighted score';

  @override
  String get dashboardKeywordsSortChannels => 'Channel count';

  @override
  String get dashboardKeywordsSortMedian => 'Median views';

  @override
  String get dashboardKeywordsSortHighestFirst =>
      'Highest first — tap for lowest';

  @override
  String get dashboardKeywordsSortLowestFirst =>
      'Lowest first — tap for highest';

  @override
  String get dashboardKeywordsEmpty =>
      'No keyword has brought in a measured channel yet.';

  @override
  String get dashboardKeywordsScoreCaption => 'score';

  @override
  String dashboardKeywordsRowSummary(String channels, String views) {
    return '$channels ch · ~$views vid';
  }

  @override
  String dashboardKeywordsShowingCount(int shown, int total) {
    return 'Showing $shown of $total';
  }

  @override
  String dashboardKeywordsSheetSummary(String score, int channels) {
    return 'Tier-weighted score $score · $channels channels measured';
  }

  @override
  String get dashboardKeywordsTierOver1m => '1M+ median views';

  @override
  String get dashboardKeywordsTier250kTo1m => '250K–1M median views';

  @override
  String get dashboardKeywordsTier50kTo250k => '50K–250K median views';

  @override
  String get dashboardKeywordsTierUnder50k => 'Under 50K median views';

  @override
  String get navScratchpad => 'Scratchpad';

  @override
  String get scratchpadYouTab => 'you';

  @override
  String get scratchpadNoTeammates =>
      'No teammates yet — once people sign in, each gets a tab here.';

  @override
  String get scratchpadOthersReadOnly =>
      'Read-only. You can only edit your own box.';

  @override
  String get scratchpadHint =>
      'Shared with the team. Saves a moment after you stop typing.';

  @override
  String get scratchpadLastSaved => 'Last saved';

  @override
  String get scratchpadLastSyncedHere => 'This device last synced';

  @override
  String get scratchpadNever => 'never';

  @override
  String get scratchpadSyncLog => 'Sync log (this device)';

  @override
  String get scratchpadLoadFailed => 'Couldn\'t load the scratchpad.';

  @override
  String get scratchpadRetry => 'Try again';

  @override
  String get scratchpadEmptyBox => 'Nothing here yet.';

  @override
  String get settingsMergeTitle => 'Databases needing manual merge';

  @override
  String get settingsMergeSubtitle =>
      'When a new build ships a rebuilt database, this machine\'s older copy is set aside rather than deleted. The current copy is in use; the old one waits in the folder below for you to merge anything you still need.';

  @override
  String get settingsMergeThisDevice => 'This device';

  @override
  String get settingsMergeAcrossTeam => 'Across the team';

  @override
  String get settingsMergeNoneThisDevice =>
      'Nothing on this device needs merging.';

  @override
  String settingsMergePendingCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count files need merging',
      one: '1 file needs merging',
    );
    return '$_temp0';
  }

  @override
  String settingsMergeSetAside(String when) {
    return 'Set aside $when';
  }

  @override
  String settingsMergeFromRelease(String note) {
    return 'From: $note';
  }

  @override
  String get settingsMergeOpenFolder => 'Open folder';

  @override
  String get settingsMergeMarkResolved => 'Mark resolved';

  @override
  String get settingsMergeRefresh => 'Refresh';

  @override
  String get settingsMergeResolveTitle => 'Mark this merge resolved?';

  @override
  String settingsMergeResolveBody(String name) {
    return 'You\'ve merged anything you need from the set-aside copy of $name. Delete that copy now, or keep it in the folder just in case.';
  }

  @override
  String get settingsMergeResolveKeepFile => 'Keep file';

  @override
  String get settingsMergeResolveDeleteFile => 'Delete file';

  @override
  String get settingsMergeCancel => 'Cancel';

  @override
  String get settingsMergeTeamNobody =>
      'No one on the team has a database waiting to be merged.';

  @override
  String settingsMergeTeamUpdated(String when) {
    return 'Updated $when';
  }

  @override
  String get settingsMergeYou => 'you';

  @override
  String get settingsMergeLoadFailed => 'Couldn\'t read the merge status.';

  @override
  String get templatePerfSectionTitle => 'Performance';

  @override
  String templatePerfUsage(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Sent $count times',
      one: 'Sent once',
      zero: 'Not sent yet',
    );
    return '$_temp0';
  }

  @override
  String templatePerfReplyRate(String percent) {
    return '$percent% replied';
  }

  @override
  String get templatePerfNoRepliesYet => 'No replies yet';

  @override
  String templatePerfAvgReplyDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Avg. reply: $days days',
      one: 'Avg. reply: 1 day',
    );
    return '$_temp0';
  }

  @override
  String templatePerfAvgReplyHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: 'Avg. reply: $hours hours',
      one: 'Avg. reply: 1 hour',
    );
    return '$_temp0';
  }

  @override
  String templatePerfAvgReplyMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Avg. reply: $minutes minutes',
      one: 'Avg. reply: 1 minute',
    );
    return '$_temp0';
  }

  @override
  String workingDaysSuggestionText(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Pipeline suggests: $count working days, based on deal created → last updated',
      one:
          'Pipeline suggests: 1 working day, based on deal created → last updated',
    );
    return '$_temp0';
  }

  @override
  String get workingDaysSuggestionUseThis => 'Use this';

  @override
  String get workingDaysSuggestionApplied => 'Working days estimate updated.';

  @override
  String get workingDaysSuggestionFieldHint => 'e.g. 6';

  @override
  String get contactDiscoveryScanAction => 'Scan for contacts';

  @override
  String get contactDiscoverySuggestionsTitle => 'Found in the description';

  @override
  String get contactDiscoveryNoneFound =>
      'No likely contacts found in the description.';

  @override
  String get contactDiscoveryBusinessInquiry => 'Business inquiry';

  @override
  String get contactDiscoveryAddSuggestion => 'Add this contact';

  @override
  String get onboardingWizardTitle => 'Let\'s get this machine set up';

  @override
  String get onboardingWizardSubtitle =>
      'Five things worth checking once. Fix what you can right here, or skip anything and handle it later in Settings.';

  @override
  String get onboardingStepStatusDone => 'Done';

  @override
  String get onboardingStepStatusPending => 'Needs a look';

  @override
  String get onboardingSignInStepTitle => 'Sign in';

  @override
  String get onboardingSignInStepSubtitle =>
      'This machine reaches the team\'s shared data through your account.';

  @override
  String onboardingSignInDoneDetail(String email) {
    return 'Signed in as $email.';
  }

  @override
  String get onboardingSignInPendingDetail =>
      'Not signed in on this machine yet.';

  @override
  String get onboardingPythonStepTitle => 'Python & pipeline';

  @override
  String get onboardingPythonStepSubtitle =>
      'Where this machine looks for the scraper, and which Python interpreter runs it.';

  @override
  String get onboardingPythonDoneDetail =>
      'A pipeline location was found for this machine.';

  @override
  String get onboardingPythonPendingDetail =>
      'Searching isn\'t run from this build, so there\'s nothing to check here.';

  @override
  String get onboardingMailboxStepTitle => 'Outreach mailbox';

  @override
  String get onboardingMailboxStepSubtitle =>
      'Connect the Gmail account this machine sends outreach from.';

  @override
  String get onboardingMailboxDoneDetail =>
      'A mailbox is connected and ready to send.';

  @override
  String get onboardingMailboxPendingDetail => 'No mailbox connected yet.';

  @override
  String get onboardingTimeZoneStepTitle => 'Time zone';

  @override
  String get onboardingTimeZoneStepSubtitle =>
      'Every date and time in the app is shown in this zone.';

  @override
  String get onboardingTimeZoneDoneDetail =>
      'Matches this device\'s own time zone.';

  @override
  String get onboardingTimeZonePendingDetail =>
      'Doesn\'t match this device\'s time zone.';

  @override
  String get onboardingAwsStepTitle => 'AWS setup';

  @override
  String get onboardingAwsStepSubtitle =>
      'Connect the AWS access key this machine\'s pipeline runs searches through.';

  @override
  String get onboardingAwsDoneDetail =>
      'AWS credentials are saved for this account.';

  @override
  String get onboardingAwsPendingDetail => 'No AWS credentials saved yet.';

  @override
  String get onboardingFinishButton => 'Continue to the app';

  @override
  String get onboardingSkipToSettingsButton =>
      'Skip — handle this later in Settings';

  @override
  String get fullBismillah => 'Bismillah Ar-Rahman Ar-Raheem';

  @override
  String get shortBismillah => 'Bismillah';

  @override
  String get fullSalam => 'As-Salamu \'Alaykum Wa-rahmatullahi Wa-barakatuh';

  @override
  String get shortSalam => 'As-Salamu \'Alaykum';

  @override
  String get teamDashboardNavLabel => 'Team';

  @override
  String get teamDashboardTitle => 'Team performance';

  @override
  String teamDashboardWeekRange(String start, String end) {
    return '$start – $end';
  }

  @override
  String get teamDashboardPreviousWeek => 'Previous week';

  @override
  String get teamDashboardNextWeek => 'Next week';

  @override
  String get teamDashboardThisWeek => 'This week';

  @override
  String get teamDashboardColumnMember => 'Team member';

  @override
  String get teamDashboardColumnMessagesSent => 'Messages sent';

  @override
  String get teamDashboardColumnRepliesReceived => 'Replies received';

  @override
  String get teamDashboardColumnReplyRate => 'Reply rate';

  @override
  String get teamDashboardColumnMedianResponse => 'Median first response';

  @override
  String get teamDashboardNoData => '—';

  @override
  String get teamDashboardEmptyState =>
      'No outreach activity recorded for this week.';

  @override
  String get teamDashboardAttributionNote =>
      'Replies received and first-response time are credited to whoever sent the message being replied to — outreach_messages itself doesn\'t record a sender, so this is inferred from the activity log rather than stored directly.';

  @override
  String get teamDashboardDealsSummaryTitle => 'Team deals this week';

  @override
  String get teamDashboardDealsClosedLabel => 'Deals closed';

  @override
  String get teamDashboardMarginClosedLabel => 'Margin closed';

  @override
  String get teamDashboardDealsCaveat =>
      'Not broken out per person: no record in the database says who moved a deal\'s stage, only that it changed.';

  @override
  String teamDashboardDurationDaysHours(int days, int hours) {
    return '${days}d ${hours}h';
  }

  @override
  String teamDashboardDurationHoursMinutes(int hours, int minutes) {
    return '${hours}h ${minutes}m';
  }

  @override
  String teamDashboardDurationMinutes(int minutes) {
    return '${minutes}m';
  }

  @override
  String get teamDashboardLoadError => 'Couldn\'t load the team dashboard.';

  @override
  String get rateHistoryTitle => 'Rate history';

  @override
  String get rateHistoryEmpty => 'No closed deals yet for this channel.';

  @override
  String get rateHistoryMedianViewsLabel => 'Median views at deal';

  @override
  String get rateHistoryViewsNotMeasured => 'Not measured';

  @override
  String get ownerPickerUnassigned => 'Unassigned';

  @override
  String get deliverableSectionTitle => 'Deliverables';

  @override
  String get deliverableSectionSubtitle =>
      'Individual pieces of content for this deal, tracked one by one — separate from the summary line above.';

  @override
  String get deliverableEmptyState => 'No deliverables tracked yet.';

  @override
  String get deliverableAddButton => 'Add deliverable';

  @override
  String get deliverableAddDialogTitle => 'Add a deliverable';

  @override
  String get deliverableTypeIntegration => 'Integration';

  @override
  String get deliverableTypeDedicated => 'Dedicated video';

  @override
  String get deliverableTypeShort => 'Short';

  @override
  String get deliverableTypeCommunityPost => 'Community post';

  @override
  String get deliverableTypeOther => 'Other';

  @override
  String get deliverableStatusPending => 'Pending';

  @override
  String get deliverableStatusDrafted => 'Drafted';

  @override
  String get deliverableStatusApproved => 'Approved';

  @override
  String get deliverableStatusPublished => 'Published';

  @override
  String get deliverableAgreedDateLabel => 'Agreed';

  @override
  String get deliverableDraftReceivedDateLabel => 'Draft received';

  @override
  String get deliverableApprovedDateLabel => 'Approval date';

  @override
  String get deliverableDateNotSet => 'Not set';

  @override
  String get deliverablePublishedUrlLabel => 'Published link';

  @override
  String get deliverablePublishedUrlHint => 'https://…';

  @override
  String get deliverableNotesHint => 'Notes for this deliverable';

  @override
  String get deliverableMoveUpTooltip => 'Move up';

  @override
  String get deliverableMoveDownTooltip => 'Move down';

  @override
  String get deliverableDeleteTooltip => 'Delete deliverable';

  @override
  String get deliverableDeleteConfirmTitle => 'Delete this deliverable?';

  @override
  String get deliverableDeleteConfirmBody =>
      'This removes it from the deal. This can\'t be undone.';

  @override
  String get deliverableAddedToast => 'Deliverable added';

  @override
  String get deliverableDeletedToast => 'Deliverable deleted';

  @override
  String get deliverableLoadError => 'Couldn\'t load deliverables.';

  @override
  String get manualEngagementTitle => 'Manual engagement';

  @override
  String get manualEngagementDisclaimer =>
      'Entered by hand — never pulled automatically from any API.';

  @override
  String get manualEngagementRateLabel => 'Engagement rate';

  @override
  String get manualEngagementRateNotSet => 'Not entered';

  @override
  String get manualEngagementRateHint => 'e.g. 4.2';

  @override
  String get manualEngagementNoteLabel => 'Note';

  @override
  String get manualEngagementNoteNotSet => 'No note';

  @override
  String get manualEngagementNeverEntered =>
      'No manual engagement entered yet.';

  @override
  String get manualEngagementUpdatedToday => 'Updated today';

  @override
  String manualEngagementUpdatedDaysAgo(int count) {
    return 'Updated ${count}d ago';
  }

  @override
  String get manualEngagementEditTitle => 'Edit manual engagement';

  @override
  String get manualEngagementEditRateHelp =>
      'A percentage you looked up yourself — from a media kit, the channel\'s own analytics, wherever. Leave blank to clear it.';

  @override
  String get manualEngagementEditNoteHelp =>
      'Where this number came from, or any context worth keeping.';

  @override
  String get manualEngagementEditAction => 'Edit manual engagement';

  @override
  String get manualEngagementClearAction => 'Clear';

  @override
  String get manualEngagementSaved => 'Manual engagement saved.';

  @override
  String get manualEngagementCleared => 'Manual engagement cleared.';

  @override
  String get manualEngagementRateInvalid =>
      'Enter a percentage between 0 and 100, or leave it blank.';

  @override
  String get jobSchedulerCardTitle => 'Scheduled jobs';

  @override
  String get jobSchedulerCardSubtitle =>
      'Background jobs this machine runs on its own schedule, checked once a minute.';

  @override
  String get jobSchedulerRefresh => 'Refresh';

  @override
  String get jobSchedulerLoadError => 'Couldn\'t load the scheduled jobs.';

  @override
  String get jobSchedulerEmptyState => 'No scheduled jobs on this machine.';

  @override
  String get jobSchedulerDisabledBadge => 'Disabled';

  @override
  String get jobSchedulerLastRunNever => 'Last run: never';

  @override
  String jobSchedulerLastRunLabel(String when) {
    return 'Last run: $when';
  }

  @override
  String get jobSchedulerNextRunNone => 'Next run: not scheduled';

  @override
  String jobSchedulerNextRunLabel(String when) {
    return 'Next run: $when';
  }

  @override
  String get jobSchedulerDeleteTooltip => 'Delete';

  @override
  String get jobSchedulerDeleteConfirmTitle => 'Delete this scheduled job?';

  @override
  String jobSchedulerDeleteConfirmBody(String kind) {
    return '\"$kind\" will stop running on this machine. This can\'t be undone.';
  }

  @override
  String get jobSchedulerDeleteConfirmCancel => 'Cancel';

  @override
  String get jobSchedulerDeleteConfirmDelete => 'Delete';

  @override
  String get paymentSectionTitle => 'Payment';

  @override
  String get paymentMarginLabel => 'Your margin';

  @override
  String get paymentCurrencyLabel => 'Currency';

  @override
  String get paymentMethodLabel => 'Payment method';

  @override
  String get paymentMethodHint => 'e.g. wire, PayPal, Instapay';

  @override
  String get paymentReferenceLabel => 'Payment reference';

  @override
  String get paymentReferenceHint => 'Transaction ID, wire reference…';

  @override
  String get paymentInvoiceSentLabel => 'Invoice sent';

  @override
  String get paymentInvoicePaidLabel => 'Invoice paid';

  @override
  String get paymentPayoutDueLabel => 'Payout due';

  @override
  String get paymentPayoutPaidLabel => 'Payout paid';

  @override
  String get paymentNotSet => 'Not set';

  @override
  String get paymentMarkSentNow => 'Mark sent now';

  @override
  String get paymentMarkPaidNow => 'Mark paid now';

  @override
  String get paymentMarkDueToday => 'Set due today';

  @override
  String get paymentPickDateTooltip => 'Pick a date';

  @override
  String get paymentClearDateTooltip => 'Clear';

  @override
  String get paymentDetailsSaved => 'Payment details saved';

  @override
  String get paymentDateSaved => 'Saved';

  @override
  String get financeNavLabel => 'Finance';

  @override
  String get financeTitle => 'Finance';

  @override
  String get financeSummaryBrandRevenue => 'Total brand revenue';

  @override
  String get financeSummaryMargin => 'Total margin';

  @override
  String get financeSummaryOutstanding => 'Outstanding (invoiced, unpaid)';

  @override
  String get financeSummaryOwedToCreators => 'Owed to creators';

  @override
  String get financeFilterAll => 'All deals';

  @override
  String get financeFilterInvoiceUnpaid => 'Invoice sent, unpaid';

  @override
  String get financeFilterInvoiceOverdue => 'Invoice overdue';

  @override
  String get financeFilterPayoutDue => 'Payout due';

  @override
  String get financeFilterPayoutOverdue => 'Payout overdue';

  @override
  String get financeFilterSettled => 'Fully settled';

  @override
  String get financeColumnDeal => 'Deal';

  @override
  String get financeColumnBrandPrice => 'Brand pays';

  @override
  String get financeColumnMargin => 'Margin';

  @override
  String get financeColumnInvoiceSent => 'Invoice sent';

  @override
  String get financeColumnInvoicePaid => 'Invoice paid';

  @override
  String get financeColumnPayoutDue => 'Payout due';

  @override
  String get financeColumnPayoutPaid => 'Payout paid';

  @override
  String get financeNotSet => '—';

  @override
  String get financeEmptyState => 'No deals match this filter.';

  @override
  String get financeLoadError => 'Couldn\'t load the finance ledger.';

  @override
  String get myDaySectionTitle => 'My Day';

  @override
  String get myDaySectionEmpty => 'Nothing urgent right now — nice work.';

  @override
  String get myDaySectionLoadError => 'Couldn\'t load My Day.';

  @override
  String get myDayGroupOverdue => 'Overdue';

  @override
  String get myDayGroupDueSoon => 'Due soon';

  @override
  String myDayPayoutDueTitle(String influencer) {
    return 'Payout due — $influencer';
  }

  @override
  String myDayInvoiceUnpaidTitle(String influencer) {
    return 'Invoice unpaid — $influencer';
  }

  @override
  String myDayDeliverableDueTitle(String type, String influencer) {
    return '$type due — $influencer';
  }

  @override
  String myDayOutreachReplyTitle(String influencer) {
    return 'Reply needed — $influencer';
  }

  @override
  String myDayOutreachWaitingSince(String date) {
    return 'Waiting since $date';
  }

  @override
  String myDayDeliverableDeadline(String date) {
    return 'Deal deadline $date';
  }

  @override
  String myDayReportDueTitle(String influencer) {
    return '30-day report — $influencer';
  }

  @override
  String myDayReportDueOn(String date) {
    return 'Due $date';
  }

  @override
  String get reportTitle => '30-day report';

  @override
  String reportDueOn(String date) {
    return 'Report due $date';
  }

  @override
  String get reportFetchViews => 'Read the views now';

  @override
  String get reportFetching => 'Asking YouTube for the views…';

  @override
  String get reportNeedsLink =>
      'Add the video\'s link first: the views are read from it.';

  @override
  String reportEarly(String date) {
    return 'It is due on $date. Views read before then are not 30-day views.';
  }

  @override
  String reportFetchFailed(String error) {
    return 'The views could not be read: $error';
  }

  @override
  String get reportClicksLabel => 'Clicks on the tracking link';

  @override
  String get reportClicksHelper => 'Read them off the link\'s own dashboard.';

  @override
  String get reportSaveClicks => 'Save clicks';

  @override
  String get reportCopy => 'Copy for email';

  @override
  String get reportCopied => 'The report is copied.';

  @override
  String get reportSavePage => 'Save a page to print';

  @override
  String reportPageSaved(String path) {
    return 'Saved: $path';
  }

  @override
  String get reportPageFailed => 'The page could not be saved.';

  @override
  String reportRemindPitch(String brand) {
    return 'Results are good: remind me to pitch $brand its next creator';
  }

  @override
  String reportPitchReminder(String brand) {
    return 'Pitch $brand its next creator';
  }

  @override
  String get reportReminderSet => 'Reminder set for tomorrow.';

  @override
  String reportTextHeading(String creator, String brand) {
    return '$creator × $brand: results after 30 days';
  }

  @override
  String reportTextVideo(String url) {
    return 'Video: $url';
  }

  @override
  String reportTextLive(String date) {
    return 'Went live: $date';
  }

  @override
  String reportTextViews(String date, String views) {
    return 'Views on $date: $views';
  }

  @override
  String reportTextPrice(String price) {
    return 'Price: $price';
  }

  @override
  String reportTextPriceShare(int count, String price) {
    return 'Price (an even share of the deal across $count deliverables): $price';
  }

  @override
  String reportTextCpm(String cpm) {
    return 'CPM achieved: $cpm';
  }

  @override
  String reportTextClicks(String clicks) {
    return 'Clicks on the tracking link: $clicks';
  }

  @override
  String get myDayDeliverableTypeIntegration => 'Integration';

  @override
  String get myDayDeliverableTypeDedicated => 'Dedicated video';

  @override
  String get myDayDeliverableTypeShort => 'Short';

  @override
  String get myDayDeliverableTypeCommunityPost => 'Community post';

  @override
  String get myDayDeliverableTypeOther => 'Deliverable';

  @override
  String get myDayReminderKindFollowUp => 'Follow-up';

  @override
  String get myDayReminderKindDealDeadline => 'Deal deadline';

  @override
  String get myDayReminderKindCustom => 'Reminder';

  @override
  String outreachSlaMinutesShort(int minutes) {
    return '${minutes}m';
  }

  @override
  String outreachSlaHoursShort(int hours) {
    return '${hours}h';
  }

  @override
  String outreachSlaDaysShort(int days) {
    return '${days}d';
  }

  @override
  String get outreachSlaTooltipWaiting => 'Waiting on our reply';

  @override
  String get outreachSlaTooltipOverdue =>
      'Waiting on our reply — past the 24-hour window';

  @override
  String get outreachClassificationInterested => 'Interested';

  @override
  String get outreachClassificationAskingRate => 'Asking rate';

  @override
  String get outreachClassificationNotNow => 'Not now';

  @override
  String get outreachClassificationDecline => 'Decline';

  @override
  String get outreachClassificationWrongContact => 'Wrong contact';

  @override
  String get outreachClassificationAutoReply => 'Auto-reply';

  @override
  String get outreachClassificationClear => 'Clear tag';

  @override
  String get outreachClassificationFilterAll => 'All conversations';

  @override
  String get outreachClassificationFilterEmpty =>
      'No threads with this classification yet.';

  @override
  String get outreachClassifyMessage => 'Tag this reply';

  @override
  String get campaignSectionTitle => 'Campaigns';

  @override
  String get campaignAddButton => 'Add campaign';

  @override
  String get campaignSectionEmpty =>
      'No campaigns yet — group this brand\'s deals under one to plan a proposal or report around it.';

  @override
  String get campaignAddedToast => 'Campaign created';

  @override
  String campaignStartDateValue(String date) {
    return 'Starts $date';
  }

  @override
  String campaignLiveDateValue(String date) {
    return 'Live $date';
  }

  @override
  String get campaignAddDialogTitle => 'Add a campaign';

  @override
  String get campaignNameLabel => 'Name';

  @override
  String get campaignNameRequired => 'A name is required.';

  @override
  String get campaignNotesLabel => 'Notes';

  @override
  String get campaignStartDateLabel => 'Start date';

  @override
  String get campaignLiveDateLabel => 'Live date';

  @override
  String get campaignDateNotSet => 'Not set';

  @override
  String get campaignStatusActive => 'Active';

  @override
  String get campaignStatusClosed => 'Closed';

  @override
  String get campaignDetailTitle => 'Campaign';

  @override
  String get campaignDeleteTooltip => 'Delete campaign';

  @override
  String get campaignNotFound => 'Campaign not found.';

  @override
  String get campaignNotesHint =>
      'Anything worth remembering about this campaign.';

  @override
  String get campaignNotesSaved => 'Notes saved';

  @override
  String get campaignDeleteConfirmTitle => 'Delete this campaign?';

  @override
  String get campaignDeleteConfirmBody =>
      'This removes the campaign and its shortlist. Deals already linked to it are not affected.';

  @override
  String get campaignDeletedToast => 'Campaign deleted';

  @override
  String get campaignShortlistTitle => 'Shortlist';

  @override
  String get campaignShortlistAddButton => 'Add channel';

  @override
  String get campaignDraftPitch => 'Draft pitch to brand';

  @override
  String get campaignPitchDrafting => 'Drafting the pitch…';

  @override
  String get campaignPitchNoContact =>
      'The brand has no contact email yet. Add one on the brand\'s page first.';

  @override
  String get campaignPitchNobodyReady =>
      'Nobody on this shortlist is ready to pitch yet: each needs a media kit and an agreed rate (BRD-PRES-15).';

  @override
  String get campaignPitchLeftOutTitle => 'Some are not ready to pitch';

  @override
  String campaignPitchLeftOut(String handles) {
    return 'These are not ready to pitch yet and will be left out: $handles';
  }

  @override
  String get campaignPitchConfirm => 'Draft pitch';

  @override
  String get campaignPitchDrafted =>
      'Pitch drafted. It is waiting in Outreach → Comms queue; nothing has been sent.';

  @override
  String get campaignShortlistSubtitle =>
      'Channels under consideration for this campaign, before any of them becomes a deal.';

  @override
  String get campaignShortlistEmpty => 'No channels shortlisted yet.';

  @override
  String get campaignShortlistAddedToast => 'Channel added to the shortlist';

  @override
  String get campaignShortlistRemoveTooltip => 'Remove from shortlist';

  @override
  String campaignShortlistSnapshotBrandPrice(String value) {
    return 'Brand paid $value';
  }

  @override
  String campaignShortlistSnapshotInfluencerPayout(String value) {
    return 'Creator received $value';
  }

  @override
  String campaignShortlistSnapshotMedianViews(String value) {
    return '$value median views';
  }

  @override
  String get campaignShortlistRemoveConfirmTitle => 'Remove this channel?';

  @override
  String get campaignShortlistRemoveConfirmBody =>
      'This only drops it from the shortlist — nothing about the channel itself changes.';

  @override
  String get campaignShortlistRemovedToast => 'Removed from the shortlist';

  @override
  String get campaignShortlistAddDialogTitle =>
      'Add a channel to the shortlist';

  @override
  String get campaignShortlistChannelIdLabel => 'Channel ID';

  @override
  String get campaignShortlistChannelIdHint =>
      'The channel\'s id, e.g. a YouTube channel id';

  @override
  String get campaignShortlistChannelIdRequired => 'A channel id is required.';

  @override
  String get campaignShortlistWhyFitLabel => 'Why this fits (optional)';

  @override
  String get campaignShortlistWhyFitHint =>
      'What made this channel worth shortlisting';

  @override
  String get geminiBridgeStateStopped => 'Stopped';

  @override
  String get geminiBridgeStateStarting => 'Starting…';

  @override
  String geminiBridgeStateListening(String port) {
    return 'Listening on port $port — waiting for the extension';
  }

  @override
  String geminiBridgeStateConnected(String account) {
    return 'Connected as $account';
  }

  @override
  String get geminiBridgeStateConnectedNoAccount => 'Connected';

  @override
  String get geminiBridgeStateFailed => 'Failed';

  @override
  String geminiBridgeFailure(String code, String message) {
    return '$code: $message';
  }

  @override
  String get geminiBridgeFailureHint =>
      'Fix this in Settings → Gemini in browser.';

  @override
  String get geminiBridgeTitle => 'Gemini in browser';

  @override
  String get geminiBridgeSubtitle =>
      'Draft emails and generate keywords through the Gemini tab in Edge — no API key needed.';

  @override
  String get geminiBridgeNotAvailable =>
      'Not available on this platform — the bridge needs the desktop app with the Python pipeline.';

  @override
  String geminiBridgeModelLine(String model) {
    return 'Model: $model';
  }

  @override
  String get geminiBridgeStart => 'Start';

  @override
  String get geminiBridgeStop => 'Stop';

  @override
  String get geminiBridgeTest => 'Test';

  @override
  String get geminiBridgeOpenGemini => 'Open Gemini';

  @override
  String get geminiBridgeRunDiagnostics => 'Run diagnostics';

  @override
  String get geminiBridgeCopyJson => 'Copy JSON';

  @override
  String geminiBridgeTestListening(String port) {
    return 'Daemon listening on port $port';
  }

  @override
  String get geminiBridgeTestNotListening => 'Daemon not listening';

  @override
  String get geminiBridgeTestExtensionConnected => 'Extension connected';

  @override
  String get geminiBridgeTestExtensionMissing =>
      'Extension not connected — load it in Edge and check the port';

  @override
  String geminiBridgeTestAccount(String account) {
    return 'Account: $account';
  }

  @override
  String get geminiBridgeTestAccountUnknown => 'Account: unknown';

  @override
  String geminiBridgeTestModel(String model) {
    return 'Model: $model';
  }

  @override
  String get geminiBridgeTestModelUnknown => 'Model: unknown';

  @override
  String get geminiBridgeTestSignedOut => 'The Gemini tab is signed out.';

  @override
  String get geminiBridgeTestSignedIn => 'Signed in';

  @override
  String get geminiBridgePortLabel => 'Port';

  @override
  String get geminiBridgePortInvalid => 'Enter a port between 1 and 65535.';

  @override
  String get geminiBridgeAccountMatchLabel =>
      'Account must match (name or email)';

  @override
  String get geminiBridgeAccountMatchHint =>
      'Blank: any signed-in account will do';

  @override
  String get geminiBridgeGemHint =>
      'Blank: plain chat with the skill file prepended';

  @override
  String get geminiBridgeDefaultModelLabel => 'Default model';

  @override
  String get geminiBridgeDefaultModelHint =>
      'e.g. Pro — blank leaves the switcher as it is';

  @override
  String get geminiBridgeSettingsSaved => 'Gemini bridge settings saved.';

  @override
  String get geminiBridgeSettingsRestartHint =>
      'A new port takes effect the next time the bridge starts.';

  @override
  String get geminiBridgeAccountTitle => 'Google account';

  @override
  String geminiBridgeSignedInAs(String account) {
    return 'Signed in as $account';
  }

  @override
  String geminiBridgeLastSeen(String account) {
    return 'Last seen signed in: $account';
  }

  @override
  String get geminiBridgeNoAccountSeen =>
      'No account seen yet. Open Gemini and sign in once; it is remembered from then on.';

  @override
  String geminiBridgeUseAccount(String email) {
    return 'Use $email for actions';
  }

  @override
  String geminiBridgeAccountPinned(String account) {
    return 'Actions use $account.';
  }

  @override
  String get geminiBridgeBrowserTitle => 'Browser';

  @override
  String get geminiBridgeBrowserLabel => 'Open Gemini in';

  @override
  String get geminiBridgeBrowserFirefox => 'Firefox (recommended)';

  @override
  String get geminiBridgeBrowserEdge => 'Microsoft Edge';

  @override
  String get geminiBridgeBrowserChrome => 'Google Chrome';

  @override
  String get geminiBridgeBrowserSystem => 'System default browser';

  @override
  String get geminiBridgeDetectBrowsers => 'Detect browsers';

  @override
  String geminiBridgeBrowserFound(String name, String version) {
    return '$name $version';
  }

  @override
  String get geminiBridgeBrowserNoneFound =>
      'No supported browser was found on this PC.';

  @override
  String get geminiBridgeBrowserSelectedMissing =>
      'The selected browser was not found on this PC.';

  @override
  String get geminiBridgeAddonMissing =>
      'Add-on: not installed yet. It is added automatically when the Gemini window opens.';

  @override
  String get geminiBridgeAddonTemporary =>
      'Add-on: added for this browser session. It is added again automatically on every launch.';

  @override
  String get geminiBridgeAddonInstalled => 'Add-on: installed.';

  @override
  String get geminiBridgeAddonOutdated =>
      'Add-on: outdated. It is updated automatically on the next launch.';

  @override
  String get geminiBridgeAddonBlocked =>
      'Add-on: blocked by Firefox because it is not signed.';

  @override
  String get geminiBridgeAddonUnknown => 'Add-on: known once the browser runs.';

  @override
  String get geminiBridgeBrowserPathLabel => 'Browser program (optional)';

  @override
  String get geminiBridgeBrowserPathHint => 'Blank: found automatically';

  @override
  String geminiBridgeWindowLaunching(String browser) {
    return 'Starting $browser…';
  }

  @override
  String get geminiBridgeWindowInstalling => 'Adding the Gemini add-on…';

  @override
  String get geminiBridgeAutoStartLabel =>
      'Start the bridge when the app opens';

  @override
  String get geminiBridgeAutoOpenLabel =>
      'Open a Gemini window in the background when none is connected';

  @override
  String get geminiBridgeKeywordsGemLabel => 'Keywords gem URL';

  @override
  String get geminiBridgeExtensionFolderCopy =>
      'Copy the extension folder (load it once: extensions page, Developer mode, Load unpacked)';

  @override
  String get geminiBridgeDiagnosticsTitle => 'Diagnostics';

  @override
  String get geminiBridgeDiagnosticsEmpty =>
      'Run diagnostics to see how each element on the Gemini page is found — and what to do when one is not.';

  @override
  String get geminiBridgeDiagnosticsRunning => 'Asking the extension…';

  @override
  String get geminiBridgeDiagnosticsJsonCopied => 'Diagnostics JSON copied.';

  @override
  String geminiBridgeDiagnosticsAllFound(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'All $count elements found.',
      one: 'The one element was found.',
    );
    return '$_temp0';
  }

  @override
  String geminiBridgeDiagnosticsMissing(int missing, int total) {
    return '$missing of $total elements missing.';
  }

  @override
  String get geminiBridgeDiagnosticsPageChanged =>
      'The page\'s components changed since the locators last worked.';

  @override
  String get geminiBridgeElementFound => 'Found';

  @override
  String get geminiBridgeElementMissing =>
      'Missing — none of the strategies matched';

  @override
  String geminiBridgeElementStrategy(String strategy) {
    return 'Found by: $strategy';
  }

  @override
  String get geminiBridgeElementTried => 'Tried';

  @override
  String geminiBridgeTriedLine(String strategy, int matched, int visible) {
    return '$strategy — $matched matched, $visible visible';
  }

  @override
  String get geminiBridgeElementLastKnown => 'How it used to be found';

  @override
  String get geminiBridgeElementLastKnownNone =>
      'Never found before on this machine.';

  @override
  String get geminiBridgeElementSuggestions => 'Suggestions';

  @override
  String get geminiBridgeElementNoSuggestions =>
      'No suggestions — the extension found nothing similar on the page.';

  @override
  String get geminiBridgeApplyFix => 'Apply fix';

  @override
  String get geminiBridgeApplyingFix => 'Applying…';

  @override
  String geminiBridgeFixApplied(String element) {
    return 'Fix applied to $element; diagnostics re-run.';
  }

  @override
  String get geminiKeywordsButton => 'Generate keywords with Gemini';

  @override
  String get geminiKeywordsNotConnected =>
      'The Gemini extension is not connected — see Settings → Gemini in browser.';

  @override
  String get geminiKeywordsTitle => 'Generate keywords';

  @override
  String get geminiKeywordsSubtitle =>
      'Long-tail YouTube search phrases from Gemini, deduped against everything already searched.';

  @override
  String get geminiKeywordsTopicLabel => 'Topic';

  @override
  String get geminiKeywordsTopicHint => 'e.g. AI coding tools for beginners';

  @override
  String get geminiKeywordsTopicRequired => 'A topic is required.';

  @override
  String get geminiKeywordsCountLabel => 'How many';

  @override
  String get geminiKeywordsLanguageLabel => 'Language';

  @override
  String get geminiKeywordsLanguageHint => 'Blank: English';

  @override
  String get geminiKeywordsStylesLabel => 'Phrasing styles';

  @override
  String get geminiKeywordsStylesHint =>
      'Comma separated, e.g. how to, best, review, vs';

  @override
  String get geminiKeywordsExclusionsLabel => 'Exclude';

  @override
  String get geminiKeywordsExclusionsHint =>
      'Sub-topics to leave out, comma or newline separated';

  @override
  String get geminiKeywordsNotesLabel => 'Notes for Gemini';

  @override
  String geminiKeywordsAvoiding(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Avoiding $count keywords already in the list or already searched.',
      one: 'Avoiding 1 keyword already in the list or already searched.',
      zero: 'Nothing to avoid yet — the list and the search history are empty.',
    );
    return '$_temp0';
  }

  @override
  String get geminiKeywordsGenerate => 'Generate';

  @override
  String get geminiKeywordsGenerating =>
      'Asking Gemini… this can take a minute.';

  @override
  String geminiKeywordsResultCount(int fresh, int known) {
    String _temp0 = intl.Intl.pluralLogic(
      fresh,
      locale: localeName,
      other: '$fresh new phrases',
      one: '1 new phrase',
      zero: 'No new phrases',
    );
    return '$_temp0 · $known already known or dropped as duplicates.';
  }

  @override
  String get geminiKeywordsAlreadyKnown =>
      'Already in the list or already searched';

  @override
  String get geminiKeywordsSelectAll => 'Select all';

  @override
  String get geminiKeywordsSelectNone => 'Select none';

  @override
  String geminiKeywordsAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Add $count to list',
      one: 'Add 1 to list',
      zero: 'Add to list',
    );
    return '$_temp0';
  }

  @override
  String geminiKeywordsAdded(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Added $count keywords to the list.',
      one: 'Added 1 keyword to the list.',
    );
    return '$_temp0';
  }

  @override
  String get geminiKeywordsEmpty =>
      'Gemini returned no keywords. Try a broader topic or fewer exclusions.';

  @override
  String get geminiKeywordsChatsLabel => 'Separate chats';

  @override
  String get geminiKeywordsChatsHint => '1–8 · more chats, more variety';

  @override
  String geminiKeywordsProgress(int done, int total, int keywords) {
    return 'Chat $done of $total done · $keywords keywords so far';
  }

  @override
  String geminiKeywordsPartial(int failed, int total) {
    return '$failed of $total chats failed — showing what the others found.';
  }

  @override
  String geminiKeywordsChatFailed(int number, String error) {
    return 'Chat $number: $error';
  }

  @override
  String get geminiKeywordsBack => 'Back';

  @override
  String get navSkills => 'Skills';

  @override
  String get skillsTitle => 'Skills';

  @override
  String get skillsUnavailable =>
      'Skills need a project folder to write to — open this on the desktop app with the pipeline set up.';

  @override
  String get skillsEmpty =>
      'No skills yet. A skill becomes a deck of cards that combine into one file for Gemini to read.';

  @override
  String get skillsNewSkill => 'New skill';

  @override
  String get skillsNameHint => 'Skill name — also the file it exports as';

  @override
  String get skillsDeleteSkill => 'Delete skill';

  @override
  String skillsDeleteSkillConfirm(String name) {
    return 'Delete \"$name\" and every card in it? This does not remove the exported file already on disk.';
  }

  @override
  String get skillsExportAll => 'Re-export every skill';

  @override
  String get skillsExportAllDone => 'Every skill\'s file is up to date.';

  @override
  String skillsExportAllPartial(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count skills',
      one: '1 skill',
    );
    return '$_temp0 could not be exported.';
  }

  @override
  String get skillsNeverExported => 'Never exported';

  @override
  String skillsLastExported(String date) {
    return 'Exported $date';
  }

  @override
  String skillsWordCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count words',
      one: '1 word',
    );
    return '$_temp0';
  }

  @override
  String get skillsAddCard => 'Add card';

  @override
  String get skillsDeckEmpty =>
      'No cards yet. Add one to start writing this skill.';

  @override
  String get skillsCardUntitled => 'Untitled card';

  @override
  String get skillsCardEmptyBody => 'Empty';

  @override
  String get skillsCardHeadingHint => 'Card heading';

  @override
  String get skillsCardBodyHint =>
      'Write this card\'s prompt text. Type @ to reference another card — it is transcluded in full when this skill is exported.';

  @override
  String get skillsDeleteCard => 'Delete card';

  @override
  String skillsDeleteCardConfirm(String heading) {
    return 'Delete \"$heading\"? Any \"@\" reference to it elsewhere will stop resolving.';
  }

  @override
  String get skillsEditTab => 'Edit';

  @override
  String get skillsPreviewTab => 'Preview';

  @override
  String get skillsNameRequired =>
      'Name this card before closing it — an unnamed card is never exported.';

  @override
  String get skillsTeamOnlyToggle => 'Team only — never exported to Gemini';

  @override
  String get skillsTeamOnlyBadge => 'Team only';

  @override
  String get skillsCollapseAll => 'Collapse all';

  @override
  String get skillsExpandAll => 'Expand all';

  @override
  String get skillsTogglePreview => 'Show/hide preview';

  @override
  String get skillsImport => 'Import from a file';

  @override
  String get skillsImportNothingToImport =>
      'Every skill file in \"data/gemini skills\" is already a deck here.';

  @override
  String skillsImportDone(String name) {
    return 'Imported \"$name\" as a new skill.';
  }

  @override
  String get skillsImportFailed => 'Could not read that file.';

  @override
  String get skillsGemBlockTitle => 'Gemini Gem';

  @override
  String get skillsGemBlockNote =>
      'Set up here and kept in this app. Never exported to the skill file, counted in its words or sent to Gemini in a prompt.';

  @override
  String get skillsGemNameCardTitle => 'Gem · name & description';

  @override
  String get skillsGemInstructionsCardTitle => 'Gem · instructions';

  @override
  String get skillsGemNameLabel => 'Gem name';

  @override
  String get skillsGemDescriptionLabel => 'Description';

  @override
  String get skillsGemInstructionsLabel => 'Instructions';

  @override
  String get skillsGemInstructionsHint =>
      'What this Gem should always do. Kept here, apart from the skill\'s cards.';

  @override
  String skillsGemInstructionsWords(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count words',
      one: '1 word',
    );
    return '$_temp0';
  }

  @override
  String get skillsGemNotExportedBadge => 'Not exported';

  @override
  String get skillsGemNotExportedTooltip =>
      'Stays in the app: never exported to the skill file, counted in its words or sent in a prompt.';

  @override
  String skillsGemRoleLabel(String role) {
    return 'Used for: $role';
  }

  @override
  String get skillsGemRoleTooltip =>
      'Which Gem this skill sets up. A created Gem\'s link goes into that Gem\'s field in Settings.';

  @override
  String get skillsGemSyncUpToDate => 'Up to date in Gemini';

  @override
  String get skillsGemSyncPending =>
      'Changes go to the Gem in Gemini automatically';

  @override
  String get skillsGemSyncWillCreate =>
      'The Gem is created in Gemini automatically';

  @override
  String get skillsGemSyncDefaults =>
      'Edit these to create the Gem in Gemini automatically';

  @override
  String get skillsGemRoleKeywords => 'Keywords';

  @override
  String get skillsGemAddAction => 'Set up a Gem for this skill';

  @override
  String get skillsGemAddDialogTitle => 'Set up a Gem';

  @override
  String get skillsGemAddDialogBody => 'Which Gem does this skill configure?';

  @override
  String get myAppsTitle => 'My apps';

  @override
  String get myAppsSubtitle =>
      'Your other apps: open them, install them, or find them on GitHub and Google Play.';

  @override
  String get myAppsRefresh => 'Check again what is installed';

  @override
  String get myAppsEmpty =>
      'No apps listed yet. docs/MY_APPS.md says how to add one.';

  @override
  String get myAppsProblems =>
      'Some entries in my_apps.json could not be read:';

  @override
  String get myAppsOpen => 'Open';

  @override
  String get myAppsInstall => 'Install';

  @override
  String get myAppsDownloadApk => 'Download APK';

  @override
  String get myAppsGooglePlay => 'Google Play';

  @override
  String myAppsGithub(String repo) {
    return 'Open $repo on GitHub';
  }

  @override
  String get myAppsPrivateHelp =>
      'Private repository: installing needs a GitHub sign-in (Accounts → GitHub) that can see it.';

  @override
  String get myAppsInstalled => 'Installed on this computer';

  @override
  String get myAppsNotInstalled => 'Not installed on this computer';

  @override
  String get myAppsChecking => 'Checking the latest release…';

  @override
  String get myAppsDownloadingStarted => 'Downloading…';

  @override
  String myAppsDownloading(int percent) {
    return 'Downloading… $percent%';
  }

  @override
  String get myAppsWaitingForInstaller =>
      'The installer is open. Finish it there; Open appears here when it is done.';

  @override
  String get myAppsInstallerStarted => 'Installer started.';

  @override
  String myAppsOpenFailed(String name) {
    return 'Could not start $name.';
  }

  @override
  String get myAppsDownloadFailed => 'The download did not finish. Try again.';

  @override
  String get myAppsInstallerFailed =>
      'The installer was downloaded but could not be started.';

  @override
  String myAppsNoInstaller(String name) {
    return 'The latest release of $name has no Windows installer (a file ending in setup.exe). Opening the release page instead.';
  }

  @override
  String myAppsNoApk(String name) {
    return 'The latest release of $name has no .apk file. Opening the release page instead.';
  }

  @override
  String myAppsNotVisible(String repo) {
    return '$repo has no published release, or the GitHub account on this computer cannot see it. For a private repository, sign in under Accounts → GitHub with an account that has access.';
  }

  @override
  String get myAppsTokenRejected =>
      'GitHub rejected the saved sign-in. Sign in again under Accounts → GitHub.';

  @override
  String get myAppsUnreachable =>
      'GitHub could not be reached. Check the connection and try again.';

  @override
  String get outreachSendLater => 'Send later';

  @override
  String get outreachSendLaterInAnHour => 'In an hour';

  @override
  String get outreachSendLaterTomorrowMorning => 'Tomorrow, 09:00';

  @override
  String get outreachSendLaterMondayMorning => 'Monday, 09:00';

  @override
  String outreachSendLaterZone(String zone) {
    return 'Times are in $zone.';
  }

  @override
  String get outreachSendLaterInPast => 'That time has already passed.';

  @override
  String get outreachSendLaterSchedule => 'Schedule';

  @override
  String get outreachSendLaterHowItWorks =>
      'The app sends it at that time while it is open. If it is closed then, you decide what happens when you next open it.';

  @override
  String outreachSendLaterScheduled(String when) {
    return 'Scheduled for $when.';
  }

  @override
  String outreachSendLaterSentTitle(String handle) {
    return 'Scheduled email to $handle sent';
  }

  @override
  String outreachScheduledFor(String when) {
    return 'Scheduled for $when';
  }

  @override
  String outreachScheduledLate(String when) {
    return 'Was due $when';
  }

  @override
  String outreachScheduledFailed(String error) {
    return 'Not sent: $error';
  }

  @override
  String get outreachScheduledMaybeSent =>
      'An earlier try stopped before Gmail answered, so it may already have gone out. Check the Sent folder in Gmail first.';

  @override
  String get outreachScheduledSendNow => 'Send now';

  @override
  String get outreachScheduledSendAnyway => 'Send anyway';

  @override
  String get outreachScheduledChangeTime => 'Change time';

  @override
  String get outreachScheduledEdit => 'Edit';

  @override
  String get outreachScheduledDontSend => 'Don\'t send';

  @override
  String get outreachScheduledCancelled =>
      'The scheduled email will not be sent.';

  @override
  String outreachScheduledSentTo(String to) {
    return 'Sent to $to.';
  }

  @override
  String get outreachScheduledBusy => 'It is being sent right now.';

  @override
  String get outreachScheduledClearDraftFirst =>
      'Send or clear the draft in the composer first.';

  @override
  String outreachScheduledBanner(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count scheduled emails are waiting for a decision',
      one: '1 scheduled email is waiting for a decision',
    );
    return '$_temp0';
  }

  @override
  String get outreachScheduledReview => 'Review';

  @override
  String get outreachScheduledReviewTitle => 'Scheduled emails waiting';

  @override
  String get outreachScheduledReviewIntro =>
      'These did not go out at their time: the app was closed, or sending failed. Nothing late is sent without you.';

  @override
  String get outreachScheduledReviewEmpty => 'Nothing is waiting.';

  @override
  String outreachScheduledChipTooltip(String when) {
    return 'Email scheduled for $when';
  }

  @override
  String influencerSearchScopeTooltip(String scopes) {
    return 'Search in: $scopes';
  }

  @override
  String get influencerSearchScopeNames => 'Names and handles';

  @override
  String get influencerSearchScopeChannelDescriptions => 'Channel descriptions';

  @override
  String get influencerSearchScopeVideoDescriptions => 'Video descriptions';
}
