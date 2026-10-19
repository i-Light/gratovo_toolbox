import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_en.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('en')
  ];

  /// App title shown in the OS task switcher / browser tab.
  ///
  /// In en, this message translates to:
  /// **'Gratovo IMA ToolBox'**
  String get appTitle;

  /// No description provided for @navDashboard.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navDashboard;

  /// No description provided for @navSearch.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get navSearch;

  /// No description provided for @navRoster.
  ///
  /// In en, this message translates to:
  /// **'Roster'**
  String get navRoster;

  /// No description provided for @navInfluencers.
  ///
  /// In en, this message translates to:
  /// **'Influencers'**
  String get navInfluencers;

  /// No description provided for @navBrands.
  ///
  /// In en, this message translates to:
  /// **'Brands'**
  String get navBrands;

  /// No description provided for @navDeals.
  ///
  /// In en, this message translates to:
  /// **'Deals'**
  String get navDeals;

  /// No description provided for @navOutreach.
  ///
  /// In en, this message translates to:
  /// **'Outreach'**
  String get navOutreach;

  /// No description provided for @navSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// No description provided for @navNews.
  ///
  /// In en, this message translates to:
  /// **'News'**
  String get navNews;

  /// No description provided for @newsTitle.
  ///
  /// In en, this message translates to:
  /// **'Industry news'**
  String get newsTitle;

  /// No description provided for @newsAllSources.
  ///
  /// In en, this message translates to:
  /// **'All sources'**
  String get newsAllSources;

  /// No description provided for @newsAllNiches.
  ///
  /// In en, this message translates to:
  /// **'All niches'**
  String get newsAllNiches;

  /// No description provided for @newsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing stored yet. Run `python tools/news.py --refresh` on the machine that runs the pipeline to fetch the feeds.'**
  String get newsEmpty;

  /// No description provided for @newsNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No stories from this source yet.'**
  String get newsNoMatches;

  /// No description provided for @newsOpenArticle.
  ///
  /// In en, this message translates to:
  /// **'Read the article'**
  String get newsOpenArticle;

  /// No description provided for @newsUndated.
  ///
  /// In en, this message translates to:
  /// **'No date'**
  String get newsUndated;

  /// No description provided for @newsBySource.
  ///
  /// In en, this message translates to:
  /// **'{value}'**
  String newsBySource(String value);

  /// No description provided for @newsRefresh.
  ///
  /// In en, this message translates to:
  /// **'Fetch feeds now'**
  String get newsRefresh;

  /// No description provided for @newsRefreshStarted.
  ///
  /// In en, this message translates to:
  /// **'Fetching feeds…'**
  String get newsRefreshStarted;

  /// No description provided for @newsRefreshFinished.
  ///
  /// In en, this message translates to:
  /// **'Feeds updated.'**
  String get newsRefreshFinished;

  /// No description provided for @newsRefreshFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t fetch the feeds.'**
  String get newsRefreshFailed;

  /// No description provided for @newsRefreshDesktopOnly.
  ///
  /// In en, this message translates to:
  /// **'Feeds are fetched by the pipeline machine. A browser is not allowed to read them directly, which is why the stories are stored rather than loaded live.'**
  String get newsRefreshDesktopOnly;

  /// No description provided for @newsSourcesTitle.
  ///
  /// In en, this message translates to:
  /// **'Feeds'**
  String get newsSourcesTitle;

  /// No description provided for @newsSourceFailing.
  ///
  /// In en, this message translates to:
  /// **'This feed failed on its last fetch'**
  String get newsSourceFailing;

  /// No description provided for @newsSourceDisabled.
  ///
  /// In en, this message translates to:
  /// **'Not being fetched'**
  String get newsSourceDisabled;

  /// No description provided for @newsSourceLastFetched.
  ///
  /// In en, this message translates to:
  /// **'Fetched {date}'**
  String newsSourceLastFetched(String date);

  /// No description provided for @newsSourceNeverFetched.
  ///
  /// In en, this message translates to:
  /// **'Never fetched'**
  String get newsSourceNeverFetched;

  /// No description provided for @newsAddSourceTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a feed'**
  String get newsAddSourceTitle;

  /// No description provided for @newsAddSourceUrl.
  ///
  /// In en, this message translates to:
  /// **'Feed URL'**
  String get newsAddSourceUrl;

  /// No description provided for @newsAddSourceUrlHint.
  ///
  /// In en, this message translates to:
  /// **'https://example.com/feed/'**
  String get newsAddSourceUrlHint;

  /// No description provided for @newsAddSourceUrlInvalid.
  ///
  /// In en, this message translates to:
  /// **'That is not a valid http(s) URL.'**
  String get newsAddSourceUrlInvalid;

  /// No description provided for @newsAddSourceNiche.
  ///
  /// In en, this message translates to:
  /// **'Niche (optional)'**
  String get newsAddSourceNiche;

  /// No description provided for @newsAddSourceTitleField.
  ///
  /// In en, this message translates to:
  /// **'Name (optional)'**
  String get newsAddSourceTitleField;

  /// No description provided for @newsAddSourceTitleHelp.
  ///
  /// In en, this message translates to:
  /// **'Left blank, the feed names itself on the first successful fetch.'**
  String get newsAddSourceTitleHelp;

  /// No description provided for @newsAddSourceSubmit.
  ///
  /// In en, this message translates to:
  /// **'Add feed'**
  String get newsAddSourceSubmit;

  /// No description provided for @newsAddSourceAdded.
  ///
  /// In en, this message translates to:
  /// **'Feed added. Fetch to pull its stories in.'**
  String get newsAddSourceAdded;

  /// No description provided for @newsAddSourceFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t add that feed.'**
  String get newsAddSourceFailed;

  /// No description provided for @newsRemoveSource.
  ///
  /// In en, this message translates to:
  /// **'Remove feed'**
  String get newsRemoveSource;

  /// No description provided for @newsRemoveSourceConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove this feed and every story it produced? The stories cannot be recovered without fetching again.'**
  String get newsRemoveSourceConfirm;

  /// No description provided for @newsSourceEnable.
  ///
  /// In en, this message translates to:
  /// **'Fetch this feed'**
  String get newsSourceEnable;

  /// No description provided for @newsSourceDisable.
  ///
  /// In en, this message translates to:
  /// **'Stop fetching this feed'**
  String get newsSourceDisable;

  /// No description provided for @newsSinceLastFetch.
  ///
  /// In en, this message translates to:
  /// **'New stories since the last fetch'**
  String get newsSinceLastFetch;

  /// No description provided for @newsClearAll.
  ///
  /// In en, this message translates to:
  /// **'Clear stored stories'**
  String get newsClearAll;

  /// No description provided for @newsClearAllConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete every stored story? The feeds stay put and the next fetch pulls them all back in. This is here to test the new-stories badge.'**
  String get newsClearAllConfirm;

  /// No description provided for @newsClearAllDone.
  ///
  /// In en, this message translates to:
  /// **'Stored stories cleared.'**
  String get newsClearAllDone;

  /// No description provided for @newsClearAllFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t clear the stored stories.'**
  String get newsClearAllFailed;

  /// No description provided for @dashboardWelcomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Welcome back'**
  String get dashboardWelcomeTitle;

  /// No description provided for @dashboardWelcomeUser.
  ///
  /// In en, this message translates to:
  /// **'Welcome back, '**
  String get dashboardWelcomeUser;

  /// No description provided for @dashboardWelcomeBody.
  ///
  /// In en, this message translates to:
  /// **'Here\'s where the pipeline stands right now — new finds, active negotiations, upcoming outreach, and what the team is working on.'**
  String get dashboardWelcomeBody;

  /// Placeholder screen title.
  ///
  /// In en, this message translates to:
  /// **'{pageName} is coming soon'**
  String comingSoonTitle(String pageName);

  /// No description provided for @comingSoonBody.
  ///
  /// In en, this message translates to:
  /// **'This page is scaffolded and routable, but its real content is built in a later phase of the rebuild.'**
  String get comingSoonBody;

  /// No description provided for @desktopOnlyNotice.
  ///
  /// In en, this message translates to:
  /// **'This is only available on the desktop app, where the sourcing pipeline runs.'**
  String get desktopOnlyNotice;

  /// No description provided for @themeModeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeModeLight;

  /// No description provided for @themeModeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeModeDark;

  /// No description provided for @themeModeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeModeSystem;

  /// No description provided for @languageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get languageEnglish;

  /// No description provided for @languageArabic.
  ///
  /// In en, this message translates to:
  /// **'Arabic'**
  String get languageArabic;

  /// No description provided for @commonError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong.'**
  String get commonError;

  /// No description provided for @commonRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get commonRetry;

  /// No description provided for @dashboardNewFinds.
  ///
  /// In en, this message translates to:
  /// **'New finds'**
  String get dashboardNewFinds;

  /// No description provided for @dashboardActiveNegotiations.
  ///
  /// In en, this message translates to:
  /// **'Active negotiations'**
  String get dashboardActiveNegotiations;

  /// No description provided for @dashboardEmailsSentToday.
  ///
  /// In en, this message translates to:
  /// **'Emails sent today'**
  String get dashboardEmailsSentToday;

  /// No description provided for @dashboardDraftedToday.
  ///
  /// In en, this message translates to:
  /// **'Drafted today'**
  String get dashboardDraftedToday;

  /// No description provided for @dashboardOfTarget.
  ///
  /// In en, this message translates to:
  /// **'{count} of {target}'**
  String dashboardOfTarget(String count, String target);

  /// No description provided for @dashboardRosterReady.
  ///
  /// In en, this message translates to:
  /// **'Roster ready to pitch'**
  String get dashboardRosterReady;

  /// No description provided for @dashboardUpcomingRemindersTitle.
  ///
  /// In en, this message translates to:
  /// **'Upcoming reminders'**
  String get dashboardUpcomingRemindersTitle;

  /// No description provided for @dashboardNoReminders.
  ///
  /// In en, this message translates to:
  /// **'No reminders due — you\'re all caught up.'**
  String get dashboardNoReminders;

  /// Subtitle under a reminder's title, e.g. 'Due Aug 24, 2026'.
  ///
  /// In en, this message translates to:
  /// **'Due {date}'**
  String dashboardReminderDue(String date);

  /// Chip on the dashboard's News peek card — how many stories arrived on the last fetch.
  ///
  /// In en, this message translates to:
  /// **'{count} new'**
  String dashboardNewsNewCount(int count);

  /// Badge on the dashboard's 'New finds' tile — how many channels are currently counting down to being archived.
  ///
  /// In en, this message translates to:
  /// **'+{count} archive due'**
  String dashboardArchiveDueCount(String count);

  /// No description provided for @dashboardNewsPeekEmpty.
  ///
  /// In en, this message translates to:
  /// **'No news yet'**
  String get dashboardNewsPeekEmpty;

  /// No description provided for @dashboardLogsPeekEmpty.
  ///
  /// In en, this message translates to:
  /// **'No activity yet'**
  String get dashboardLogsPeekEmpty;

  /// No description provided for @vettingStatusNewlyFound.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get vettingStatusNewlyFound;

  /// No description provided for @vettingStatusShortlisted.
  ///
  /// In en, this message translates to:
  /// **'Shortlisted'**
  String get vettingStatusShortlisted;

  /// No description provided for @vettingStatusRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get vettingStatusRejected;

  /// No description provided for @dealStageProposed.
  ///
  /// In en, this message translates to:
  /// **'Proposed'**
  String get dealStageProposed;

  /// No description provided for @dealStageNegotiating.
  ///
  /// In en, this message translates to:
  /// **'Negotiating'**
  String get dealStageNegotiating;

  /// No description provided for @dealStageAgreed.
  ///
  /// In en, this message translates to:
  /// **'Agreed'**
  String get dealStageAgreed;

  /// No description provided for @dealStageContractSent.
  ///
  /// In en, this message translates to:
  /// **'Contract sent'**
  String get dealStageContractSent;

  /// No description provided for @dealStageSigned.
  ///
  /// In en, this message translates to:
  /// **'Signed'**
  String get dealStageSigned;

  /// No description provided for @dealStageLive.
  ///
  /// In en, this message translates to:
  /// **'Live'**
  String get dealStageLive;

  /// No description provided for @dealStageClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get dealStageClosed;

  /// No description provided for @dealStageLost.
  ///
  /// In en, this message translates to:
  /// **'Lost'**
  String get dealStageLost;

  /// No description provided for @influencerListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No influencers yet — run a search to find some.'**
  String get influencerListEmpty;

  /// No description provided for @influencerListFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get influencerListFilterAll;

  /// No description provided for @influencerListSortLabel.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get influencerListSortLabel;

  /// No description provided for @influencerListSortSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Subscribers'**
  String get influencerListSortSubscribers;

  /// No description provided for @influencerListSortRecentActivity.
  ///
  /// In en, this message translates to:
  /// **'Recent activity'**
  String get influencerListSortRecentActivity;

  /// No description provided for @influencerListSortAverageViews.
  ///
  /// In en, this message translates to:
  /// **'Median views (30d)'**
  String get influencerListSortAverageViews;

  /// Subscriber count. decimalPattern applies the project rule that any number over three digits is grouped, in whatever way the active locale groups numbers.
  ///
  /// In en, this message translates to:
  /// **'{count} subscribers'**
  String influencerSubscribersCount(int count);

  /// No description provided for @influencerFoundVia.
  ///
  /// In en, this message translates to:
  /// **'Found via: {keywords}'**
  String influencerFoundVia(String keywords);

  /// No description provided for @influencerNotFound.
  ///
  /// In en, this message translates to:
  /// **'Influencer not found.'**
  String get influencerNotFound;

  /// No description provided for @influencerProfileSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Subscribers'**
  String get influencerProfileSubscribers;

  /// No description provided for @influencerProfileMedianViews30.
  ///
  /// In en, this message translates to:
  /// **'Median views · 30 days'**
  String get influencerProfileMedianViews30;

  /// No description provided for @influencerProfileMedianViewsAll.
  ///
  /// In en, this message translates to:
  /// **'Median views · all stored'**
  String get influencerProfileMedianViewsAll;

  /// No description provided for @influencerProfileCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get influencerProfileCountry;

  /// No description provided for @influencerProfileLastVideo.
  ///
  /// In en, this message translates to:
  /// **'Last video'**
  String get influencerProfileLastVideo;

  /// No description provided for @influencerProfileVettingLabel.
  ///
  /// In en, this message translates to:
  /// **'Vetting status'**
  String get influencerProfileVettingLabel;

  /// No description provided for @influencerProfileRecentVideosTitle.
  ///
  /// In en, this message translates to:
  /// **'Recent videos'**
  String get influencerProfileRecentVideosTitle;

  /// No description provided for @influencerProfileRefreshVideos.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get influencerProfileRefreshVideos;

  /// No description provided for @influencerProfileRefreshStarted.
  ///
  /// In en, this message translates to:
  /// **'Refreshing recent videos…'**
  String get influencerProfileRefreshStarted;

  /// No description provided for @influencerProfileRefreshFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t refresh this channel\'s videos.'**
  String get influencerProfileRefreshFailed;

  /// No description provided for @influencerProfileNoVideos.
  ///
  /// In en, this message translates to:
  /// **'No recent videos yet.'**
  String get influencerProfileNoVideos;

  /// No description provided for @influencerProfileDetailsSyncing.
  ///
  /// In en, this message translates to:
  /// **'Details syncing — this channel was found on a teammate\'s machine and its videos have not reached this one yet.'**
  String get influencerProfileDetailsSyncing;

  /// No description provided for @influencerDetailsSyncingShort.
  ///
  /// In en, this message translates to:
  /// **'details syncing…'**
  String get influencerDetailsSyncingShort;

  /// No description provided for @dashboardSearchingTitle.
  ///
  /// In en, this message translates to:
  /// **'Searching now'**
  String get dashboardSearchingTitle;

  /// No description provided for @dashboardSearchingLine.
  ///
  /// In en, this message translates to:
  /// **'{name} · {keyword} · {count} found'**
  String dashboardSearchingLine(String name, String keyword, int count);

  /// No description provided for @dashboardSearchingBlockedLine.
  ///
  /// In en, this message translates to:
  /// **'{name} · {reason} — retrying in {seconds}s'**
  String dashboardSearchingBlockedLine(String name, String reason, int seconds);

  /// No description provided for @searchBackoffReasonRateLimited.
  ///
  /// In en, this message translates to:
  /// **'IP refused / rate-limited'**
  String get searchBackoffReasonRateLimited;

  /// No description provided for @searchBackoffReasonCaptcha.
  ///
  /// In en, this message translates to:
  /// **'blocked by a CAPTCHA check'**
  String get searchBackoffReasonCaptcha;

  /// No description provided for @influencerProfileRelevanceCriteriaTitle.
  ///
  /// In en, this message translates to:
  /// **'What I\'m looking for in this channel\'s videos'**
  String get influencerProfileRelevanceCriteriaTitle;

  /// No description provided for @influencerProfileRelevanceCriteriaHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. sponsorship mentions, upload frequency'**
  String get influencerProfileRelevanceCriteriaHint;

  /// No description provided for @influencerProfileAddCriterion.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get influencerProfileAddCriterion;

  /// No description provided for @influencerProfileNotesTitle.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get influencerProfileNotesTitle;

  /// No description provided for @influencerProfileNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Notes for future deals with this channel'**
  String get influencerProfileNotesHint;

  /// No description provided for @influencerProfileSaveNotes.
  ///
  /// In en, this message translates to:
  /// **'Save notes'**
  String get influencerProfileSaveNotes;

  /// No description provided for @influencerProfileNotesSaved.
  ///
  /// In en, this message translates to:
  /// **'Notes saved.'**
  String get influencerProfileNotesSaved;

  /// No description provided for @influencerProfileDealHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Deal history'**
  String get influencerProfileDealHistoryTitle;

  /// No description provided for @influencerProfileNoDeals.
  ///
  /// In en, this message translates to:
  /// **'No deals yet with this influencer.'**
  String get influencerProfileNoDeals;

  /// No description provided for @influencerProfileOpenChannel.
  ///
  /// In en, this message translates to:
  /// **'Open channel'**
  String get influencerProfileOpenChannel;

  /// No description provided for @influencerProfileLastUpdated.
  ///
  /// In en, this message translates to:
  /// **'Channel data updated {date}'**
  String influencerProfileLastUpdated(String date);

  /// No description provided for @influencerProfileNeverUpdated.
  ///
  /// In en, this message translates to:
  /// **'Never refreshed'**
  String get influencerProfileNeverUpdated;

  /// No description provided for @influencerProfileVideosThisMonth.
  ///
  /// In en, this message translates to:
  /// **'Videos this month'**
  String get influencerProfileVideosThisMonth;

  /// No description provided for @influencerProfileStageTitle.
  ///
  /// In en, this message translates to:
  /// **'Progress and tags'**
  String get influencerProfileStageTitle;

  /// No description provided for @influencerProfileStageLabel.
  ///
  /// In en, this message translates to:
  /// **'Pipeline stage'**
  String get influencerProfileStageLabel;

  /// No description provided for @influencerProfileChannelTagsLabel.
  ///
  /// In en, this message translates to:
  /// **'Channel tags'**
  String get influencerProfileChannelTagsLabel;

  /// No description provided for @influencerProfileAddTagHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. tech, fitness'**
  String get influencerProfileAddTagHint;

  /// No description provided for @influencerProfileSaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t save that change.'**
  String get influencerProfileSaveFailed;

  /// No description provided for @influencerProfilePullMonths.
  ///
  /// In en, this message translates to:
  /// **'Months to cover'**
  String get influencerProfilePullMonths;

  /// No description provided for @influencerProfilePullMore.
  ///
  /// In en, this message translates to:
  /// **'Pull more'**
  String get influencerProfilePullMore;

  /// No description provided for @influencerProfilePullStarted.
  ///
  /// In en, this message translates to:
  /// **'Backfill started — see the Search page for progress.'**
  String get influencerProfilePullStarted;

  /// No description provided for @influencerProfilePullAlreadyRunning.
  ///
  /// In en, this message translates to:
  /// **'A backfill is already running — wait for it to finish, then try again.'**
  String get influencerProfilePullAlreadyRunning;

  /// No description provided for @influencerProfilePullSearchRunning.
  ///
  /// In en, this message translates to:
  /// **'A search is running — wait for it to finish, then try again.'**
  String get influencerProfilePullSearchRunning;

  /// No description provided for @influencerProfilePullFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t start the backfill.'**
  String get influencerProfilePullFailed;

  /// No description provided for @influencerProfileCrmTitle.
  ///
  /// In en, this message translates to:
  /// **'What a video is worth'**
  String get influencerProfileCrmTitle;

  /// No description provided for @influencerProfileCrmBasis.
  ///
  /// In en, this message translates to:
  /// **'Basis'**
  String get influencerProfileCrmBasis;

  /// No description provided for @influencerProfileCrmIncluded.
  ///
  /// In en, this message translates to:
  /// **'{count} videos included'**
  String influencerProfileCrmIncluded(int count);

  /// No description provided for @influencerProfileCrmUnusable.
  ///
  /// In en, this message translates to:
  /// **'{count} have no view count and can\'t be used'**
  String influencerProfileCrmUnusable(int count);

  /// No description provided for @influencerProfileCrmSelectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all'**
  String get influencerProfileCrmSelectAll;

  /// No description provided for @influencerProfileCrmSelectNone.
  ///
  /// In en, this message translates to:
  /// **'Select none'**
  String get influencerProfileCrmSelectNone;

  /// No description provided for @influencerProfileCrmMedian.
  ///
  /// In en, this message translates to:
  /// **'Median views'**
  String get influencerProfileCrmMedian;

  /// No description provided for @influencerProfileCrmAverage.
  ///
  /// In en, this message translates to:
  /// **'Average views'**
  String get influencerProfileCrmAverage;

  /// No description provided for @influencerProfileCrmRange.
  ///
  /// In en, this message translates to:
  /// **'Range'**
  String get influencerProfileCrmRange;

  /// No description provided for @influencerProfileCrmUploadRate.
  ///
  /// In en, this message translates to:
  /// **'Uploads / month'**
  String get influencerProfileCrmUploadRate;

  /// No description provided for @influencerProfileCrmSkewWarning.
  ///
  /// In en, this message translates to:
  /// **'The average is well above the median — one or two videos are carrying it. Quote from the median.'**
  String get influencerProfileCrmSkewWarning;

  /// No description provided for @influencerProfileCrmPrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get influencerProfileCrmPrice;

  /// No description provided for @influencerProfileCrmCpm.
  ///
  /// In en, this message translates to:
  /// **'CPM'**
  String get influencerProfileCrmCpm;

  /// No description provided for @cpmNicheLabel.
  ///
  /// In en, this message translates to:
  /// **'Niche (CPM range)'**
  String get cpmNicheLabel;

  /// No description provided for @cpmNicheLine.
  ///
  /// In en, this message translates to:
  /// **'{niche}: \${low}-{high} CPM, so \${lowPrice}-{highPrice} for this channel'**
  String cpmNicheLine(
      String niche, String low, String high, String lowPrice, String highPrice);

  /// No description provided for @cpmSliderHelp.
  ///
  /// In en, this message translates to:
  /// **'Slide to try a CPM within the range; the price follows.'**
  String get cpmSliderHelp;

  /// No description provided for @cpmNicheTech.
  ///
  /// In en, this message translates to:
  /// **'Tech'**
  String get cpmNicheTech;

  /// No description provided for @cpmNicheFinance.
  ///
  /// In en, this message translates to:
  /// **'Finance'**
  String get cpmNicheFinance;

  /// No description provided for @cpmNicheFitness.
  ///
  /// In en, this message translates to:
  /// **'Fitness'**
  String get cpmNicheFitness;

  /// No description provided for @cpmNicheEntertainment.
  ///
  /// In en, this message translates to:
  /// **'Entertainment'**
  String get cpmNicheEntertainment;

  /// No description provided for @cpmNicheGaming.
  ///
  /// In en, this message translates to:
  /// **'Gaming'**
  String get cpmNicheGaming;

  /// No description provided for @cpmNicheBeauty.
  ///
  /// In en, this message translates to:
  /// **'Beauty'**
  String get cpmNicheBeauty;

  /// No description provided for @cpmNicheTravel.
  ///
  /// In en, this message translates to:
  /// **'Travel'**
  String get cpmNicheTravel;

  /// No description provided for @cpmNicheEducation.
  ///
  /// In en, this message translates to:
  /// **'Education'**
  String get cpmNicheEducation;

  /// No description provided for @cpmNicheFood.
  ///
  /// In en, this message translates to:
  /// **'Food'**
  String get cpmNicheFood;

  /// No description provided for @cpmNicheLuxury.
  ///
  /// In en, this message translates to:
  /// **'Luxury'**
  String get cpmNicheLuxury;

  /// No description provided for @brandNew.
  ///
  /// In en, this message translates to:
  /// **'New brand'**
  String get brandNew;

  /// No description provided for @brandEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit brand'**
  String get brandEdit;

  /// No description provided for @brandFormName.
  ///
  /// In en, this message translates to:
  /// **'Brand name'**
  String get brandFormName;

  /// No description provided for @brandFormNameRequired.
  ///
  /// In en, this message translates to:
  /// **'A brand needs a name.'**
  String get brandFormNameRequired;

  /// No description provided for @brandFormWebsite.
  ///
  /// In en, this message translates to:
  /// **'Website'**
  String get brandFormWebsite;

  /// No description provided for @brandFormCategory.
  ///
  /// In en, this message translates to:
  /// **'What they sell'**
  String get brandFormCategory;

  /// No description provided for @brandFormCountry.
  ///
  /// In en, this message translates to:
  /// **'Country (two letters)'**
  String get brandFormCountry;

  /// No description provided for @brandFormCountryInvalid.
  ///
  /// In en, this message translates to:
  /// **'Two letters, like US.'**
  String get brandFormCountryInvalid;

  /// No description provided for @brandFormBudget.
  ///
  /// In en, this message translates to:
  /// **'Budget'**
  String get brandFormBudget;

  /// No description provided for @brandFormCurrency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get brandFormCurrency;

  /// No description provided for @brandFormContacts.
  ///
  /// In en, this message translates to:
  /// **'Contacts'**
  String get brandFormContacts;

  /// No description provided for @brandFormContactName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get brandFormContactName;

  /// No description provided for @brandFormContactEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get brandFormContactEmail;

  /// No description provided for @brandFormContactRole.
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get brandFormContactRole;

  /// No description provided for @brandFormContactPrimary.
  ///
  /// In en, this message translates to:
  /// **'Write to this one first'**
  String get brandFormContactPrimary;

  /// No description provided for @brandFormAddContact.
  ///
  /// In en, this message translates to:
  /// **'Add a contact'**
  String get brandFormAddContact;

  /// No description provided for @brandFormRemoveContact.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get brandFormRemoveContact;

  /// No description provided for @brandFormEmailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Not an email address.'**
  String get brandFormEmailInvalid;

  /// No description provided for @brandFormBrief.
  ///
  /// In en, this message translates to:
  /// **'Campaign brief'**
  String get brandFormBrief;

  /// No description provided for @brandSaved.
  ///
  /// In en, this message translates to:
  /// **'Brand saved.'**
  String get brandSaved;

  /// No description provided for @brandBoycottCountry.
  ///
  /// In en, this message translates to:
  /// **'Boycotted country ({country}): no pitch and no creator for this brand.'**
  String brandBoycottCountry(String country);

  /// No description provided for @brandBoycottBrand.
  ///
  /// In en, this message translates to:
  /// **'On the boycott list ({brand}): no pitch and no creator for this brand.'**
  String brandBoycottBrand(String brand);

  /// No description provided for @brandSourceSeen.
  ///
  /// In en, this message translates to:
  /// **'Found sponsoring creators'**
  String get brandSourceSeen;

  /// No description provided for @brandSourceLabel.
  ///
  /// In en, this message translates to:
  /// **'How we found them'**
  String get brandSourceLabel;

  /// No description provided for @seenBrandsTitle.
  ///
  /// In en, this message translates to:
  /// **'Brands seen sponsoring'**
  String get seenBrandsTitle;

  /// No description provided for @seenBrandsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Brands found in the sponsorship lines of creators\' videos. One click makes a brand record.'**
  String get seenBrandsSubtitle;

  /// No description provided for @seenBrandsSummary.
  ///
  /// In en, this message translates to:
  /// **'{brands, plural, =1{1 brand seen} other{{brands} brands seen}} across {channels, plural, =1{1 channel} other{{channels} channels}}'**
  String seenBrandsSummary(int brands, int channels);

  /// No description provided for @seenBrandsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No sponsorships found in the stored videos yet.'**
  String get seenBrandsEmpty;

  /// No description provided for @seenBrandsChannels.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 channel} other{{count} channels}}: {handles}'**
  String seenBrandsChannels(int count, String handles);

  /// No description provided for @seenBrandsLatest.
  ///
  /// In en, this message translates to:
  /// **'Latest upload among them: {date}'**
  String seenBrandsLatest(String date);

  /// No description provided for @seenBrandsSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get seenBrandsSaved;

  /// No description provided for @seenBrandsCreate.
  ///
  /// In en, this message translates to:
  /// **'Create brand'**
  String get seenBrandsCreate;

  /// No description provided for @seenBrandsShowAll.
  ///
  /// In en, this message translates to:
  /// **'Show all {count}'**
  String seenBrandsShowAll(int count);

  /// No description provided for @seenBrandsShowFewer.
  ///
  /// In en, this message translates to:
  /// **'Show fewer'**
  String get seenBrandsShowFewer;

  /// No description provided for @dealStart.
  ///
  /// In en, this message translates to:
  /// **'Start deal'**
  String get dealStart;

  /// No description provided for @dealStartTitle.
  ///
  /// In en, this message translates to:
  /// **'Start a deal with {handle}'**
  String dealStartTitle(String handle);

  /// No description provided for @dealStarted.
  ///
  /// In en, this message translates to:
  /// **'Deal started.'**
  String get dealStarted;

  /// No description provided for @dealFormBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get dealFormBrand;

  /// No description provided for @dealFormBrandRequired.
  ///
  /// In en, this message translates to:
  /// **'Pick a brand.'**
  String get dealFormBrandRequired;

  /// No description provided for @dealFormBrandPrice.
  ///
  /// In en, this message translates to:
  /// **'Brand pays'**
  String get dealFormBrandPrice;

  /// No description provided for @dealFormPayout.
  ///
  /// In en, this message translates to:
  /// **'Creator receives'**
  String get dealFormPayout;

  /// No description provided for @dealFormCurrency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get dealFormCurrency;

  /// No description provided for @dealFormDeliverables.
  ///
  /// In en, this message translates to:
  /// **'Deliverables'**
  String get dealFormDeliverables;

  /// No description provided for @dealFormDeadline.
  ///
  /// In en, this message translates to:
  /// **'Deadline'**
  String get dealFormDeadline;

  /// No description provided for @dealFormPickDate.
  ///
  /// In en, this message translates to:
  /// **'Pick a date'**
  String get dealFormPickDate;

  /// No description provided for @dealFormPaymentTerms.
  ///
  /// In en, this message translates to:
  /// **'Payment terms'**
  String get dealFormPaymentTerms;

  /// No description provided for @dealFormPaymentTermsHint.
  ///
  /// In en, this message translates to:
  /// **'Set per deal, e.g. 50% upfront, 50% on publish'**
  String get dealFormPaymentTermsHint;

  /// No description provided for @dealFormTrackingLink.
  ///
  /// In en, this message translates to:
  /// **'Tracking link'**
  String get dealFormTrackingLink;

  /// No description provided for @dealFormNumberRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount.'**
  String get dealFormNumberRequired;

  /// No description provided for @dealEditTerms.
  ///
  /// In en, this message translates to:
  /// **'Edit terms'**
  String get dealEditTerms;

  /// No description provided for @dealTermsSaved.
  ///
  /// In en, this message translates to:
  /// **'Terms saved.'**
  String get dealTermsSaved;

  /// No description provided for @dealPaymentTermsLine.
  ///
  /// In en, this message translates to:
  /// **'Payment terms: {terms}'**
  String dealPaymentTermsLine(String terms);

  /// No description provided for @dealPaymentTermsNone.
  ///
  /// In en, this message translates to:
  /// **'Payment terms not set yet'**
  String get dealPaymentTermsNone;

  /// No description provided for @dealTrackingLinkLine.
  ///
  /// In en, this message translates to:
  /// **'Tracking link: {link}'**
  String dealTrackingLinkLine(String link);

  /// No description provided for @dealContractsTitle.
  ///
  /// In en, this message translates to:
  /// **'Contracts'**
  String get dealContractsTitle;

  /// No description provided for @dealContractCreator.
  ///
  /// In en, this message translates to:
  /// **'Creator\'s contract'**
  String get dealContractCreator;

  /// No description provided for @dealContractBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand\'s contract'**
  String get dealContractBrand;

  /// No description provided for @dealContractOrderNote.
  ///
  /// In en, this message translates to:
  /// **'The brand\'s contract is the template. The creator signs first, then the brand.'**
  String get dealContractOrderNote;

  /// No description provided for @contractStatusNone.
  ///
  /// In en, this message translates to:
  /// **'Not started'**
  String get contractStatusNone;

  /// No description provided for @contractStatusDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get contractStatusDraft;

  /// No description provided for @contractStatusSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get contractStatusSent;

  /// No description provided for @contractStatusSigned.
  ///
  /// In en, this message translates to:
  /// **'Signed'**
  String get contractStatusSigned;

  /// No description provided for @dealContractSignedOn.
  ///
  /// In en, this message translates to:
  /// **'Signed {date}'**
  String dealContractSignedOn(String date);

  /// No description provided for @dealContractUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get dealContractUpdate;

  /// No description provided for @dealContractUrl.
  ///
  /// In en, this message translates to:
  /// **'Contract link'**
  String get dealContractUrl;

  /// No description provided for @dealContractStatus.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get dealContractStatus;

  /// No description provided for @dealContractBrandWaits.
  ///
  /// In en, this message translates to:
  /// **'The brand signs after the creator.'**
  String get dealContractBrandWaits;

  /// No description provided for @dealContractSaved.
  ///
  /// In en, this message translates to:
  /// **'Contract saved.'**
  String get dealContractSaved;

  /// No description provided for @navComms.
  ///
  /// In en, this message translates to:
  /// **'Comms queue'**
  String get navComms;

  /// No description provided for @commsToday.
  ///
  /// In en, this message translates to:
  /// **'{sent} of {target} today'**
  String commsToday(int sent, int target);

  /// No description provided for @commsMailboxLeft.
  ///
  /// In en, this message translates to:
  /// **'{left} left in the mailbox today'**
  String commsMailboxLeft(int left);

  /// No description provided for @commsSectionReplies.
  ///
  /// In en, this message translates to:
  /// **'New replies'**
  String get commsSectionReplies;

  /// No description provided for @commsSectionFollowUps.
  ///
  /// In en, this message translates to:
  /// **'Follow-ups due'**
  String get commsSectionFollowUps;

  /// No description provided for @commsSectionDecisions.
  ///
  /// In en, this message translates to:
  /// **'Decisions'**
  String get commsSectionDecisions;

  /// No description provided for @commsSectionNewOutreach.
  ///
  /// In en, this message translates to:
  /// **'New outreach'**
  String get commsSectionNewOutreach;

  /// No description provided for @commsSectionEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing here right now.'**
  String get commsSectionEmpty;

  /// No description provided for @commsDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get commsDraft;

  /// No description provided for @commsDrafting.
  ///
  /// In en, this message translates to:
  /// **'Drafting with Gemini. This takes a few minutes.'**
  String get commsDrafting;

  /// No description provided for @commsDraftFailed.
  ///
  /// In en, this message translates to:
  /// **'The draft did not come back: {error}'**
  String commsDraftFailed(String error);

  /// No description provided for @commsFollowUpNumber.
  ///
  /// In en, this message translates to:
  /// **'Follow-up {number} of 3'**
  String commsFollowUpNumber(int number);

  /// No description provided for @commsKindFirst.
  ///
  /// In en, this message translates to:
  /// **'First email'**
  String get commsKindFirst;

  /// No description provided for @commsKindReply.
  ///
  /// In en, this message translates to:
  /// **'Reply'**
  String get commsKindReply;

  /// No description provided for @commsKindFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Follow-up'**
  String get commsKindFollowUp;

  /// No description provided for @commsKindDecision.
  ///
  /// In en, this message translates to:
  /// **'Decision'**
  String get commsKindDecision;

  /// No description provided for @commsNeedsYou.
  ///
  /// In en, this message translates to:
  /// **'Needs you'**
  String get commsNeedsYou;

  /// No description provided for @commsBlocked.
  ///
  /// In en, this message translates to:
  /// **'Not sendable'**
  String get commsBlocked;

  /// No description provided for @commsLessons.
  ///
  /// In en, this message translates to:
  /// **'Lessons used'**
  String get commsLessons;

  /// No description provided for @commsSubject.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get commsSubject;

  /// No description provided for @commsBody.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get commsBody;

  /// No description provided for @commsSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get commsSend;

  /// No description provided for @commsEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get commsEdit;

  /// No description provided for @commsDoneEditing.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get commsDoneEditing;

  /// No description provided for @commsRedo.
  ///
  /// In en, this message translates to:
  /// **'Redo'**
  String get commsRedo;

  /// No description provided for @commsSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get commsSkip;

  /// No description provided for @commsSent.
  ///
  /// In en, this message translates to:
  /// **'Sent.'**
  String get commsSent;

  /// No description provided for @commsTo.
  ///
  /// In en, this message translates to:
  /// **'To: {address}'**
  String commsTo(String address);

  /// No description provided for @commsRecipientUnconfirmed.
  ///
  /// In en, this message translates to:
  /// **'This address was found on their channel and has not been confirmed by anyone. Check it, or add the right one to their contacts, before sending.'**
  String get commsRecipientUnconfirmed;

  /// No description provided for @commsSkipped.
  ///
  /// In en, this message translates to:
  /// **'Skipped.'**
  String get commsSkipped;

  /// No description provided for @commsNoRecipient.
  ///
  /// In en, this message translates to:
  /// **'No email address for them yet. Add one in their contacts first.'**
  String get commsNoRecipient;

  /// No description provided for @commsSendError.
  ///
  /// In en, this message translates to:
  /// **'It did not send: {error}'**
  String commsSendError(String error);

  /// No description provided for @commsSentNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Sent, but it could not be added to the conversation: {error}. It will not be offered again; add it to the thread by hand.'**
  String commsSentNotRecorded(String error);

  /// No description provided for @commsCheckFailed.
  ///
  /// In en, this message translates to:
  /// **'The text failed the checks. Nothing was sent.'**
  String get commsCheckFailed;

  /// No description provided for @commsGatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Confirm before it goes'**
  String get commsGatesTitle;

  /// No description provided for @commsGatesBody.
  ///
  /// In en, this message translates to:
  /// **'This message needs a person\'s yes on:'**
  String get commsGatesBody;

  /// No description provided for @commsConfirmSend.
  ///
  /// In en, this message translates to:
  /// **'Confirm and send'**
  String get commsConfirmSend;

  /// No description provided for @commsNothingToSend.
  ///
  /// In en, this message translates to:
  /// **'The engine says nothing needs sending now.'**
  String get commsNothingToSend;

  /// No description provided for @commsSteerTitle.
  ///
  /// In en, this message translates to:
  /// **'Steer and redo'**
  String get commsSteerTitle;

  /// No description provided for @commsSteerHelp.
  ///
  /// In en, this message translates to:
  /// **'Optional corrections to what the engine read. Leave anything that is right as it is.'**
  String get commsSteerHelp;

  /// No description provided for @commsSteerAsRead.
  ///
  /// In en, this message translates to:
  /// **'As read'**
  String get commsSteerAsRead;

  /// No description provided for @commsSteerNote.
  ///
  /// In en, this message translates to:
  /// **'Anything else the engine should know'**
  String get commsSteerNote;

  /// No description provided for @commsSteerMore.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get commsSteerMore;

  /// No description provided for @commsSteerCash.
  ///
  /// In en, this message translates to:
  /// **'Allow a straight cash offer for this case only'**
  String get commsSteerCash;

  /// No description provided for @commsSteerCashHelp.
  ///
  /// In en, this message translates to:
  /// **'House choice HC-10: off by default; a person may switch it on for one case.'**
  String get commsSteerCashHelp;

  /// No description provided for @steerReader.
  ///
  /// In en, this message translates to:
  /// **'Who reads it'**
  String get steerReader;

  /// No description provided for @steerReaderOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, creator{Creator} manager{Creator\'s manager / agency} brand{Brand} other{{option}}}'**
  String steerReaderOption(String option);

  /// No description provided for @steerStage.
  ///
  /// In en, this message translates to:
  /// **'What this message is'**
  String get steerStage;

  /// No description provided for @steerStageOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, first{First email} fu1{Follow-up 1} fu2{Follow-up 2} closing{Last follow-up (closing)} reply{Answering their reply} reengage{Re-engaging an old lead} other{{option}}}'**
  String steerStageOption(String option);

  /// No description provided for @steerChannel.
  ///
  /// In en, this message translates to:
  /// **'Channel'**
  String get steerChannel;

  /// No description provided for @steerChannelOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, email{Email} dm{Instagram DM} linkedin{LinkedIn DM} other{{option}}}'**
  String steerChannelOption(String option);

  /// No description provided for @steerHave.
  ///
  /// In en, this message translates to:
  /// **'What I have'**
  String get steerHave;

  /// No description provided for @steerHaveOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, nothing{Nothing yet} roster{Creators on my roster} brand{A brand in hand} deal{A deal with a budget} other{{option}}}'**
  String steerHaveOption(String option);

  /// No description provided for @steerInmind.
  ///
  /// In en, this message translates to:
  /// **'Brands in mind'**
  String get steerInmind;

  /// No description provided for @steerInmindOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, none{None} yes{Yes, brands that fit them} other{{option}}}'**
  String steerInmindOption(String option);

  /// No description provided for @steerState.
  ///
  /// In en, this message translates to:
  /// **'Their sponsors'**
  String get steerState;

  /// No description provided for @steerStateOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, unknown{Unknown} unsponsored{No sponsors lately} some{Some sponsors} full{Every video sponsored} own{Sells own product} other{{option}}}'**
  String steerStateOption(String option);

  /// No description provided for @steerPitch.
  ///
  /// In en, this message translates to:
  /// **'What I\'m pitching'**
  String get steerPitch;

  /// No description provided for @steerPitchOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, one{One creator} several{Several creators} other{{option}}}'**
  String steerPitchOption(String option);

  /// No description provided for @steerProof.
  ///
  /// In en, this message translates to:
  /// **'Closed deals / case studies'**
  String get steerProof;

  /// No description provided for @steerProofOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, none{None yet} some{I have some} other{{option}}}'**
  String steerProofOption(String option);

  /// No description provided for @steerBtype.
  ///
  /// In en, this message translates to:
  /// **'Brand type'**
  String get steerBtype;

  /// No description provided for @steerBtypeOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, active{Already runs influencer campaigns} never{Never did influencer marketing} b2b{B2B / SaaS / software} apps{Apps / games} ecom{E-commerce / DTC} affiliate{Only does affiliate / gifting} other{{option}}}'**
  String steerBtypeOption(String option);

  /// No description provided for @steerBsize.
  ///
  /// In en, this message translates to:
  /// **'Brand size'**
  String get steerBsize;

  /// No description provided for @steerBsizeOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, small{Small (50 employees or fewer)} big{Big} other{{option}}}'**
  String steerBsizeOption(String option);

  /// No description provided for @steerCreply.
  ///
  /// In en, this message translates to:
  /// **'Their reply'**
  String get steerCreply;

  /// No description provided for @steerCreplyOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, interested{Interested} which{Which brand? What are the details?} kit{Sent media kit / analytics} who{Who are you? Send your website} budget{What\'s the budget?} affiliate{Affiliate only / wants a flat fee} gifting{Send me the product (gifting)} manager{My manager handles this} notint{Not interested} silent{Replied, then went silent} other{{option}}}'**
  String steerCreplyOption(String option);

  /// No description provided for @steerBreply.
  ///
  /// In en, this message translates to:
  /// **'Their reply'**
  String get steerBreply;

  /// No description provided for @steerBreplyOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, creators{Send creators / who do you have?} budget{States their budget or rates} cases{Asks for case studies} notnow{Not now / maybe next month} ignored{Ignored my rate question} kit{Asks for a media kit} affiliate{We only do affiliate / gifting} other{{option}}}'**
  String steerBreplyOption(String option);

  /// No description provided for @steerEnglish.
  ///
  /// In en, this message translates to:
  /// **'Their English'**
  String get steerEnglish;

  /// No description provided for @steerEnglishOption.
  ///
  /// In en, this message translates to:
  /// **'{option, select, native{Native / fluent} nonnative{Non-native} other{{option}}}'**
  String steerEnglishOption(String option);

  /// No description provided for @influencerProfileCrmCpmExplain.
  ///
  /// In en, this message translates to:
  /// **'Cost per 1,000 views, from the median. Change either box.'**
  String get influencerProfileCrmCpmExplain;

  /// No description provided for @influencerProfileCrmCut.
  ///
  /// In en, this message translates to:
  /// **'Your cut %'**
  String get influencerProfileCrmCut;

  /// No description provided for @influencerProfileCrmSplitYours.
  ///
  /// In en, this message translates to:
  /// **'You earn'**
  String get influencerProfileCrmSplitYours;

  /// No description provided for @influencerProfileCrmSplitTheirs.
  ///
  /// In en, this message translates to:
  /// **'They earn'**
  String get influencerProfileCrmSplitTheirs;

  /// No description provided for @influencerProfileCrmSplitOf.
  ///
  /// In en, this message translates to:
  /// **'of {price} at {percent}%'**
  String influencerProfileCrmSplitOf(String price, String percent);

  /// No description provided for @influencerProfileCrmSplitHint.
  ///
  /// In en, this message translates to:
  /// **'Enter a price and your cut % below to see who earns what.'**
  String get influencerProfileCrmSplitHint;

  /// No description provided for @influencerProfileCrmEmpty.
  ///
  /// In en, this message translates to:
  /// **'No usable videos yet. Every stored upload is missing its view count — run the enrichment tool, or pull more uploads above.'**
  String get influencerProfileCrmEmpty;

  /// No description provided for @influencerProfileCrmNoViewCount.
  ///
  /// In en, this message translates to:
  /// **'No view count'**
  String get influencerProfileCrmNoViewCount;

  /// No description provided for @influencerProfileProvidedTitle.
  ///
  /// In en, this message translates to:
  /// **'Data the influencer sent us'**
  String get influencerProfileProvidedTitle;

  /// No description provided for @influencerProfileProvidedEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded. Add what they sent — audience split, their own analytics — as name/value pairs.'**
  String get influencerProfileProvidedEmpty;

  /// No description provided for @influencerProfileProvidedKey.
  ///
  /// In en, this message translates to:
  /// **'Field'**
  String get influencerProfileProvidedKey;

  /// No description provided for @influencerProfileProvidedValue.
  ///
  /// In en, this message translates to:
  /// **'Value'**
  String get influencerProfileProvidedValue;

  /// No description provided for @influencerProfileProvidedAdd.
  ///
  /// In en, this message translates to:
  /// **'Add field'**
  String get influencerProfileProvidedAdd;

  /// No description provided for @influencerProfileProvidedUnverified.
  ///
  /// In en, this message translates to:
  /// **'Reported by the influencer, not measured by us.'**
  String get influencerProfileProvidedUnverified;

  /// No description provided for @influencerProfileEmailsTitle.
  ///
  /// In en, this message translates to:
  /// **'Email history'**
  String get influencerProfileEmailsTitle;

  /// No description provided for @influencerProfileEmailsSource.
  ///
  /// In en, this message translates to:
  /// **'Read-only here. The Emails page is where these are managed.'**
  String get influencerProfileEmailsSource;

  /// No description provided for @influencerProfileEmailsOpen.
  ///
  /// In en, this message translates to:
  /// **'Open in Emails'**
  String get influencerProfileEmailsOpen;

  /// No description provided for @influencerProfileNoEmails.
  ///
  /// In en, this message translates to:
  /// **'No emails logged with this influencer yet.'**
  String get influencerProfileNoEmails;

  /// No description provided for @influencerProfileEmailOutbound.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get influencerProfileEmailOutbound;

  /// No description provided for @influencerProfileEmailInbound.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get influencerProfileEmailInbound;

  /// No description provided for @influencerProfileEmailEventSent.
  ///
  /// In en, this message translates to:
  /// **'Sent an email on {date}'**
  String influencerProfileEmailEventSent(String date);

  /// No description provided for @influencerProfileEmailEventFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Sent a follow-up on {date}'**
  String influencerProfileEmailEventFollowUp(String date);

  /// No description provided for @influencerProfileEmailEventReply.
  ///
  /// In en, this message translates to:
  /// **'Received a reply on {date}'**
  String influencerProfileEmailEventReply(String date);

  /// No description provided for @influencerListSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search name or handle'**
  String get influencerListSearchHint;

  /// No description provided for @influencerListViewAsList.
  ///
  /// In en, this message translates to:
  /// **'List view'**
  String get influencerListViewAsList;

  /// No description provided for @influencerListViewAsCards.
  ///
  /// In en, this message translates to:
  /// **'Card view'**
  String get influencerListViewAsCards;

  /// No description provided for @influencerListFilters.
  ///
  /// In en, this message translates to:
  /// **'Filters'**
  String get influencerListFilters;

  /// No description provided for @influencerListClearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear filters'**
  String get influencerListClearFilters;

  /// No description provided for @influencerListNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No channels match these filters.'**
  String get influencerListNoMatches;

  /// No description provided for @influencerListLoadingMore.
  ///
  /// In en, this message translates to:
  /// **'Loading more…'**
  String get influencerListLoadingMore;

  /// No description provided for @influencerListEndOfList.
  ///
  /// In en, this message translates to:
  /// **'That\'s everyone.'**
  String get influencerListEndOfList;

  /// No description provided for @influencerListShowingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} shown'**
  String influencerListShowingCount(int count);

  /// No description provided for @influencerFilterCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get influencerFilterCountry;

  /// No description provided for @influencerFilterChannelTag.
  ///
  /// In en, this message translates to:
  /// **'Channel tag'**
  String get influencerFilterChannelTag;

  /// No description provided for @influencerFilterInclude.
  ///
  /// In en, this message translates to:
  /// **'Include'**
  String get influencerFilterInclude;

  /// No description provided for @influencerFilterExclude.
  ///
  /// In en, this message translates to:
  /// **'Exclude'**
  String get influencerFilterExclude;

  /// No description provided for @influencerFilterStage.
  ///
  /// In en, this message translates to:
  /// **'Stage'**
  String get influencerFilterStage;

  /// No description provided for @influencerFilterAny.
  ///
  /// In en, this message translates to:
  /// **'Any'**
  String get influencerFilterAny;

  /// No description provided for @influencerFilterMinSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Min subscribers'**
  String get influencerFilterMinSubscribers;

  /// No description provided for @influencerFilterMaxSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Max subscribers'**
  String get influencerFilterMaxSubscribers;

  /// No description provided for @influencerFilterMedianViews.
  ///
  /// In en, this message translates to:
  /// **'Median views this month'**
  String get influencerFilterMedianViews;

  /// No description provided for @influencerFilterDaysSinceDeal.
  ///
  /// In en, this message translates to:
  /// **'Days since last deal'**
  String get influencerFilterDaysSinceDeal;

  /// No description provided for @influencerFilterMin.
  ///
  /// In en, this message translates to:
  /// **'Min'**
  String get influencerFilterMin;

  /// No description provided for @influencerFilterMax.
  ///
  /// In en, this message translates to:
  /// **'Max'**
  String get influencerFilterMax;

  /// No description provided for @influencerFilterDealsOnlyNote.
  ///
  /// In en, this message translates to:
  /// **'Only channels that have had a deal can match this.'**
  String get influencerFilterDealsOnlyNote;

  /// No description provided for @influencerListSortVideosThisMonth.
  ///
  /// In en, this message translates to:
  /// **'Videos this month'**
  String get influencerListSortVideosThisMonth;

  /// No description provided for @influencerListSortDaysSinceDeal.
  ///
  /// In en, this message translates to:
  /// **'Time since last deal'**
  String get influencerListSortDaysSinceDeal;

  /// No description provided for @influencerListSortDiscovered.
  ///
  /// In en, this message translates to:
  /// **'Recently discovered'**
  String get influencerListSortDiscovered;

  /// No description provided for @influencerVideosThisMonth.
  ///
  /// In en, this message translates to:
  /// **'{count} videos this month'**
  String influencerVideosThisMonth(int count);

  /// No description provided for @influencerAverageViewsShort.
  ///
  /// In en, this message translates to:
  /// **'{count} median views'**
  String influencerAverageViewsShort(int count);

  /// No description provided for @influencerNoUploadsThisMonth.
  ///
  /// In en, this message translates to:
  /// **'No uploads this month'**
  String get influencerNoUploadsThisMonth;

  /// No description provided for @influencerCountryUnknown.
  ///
  /// In en, this message translates to:
  /// **'Country unknown'**
  String get influencerCountryUnknown;

  /// No description provided for @influencerTagContactAttempts.
  ///
  /// In en, this message translates to:
  /// **'{count} attempts'**
  String influencerTagContactAttempts(int count);

  /// No description provided for @influencerTagDaysSinceDeal.
  ///
  /// In en, this message translates to:
  /// **'{count}d since deal'**
  String influencerTagDaysSinceDeal(int count);

  /// No description provided for @influencerTagNeverContacted.
  ///
  /// In en, this message translates to:
  /// **'Not contacted'**
  String get influencerTagNeverContacted;

  /// No description provided for @pipelineStageNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get pipelineStageNew;

  /// No description provided for @pipelineStageContacted.
  ///
  /// In en, this message translates to:
  /// **'Contacted'**
  String get pipelineStageContacted;

  /// No description provided for @pipelineStageInterested.
  ///
  /// In en, this message translates to:
  /// **'Interested'**
  String get pipelineStageInterested;

  /// No description provided for @pipelineStageRoster.
  ///
  /// In en, this message translates to:
  /// **'Roster'**
  String get pipelineStageRoster;

  /// No description provided for @pipelineStageNegotiating.
  ///
  /// In en, this message translates to:
  /// **'Negotiating'**
  String get pipelineStageNegotiating;

  /// No description provided for @pipelineStageContract.
  ///
  /// In en, this message translates to:
  /// **'Contract'**
  String get pipelineStageContract;

  /// No description provided for @pipelineStageAwaitingDelivery.
  ///
  /// In en, this message translates to:
  /// **'Awaiting delivery'**
  String get pipelineStageAwaitingDelivery;

  /// No description provided for @pipelineStagePaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get pipelineStagePaid;

  /// No description provided for @pipelineStageLost.
  ///
  /// In en, this message translates to:
  /// **'Lost'**
  String get pipelineStageLost;

  /// No description provided for @influencerAddTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a channel'**
  String get influencerAddTitle;

  /// No description provided for @influencerAddIntro.
  ///
  /// In en, this message translates to:
  /// **'For a channel you found by hand that no keyword search has surfaced.'**
  String get influencerAddIntro;

  /// No description provided for @influencerAddHandle.
  ///
  /// In en, this message translates to:
  /// **'Handle'**
  String get influencerAddHandle;

  /// No description provided for @influencerAddHandleHint.
  ///
  /// In en, this message translates to:
  /// **'@channelname'**
  String get influencerAddHandleHint;

  /// No description provided for @influencerAddHandleRequired.
  ///
  /// In en, this message translates to:
  /// **'A handle is required.'**
  String get influencerAddHandleRequired;

  /// No description provided for @influencerAddChannelId.
  ///
  /// In en, this message translates to:
  /// **'YouTube channel ID (optional)'**
  String get influencerAddChannelId;

  /// No description provided for @influencerAddChannelIdHelp.
  ///
  /// In en, this message translates to:
  /// **'Starts with UC. Without it this entry cannot merge with the same channel when a search later finds it.'**
  String get influencerAddChannelIdHelp;

  /// No description provided for @influencerAddName.
  ///
  /// In en, this message translates to:
  /// **'Channel name (optional)'**
  String get influencerAddName;

  /// No description provided for @influencerAddUrl.
  ///
  /// In en, this message translates to:
  /// **'Channel URL (optional)'**
  String get influencerAddUrl;

  /// No description provided for @influencerAddSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Subscribers (optional)'**
  String get influencerAddSubscribers;

  /// No description provided for @influencerAddCountry.
  ///
  /// In en, this message translates to:
  /// **'Country (optional)'**
  String get influencerAddCountry;

  /// No description provided for @influencerAddNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes (optional)'**
  String get influencerAddNotes;

  /// No description provided for @influencerAddSubmit.
  ///
  /// In en, this message translates to:
  /// **'Add channel'**
  String get influencerAddSubmit;

  /// No description provided for @influencerAddSucceeded.
  ///
  /// In en, this message translates to:
  /// **'Channel added.'**
  String get influencerAddSucceeded;

  /// No description provided for @influencerAddFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t add that channel.'**
  String get influencerAddFailed;

  /// No description provided for @searchKeywordsLabel.
  ///
  /// In en, this message translates to:
  /// **'Keywords'**
  String get searchKeywordsLabel;

  /// No description provided for @searchKeywordsHint.
  ///
  /// In en, this message translates to:
  /// **'One keyword per line'**
  String get searchKeywordsHint;

  /// No description provided for @searchKeywordsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} keywords'**
  String searchKeywordsCount(String count);

  /// The keyword-box count while a run is going. Reverts to searchKeywordsCount the moment the run ends, however it ended.
  ///
  /// In en, this message translates to:
  /// **'{done}/{total} keywords'**
  String searchKeywordsProgressCount(String done, String total);

  /// No description provided for @searchKeywordsReopenTooltip.
  ///
  /// In en, this message translates to:
  /// **'Run a finished keyword again'**
  String get searchKeywordsReopenTooltip;

  /// Label on the button that reopens finished keywords, so they run again on the next Start.
  ///
  /// In en, this message translates to:
  /// **'{count} done'**
  String searchKeywordsDoneCount(String count);

  /// No description provided for @searchKeywordsReopenAll.
  ///
  /// In en, this message translates to:
  /// **'Redo all'**
  String get searchKeywordsReopenAll;

  /// No description provided for @searchKeywordsReopenTitle.
  ///
  /// In en, this message translates to:
  /// **'Redo a finished keyword'**
  String get searchKeywordsReopenTitle;

  /// No description provided for @searchKeywordsReopenHeader.
  ///
  /// In en, this message translates to:
  /// **'Finished — pick one to run again'**
  String get searchKeywordsReopenHeader;

  /// No description provided for @searchKeywordsStartAtTooltip.
  ///
  /// In en, this message translates to:
  /// **'Start at a specific keyword'**
  String get searchKeywordsStartAtTooltip;

  /// No description provided for @searchKeywordsStartAtTitle.
  ///
  /// In en, this message translates to:
  /// **'Start at keyword #'**
  String get searchKeywordsStartAtTitle;

  /// No description provided for @searchKeywordsStartAtHint.
  ///
  /// In en, this message translates to:
  /// **'Skips everything before it for this run only — it doesn\'t change which keywords are marked done.'**
  String get searchKeywordsStartAtHint;

  /// No description provided for @searchKeywordsStartAtLabel.
  ///
  /// In en, this message translates to:
  /// **'Keyword number (1–{max})'**
  String searchKeywordsStartAtLabel(String max);

  /// No description provided for @searchKeywordsStartAtAction.
  ///
  /// In en, this message translates to:
  /// **'Start here'**
  String get searchKeywordsStartAtAction;

  /// No description provided for @searchProgressStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting the pipeline…'**
  String get searchProgressStarting;

  /// No description provided for @searchWarmupRunning.
  ///
  /// In en, this message translates to:
  /// **'Getting the team\'s latest data — a search started now waits a few seconds for it.'**
  String get searchWarmupRunning;

  /// No description provided for @searchWarmupReady.
  ///
  /// In en, this message translates to:
  /// **'Team data is up to date.'**
  String get searchWarmupReady;

  /// Search page shared-data line once the background pull has finished and some time has passed. Says nothing about searches, which never wait for it.
  ///
  /// In en, this message translates to:
  /// **'Team data updated {minutes} min ago.'**
  String searchWarmupReadyAge(int minutes);

  /// No description provided for @searchWarmupStale.
  ///
  /// In en, this message translates to:
  /// **'Team data refreshes in the background, before you search.'**
  String get searchWarmupStale;

  /// No description provided for @searchWarmupFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t refresh the team\'s data — the search will fetch it itself.'**
  String get searchWarmupFailed;

  /// No description provided for @searchWarmupRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh now'**
  String get searchWarmupRefresh;

  /// Headline of the progress panel while a keyword is being worked.
  ///
  /// In en, this message translates to:
  /// **'Keyword {index} of {total} — {keyword}'**
  String searchProgressOnKeyword(int index, int total, String keyword);

  /// No description provided for @searchProgressCompleted.
  ///
  /// In en, this message translates to:
  /// **'Run complete — {channelsFound} channels found'**
  String searchProgressCompleted(int channelsFound);

  /// No description provided for @searchProgressStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped after {done} keyword(s) — everything found is saved'**
  String searchProgressStopped(int done);

  /// No description provided for @searchProgressFailed.
  ///
  /// In en, this message translates to:
  /// **'The run ended unexpectedly. Check the log below.'**
  String get searchProgressFailed;

  /// No description provided for @searchProgressChannels.
  ///
  /// In en, this message translates to:
  /// **'{count} channels'**
  String searchProgressChannels(String count);

  /// No description provided for @searchProgressVideos.
  ///
  /// In en, this message translates to:
  /// **'{count} videos'**
  String searchProgressVideos(String count);

  /// Countdown shown while a run is waiting out a YouTube rate limit.
  ///
  /// In en, this message translates to:
  /// **'Waiting {seconds}s before retrying...'**
  String searchBackoffWaiting(String seconds);

  /// No description provided for @searchTryAgainNow.
  ///
  /// In en, this message translates to:
  /// **'Try again now'**
  String get searchTryAgainNow;

  /// No description provided for @searchRouteDirectOnly.
  ///
  /// In en, this message translates to:
  /// **'No AWS or proxies: every request goes out from this computer'**
  String get searchRouteDirectOnly;

  /// No description provided for @searchRouteAwsInUse.
  ///
  /// In en, this message translates to:
  /// **'AWS in use · {count} requests'**
  String searchRouteAwsInUse(String count);

  /// No description provided for @searchRouteAwsIdle.
  ///
  /// In en, this message translates to:
  /// **'AWS ready · not used yet'**
  String get searchRouteAwsIdle;

  /// No description provided for @searchRouteProxiesInUse.
  ///
  /// In en, this message translates to:
  /// **'Proxies in use · {count} requests'**
  String searchRouteProxiesInUse(String count);

  /// No description provided for @searchRouteProxiesIdle.
  ///
  /// In en, this message translates to:
  /// **'Proxies ready · not used yet'**
  String get searchRouteProxiesIdle;

  /// No description provided for @searchRouteThisMachine.
  ///
  /// In en, this message translates to:
  /// **'This computer · {count} requests'**
  String searchRouteThisMachine(String count);

  /// No description provided for @searchRouteParallel.
  ///
  /// In en, this message translates to:
  /// **'{workers} keywords at a time · Normal speed'**
  String searchRouteParallel(int workers);

  /// No description provided for @searchRouteOneAtATimeFast.
  ///
  /// In en, this message translates to:
  /// **'One keyword at a time · Fast speed'**
  String get searchRouteOneAtATimeFast;

  /// No description provided for @searchRouteOneAtATimeNormal.
  ///
  /// In en, this message translates to:
  /// **'One keyword at a time · Normal speed'**
  String get searchRouteOneAtATimeNormal;

  /// No description provided for @searchRouteLast.
  ///
  /// In en, this message translates to:
  /// **'Last request through {label}'**
  String searchRouteLast(String label);

  /// No description provided for @searchAlsoRunning.
  ///
  /// In en, this message translates to:
  /// **'Also running: {keywords}'**
  String searchAlsoRunning(String keywords);

  /// No description provided for @searchStopButton.
  ///
  /// In en, this message translates to:
  /// **'Stop searching'**
  String get searchStopButton;

  /// No description provided for @searchStopRequested.
  ///
  /// In en, this message translates to:
  /// **'Stopping — the run finishes its current step first.'**
  String get searchStopRequested;

  /// No description provided for @searchResumeButton.
  ///
  /// In en, this message translates to:
  /// **'Resume searching'**
  String get searchResumeButton;

  /// No description provided for @searchStartFromTop.
  ///
  /// In en, this message translates to:
  /// **'Start from the top'**
  String get searchStartFromTop;

  /// No description provided for @searchAllKeywordsDone.
  ///
  /// In en, this message translates to:
  /// **'Every keyword in the list is already done. Start from the top to run them again.'**
  String get searchAllKeywordsDone;

  /// Shown under the keyword box between runs when the last run did not finish the list.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} done — Start resumes at “{nextKeyword}”.'**
  String searchResumeNotice(int done, int total, String nextKeyword);

  /// No description provided for @searchSettingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Search settings'**
  String get searchSettingsTitle;

  /// No description provided for @searchSortByLabel.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get searchSortByLabel;

  /// No description provided for @searchSortByRelevance.
  ///
  /// In en, this message translates to:
  /// **'Relevance'**
  String get searchSortByRelevance;

  /// No description provided for @searchSortByUploadDate.
  ///
  /// In en, this message translates to:
  /// **'Upload date'**
  String get searchSortByUploadDate;

  /// No description provided for @searchSortByViewCount.
  ///
  /// In en, this message translates to:
  /// **'View count'**
  String get searchSortByViewCount;

  /// No description provided for @searchSortByRating.
  ///
  /// In en, this message translates to:
  /// **'Rating'**
  String get searchSortByRating;

  /// No description provided for @searchResultsTypeLabel.
  ///
  /// In en, this message translates to:
  /// **'Results type'**
  String get searchResultsTypeLabel;

  /// No description provided for @searchResultsTypeVideo.
  ///
  /// In en, this message translates to:
  /// **'Videos'**
  String get searchResultsTypeVideo;

  /// No description provided for @searchResultsTypeChannel.
  ///
  /// In en, this message translates to:
  /// **'Channels'**
  String get searchResultsTypeChannel;

  /// No description provided for @searchCountryLabel.
  ///
  /// In en, this message translates to:
  /// **'Countries'**
  String get searchCountryLabel;

  /// No description provided for @searchCountryHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. US, EG — leave blank for any'**
  String get searchCountryHint;

  /// No description provided for @searchCountryPickTitle.
  ///
  /// In en, this message translates to:
  /// **'Target countries'**
  String get searchCountryPickTitle;

  /// No description provided for @searchCountryClearAll.
  ///
  /// In en, this message translates to:
  /// **'Clear all'**
  String get searchCountryClearAll;

  /// No description provided for @searchCountryEnglishMarkets.
  ///
  /// In en, this message translates to:
  /// **'English markets'**
  String get searchCountryEnglishMarkets;

  /// No description provided for @searchHandleLimitLabel.
  ///
  /// In en, this message translates to:
  /// **'Handle limit'**
  String get searchHandleLimitLabel;

  /// No description provided for @searchOverrideHint.
  ///
  /// In en, this message translates to:
  /// **'Leave blank to use the shared default'**
  String get searchOverrideHint;

  /// No description provided for @searchStartButton.
  ///
  /// In en, this message translates to:
  /// **'Start searching'**
  String get searchStartButton;

  /// No description provided for @searchNoKeywordsError.
  ///
  /// In en, this message translates to:
  /// **'Add at least one keyword first.'**
  String get searchNoKeywordsError;

  /// No description provided for @searchStartedByThisDevice.
  ///
  /// In en, this message translates to:
  /// **'This device'**
  String get searchStartedByThisDevice;

  /// No description provided for @searchStarted.
  ///
  /// In en, this message translates to:
  /// **'Search started — it\'s now running on this machine.'**
  String get searchStarted;

  /// No description provided for @searchStartFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t start the search: {error}'**
  String searchStartFailed(String error);

  /// No description provided for @searchUploadButtonLabel.
  ///
  /// In en, this message translates to:
  /// **'Send keywords'**
  String get searchUploadButtonLabel;

  /// No description provided for @searchUploadDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Send keywords to a teammate'**
  String get searchUploadDialogTitle;

  /// No description provided for @searchUploadDialogTitleTo.
  ///
  /// In en, this message translates to:
  /// **'Send keywords to {name}'**
  String searchUploadDialogTitleTo(String name);

  /// No description provided for @searchUploadKeywordsHint.
  ///
  /// In en, this message translates to:
  /// **'One keyword per line'**
  String get searchUploadKeywordsHint;

  /// No description provided for @searchUploadRecipientSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Send to'**
  String get searchUploadRecipientSectionTitle;

  /// No description provided for @searchUploadOnlineLabel.
  ///
  /// In en, this message translates to:
  /// **'Online'**
  String get searchUploadOnlineLabel;

  /// No description provided for @searchUploadOfflineLabel.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get searchUploadOfflineLabel;

  /// No description provided for @searchUploadSendButton.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get searchUploadSendButton;

  /// No description provided for @searchUploadNoTeammates.
  ///
  /// In en, this message translates to:
  /// **'No other teammates yet.'**
  String get searchUploadNoTeammates;

  /// No description provided for @searchUploadNoRecipientError.
  ///
  /// In en, this message translates to:
  /// **'Choose who to send these keywords to.'**
  String get searchUploadNoRecipientError;

  /// No description provided for @searchUploadSent.
  ///
  /// In en, this message translates to:
  /// **'Sent {name} {count} keyword(s).'**
  String searchUploadSent(String name, int count);

  /// No description provided for @searchUploadSendFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t send: {error}'**
  String searchUploadSendFailed(String error);

  /// No description provided for @searchProgressTitle.
  ///
  /// In en, this message translates to:
  /// **'Progress'**
  String get searchProgressTitle;

  /// No description provided for @progressMaximizeTooltip.
  ///
  /// In en, this message translates to:
  /// **'Maximize progress'**
  String get progressMaximizeTooltip;

  /// No description provided for @progressRestoreTooltip.
  ///
  /// In en, this message translates to:
  /// **'Restore'**
  String get progressRestoreTooltip;

  /// No description provided for @searchProgressEmpty.
  ///
  /// In en, this message translates to:
  /// **'No search has been run yet.'**
  String get searchProgressEmpty;

  /// No description provided for @backfillProgressTitle.
  ///
  /// In en, this message translates to:
  /// **'Video backfill'**
  String get backfillProgressTitle;

  /// Headline of the backfill progress panel while it is running.
  ///
  /// In en, this message translates to:
  /// **'Pulling older uploads for @{handle}'**
  String backfillProgressRunning(String handle);

  /// No description provided for @backfillProgressCompleted.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No new videos found} =1{1 new video added} other{{count} new videos added}} for @{handle}'**
  String backfillProgressCompleted(int count, String handle);

  /// No description provided for @backfillProgressFailed.
  ///
  /// In en, this message translates to:
  /// **'The backfill for @{handle} ended unexpectedly. Check the log below.'**
  String backfillProgressFailed(String handle);

  /// No description provided for @reenrichProgressTitle.
  ///
  /// In en, this message translates to:
  /// **'Freed from the archive'**
  String get reenrichProgressTitle;

  /// Headline of the re-enrich progress panel while it is running.
  ///
  /// In en, this message translates to:
  /// **'Enriching {handle}…'**
  String reenrichProgressRunning(String handle);

  /// No description provided for @reenrichProgressCompleted.
  ///
  /// In en, this message translates to:
  /// **'{handle} enriched — it is back in the Influencers list'**
  String reenrichProgressCompleted(String handle);

  /// No description provided for @reenrichProgressFailed.
  ///
  /// In en, this message translates to:
  /// **'Enriching {handle} ended unexpectedly. Check the log below.'**
  String reenrichProgressFailed(String handle);

  /// No description provided for @navBadgeRunning.
  ///
  /// In en, this message translates to:
  /// **'Something is running in the background'**
  String get navBadgeRunning;

  /// No description provided for @navBadgeSuccess.
  ///
  /// In en, this message translates to:
  /// **'Finished — open Search to see the result'**
  String get navBadgeSuccess;

  /// No description provided for @navBadgeError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong — open Search for details'**
  String get navBadgeError;

  /// No description provided for @commonAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get commonAdd;

  /// No description provided for @commonCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get commonCopy;

  /// No description provided for @commonSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get commonSave;

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get commonDelete;

  /// No description provided for @commonCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get commonCreate;

  /// No description provided for @brandListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No brands yet.'**
  String get brandListEmpty;

  /// No description provided for @brandNotFound.
  ///
  /// In en, this message translates to:
  /// **'Brand not found.'**
  String get brandNotFound;

  /// No description provided for @brandProfileContactTitle.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get brandProfileContactTitle;

  /// No description provided for @brandProfileContactPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get brandProfileContactPhone;

  /// No description provided for @brandProfileWebsite.
  ///
  /// In en, this message translates to:
  /// **'Website'**
  String get brandProfileWebsite;

  /// No description provided for @brandProfileBudget.
  ///
  /// In en, this message translates to:
  /// **'Budget'**
  String get brandProfileBudget;

  /// No description provided for @brandProfileCampaignBrief.
  ///
  /// In en, this message translates to:
  /// **'Campaign brief'**
  String get brandProfileCampaignBrief;

  /// No description provided for @brandProfilePreferredCriteriaTitle.
  ///
  /// In en, this message translates to:
  /// **'Preferred influencer criteria'**
  String get brandProfilePreferredCriteriaTitle;

  /// No description provided for @brandProfileNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Notes for future deals with this brand'**
  String get brandProfileNotesHint;

  /// No description provided for @brandProfileDealHistoryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No deals yet with this brand.'**
  String get brandProfileDealHistoryEmpty;

  /// No description provided for @dealListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No deals yet.'**
  String get dealListEmpty;

  /// No description provided for @dealNotFound.
  ///
  /// In en, this message translates to:
  /// **'Deal not found.'**
  String get dealNotFound;

  /// No description provided for @dealDetailStageLabel.
  ///
  /// In en, this message translates to:
  /// **'Stage'**
  String get dealDetailStageLabel;

  /// No description provided for @dealDetailPricingTitle.
  ///
  /// In en, this message translates to:
  /// **'Pricing'**
  String get dealDetailPricingTitle;

  /// No description provided for @dealDetailBrandPays.
  ///
  /// In en, this message translates to:
  /// **'Brand pays'**
  String get dealDetailBrandPays;

  /// No description provided for @dealDetailInfluencerReceives.
  ///
  /// In en, this message translates to:
  /// **'Influencer receives'**
  String get dealDetailInfluencerReceives;

  /// No description provided for @dealDetailMargin.
  ///
  /// In en, this message translates to:
  /// **'Agency margin'**
  String get dealDetailMargin;

  /// No description provided for @dealDetailDeliverablesTitle.
  ///
  /// In en, this message translates to:
  /// **'Deliverables'**
  String get dealDetailDeliverablesTitle;

  /// No description provided for @dealDetailDeadlineLabel.
  ///
  /// In en, this message translates to:
  /// **'Deadline'**
  String get dealDetailDeadlineLabel;

  /// No description provided for @dealDetailNoDeadline.
  ///
  /// In en, this message translates to:
  /// **'No deadline set'**
  String get dealDetailNoDeadline;

  /// No description provided for @dealDetailContractTitle.
  ///
  /// In en, this message translates to:
  /// **'Contract'**
  String get dealDetailContractTitle;

  /// No description provided for @dealDetailCopyContractLink.
  ///
  /// In en, this message translates to:
  /// **'Copy link'**
  String get dealDetailCopyContractLink;

  /// No description provided for @dealDetailWorkingDaysLabel.
  ///
  /// In en, this message translates to:
  /// **'Working days'**
  String get dealDetailWorkingDaysLabel;

  /// No description provided for @dealDetailPartiesTitle.
  ///
  /// In en, this message translates to:
  /// **'Parties'**
  String get dealDetailPartiesTitle;

  /// No description provided for @dealDetailBrandLabel.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get dealDetailBrandLabel;

  /// No description provided for @dealDetailInfluencerLabel.
  ///
  /// In en, this message translates to:
  /// **'Influencer'**
  String get dealDetailInfluencerLabel;

  /// No description provided for @dealDetailNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Notes about this specific deal round'**
  String get dealDetailNotesHint;

  /// No description provided for @dealDetailCreatedAt.
  ///
  /// In en, this message translates to:
  /// **'Created {date}'**
  String dealDetailCreatedAt(String date);

  /// No description provided for @dealDetailUpdatedAt.
  ///
  /// In en, this message translates to:
  /// **'Last updated {date}'**
  String dealDetailUpdatedAt(String date);

  /// No description provided for @outreachTemplatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Template library'**
  String get outreachTemplatesTitle;

  /// No description provided for @outreachAddTemplate.
  ///
  /// In en, this message translates to:
  /// **'New template'**
  String get outreachAddTemplate;

  /// No description provided for @outreachEditTemplateTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit template'**
  String get outreachEditTemplateTitle;

  /// No description provided for @outreachNewTemplateTitle.
  ///
  /// In en, this message translates to:
  /// **'New template'**
  String get outreachNewTemplateTitle;

  /// No description provided for @outreachTemplateNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get outreachTemplateNameLabel;

  /// No description provided for @outreachTemplateSubjectLabel.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get outreachTemplateSubjectLabel;

  /// No description provided for @outreachTemplateBodyLabel.
  ///
  /// In en, this message translates to:
  /// **'Body'**
  String get outreachTemplateBodyLabel;

  /// No description provided for @outreachTemplateKindEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get outreachTemplateKindEmail;

  /// No description provided for @outreachTemplateKindDm.
  ///
  /// In en, this message translates to:
  /// **'DM'**
  String get outreachTemplateKindDm;

  /// No description provided for @outreachTemplateTokenHint.
  ///
  /// In en, this message translates to:
  /// **'Placeholders in double curly braces are filled from the influencer: handle, name, lastVideoTitle, lastVideoDate, subscriberCount, country'**
  String get outreachTemplateTokenHint;

  /// No description provided for @outreachThreadsTitle.
  ///
  /// In en, this message translates to:
  /// **'Conversations'**
  String get outreachThreadsTitle;

  /// No description provided for @outreachThreadListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No outreach threads yet.'**
  String get outreachThreadListEmpty;

  /// No description provided for @outreachSelectThreadHint.
  ///
  /// In en, this message translates to:
  /// **'Select a conversation to see its history and draft a message.'**
  String get outreachSelectThreadHint;

  /// No description provided for @outreachStatusNotContactedYet.
  ///
  /// In en, this message translates to:
  /// **'Not contacted'**
  String get outreachStatusNotContactedYet;

  /// No description provided for @outreachStatusAwaitingReply.
  ///
  /// In en, this message translates to:
  /// **'Awaiting reply'**
  String get outreachStatusAwaitingReply;

  /// No description provided for @outreachStatusReplied.
  ///
  /// In en, this message translates to:
  /// **'Replied'**
  String get outreachStatusReplied;

  /// No description provided for @outreachStatusNeedsFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Needs follow-up'**
  String get outreachStatusNeedsFollowUp;

  /// No description provided for @outreachMessagesTitle.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get outreachMessagesTitle;

  /// No description provided for @outreachNoMessages.
  ///
  /// In en, this message translates to:
  /// **'No messages yet.'**
  String get outreachNoMessages;

  /// No description provided for @outreachComposeTitle.
  ///
  /// In en, this message translates to:
  /// **'Draft a message'**
  String get outreachComposeTitle;

  /// No description provided for @outreachComposeWordCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{0 words} =1{1 word} other{{count} words}}'**
  String outreachComposeWordCount(int count);

  /// No description provided for @outreachSelectTemplateLabel.
  ///
  /// In en, this message translates to:
  /// **'Template'**
  String get outreachSelectTemplateLabel;

  /// No description provided for @outreachNoTemplateOption.
  ///
  /// In en, this message translates to:
  /// **'No template — write from scratch'**
  String get outreachNoTemplateOption;

  /// No description provided for @outreachAiProviderLabel.
  ///
  /// In en, this message translates to:
  /// **'AI provider'**
  String get outreachAiProviderLabel;

  /// No description provided for @outreachGenerateDraft.
  ///
  /// In en, this message translates to:
  /// **'Generate draft'**
  String get outreachGenerateDraft;

  /// No description provided for @outreachDraftGenerated.
  ///
  /// In en, this message translates to:
  /// **'Draft generated.'**
  String get outreachDraftGenerated;

  /// No description provided for @outreachSubjectLabel.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get outreachSubjectLabel;

  /// No description provided for @outreachBodyLabel.
  ///
  /// In en, this message translates to:
  /// **'Body'**
  String get outreachBodyLabel;

  /// No description provided for @outreachRecordSent.
  ///
  /// In en, this message translates to:
  /// **'Record as sent'**
  String get outreachRecordSent;

  /// No description provided for @outreachMessageRecorded.
  ///
  /// In en, this message translates to:
  /// **'Message recorded.'**
  String get outreachMessageRecorded;

  /// No description provided for @outreachMarkReplied.
  ///
  /// In en, this message translates to:
  /// **'Mark as replied'**
  String get outreachMarkReplied;

  /// No description provided for @outreachThreadMarkedReplied.
  ///
  /// In en, this message translates to:
  /// **'Marked as replied.'**
  String get outreachThreadMarkedReplied;

  /// No description provided for @outreachWritingRulesTitle.
  ///
  /// In en, this message translates to:
  /// **'My writing rules'**
  String get outreachWritingRulesTitle;

  /// No description provided for @outreachWritingRulesHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. always mention we\'re a boutique agency, keep it under 120 words'**
  String get outreachWritingRulesHint;

  /// No description provided for @outreachBackToList.
  ///
  /// In en, this message translates to:
  /// **'Back to conversations'**
  String get outreachBackToList;

  /// No description provided for @outreachDraftGenerationFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t generate a draft: {error}'**
  String outreachDraftGenerationFailed(String error);

  /// No description provided for @settingsGeneralTitle.
  ///
  /// In en, this message translates to:
  /// **'General'**
  String get settingsGeneralTitle;

  /// No description provided for @settingsLanguageLabel.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguageLabel;

  /// No description provided for @settingsLanguageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLanguageEnglish;

  /// No description provided for @settingsLanguageArabic.
  ///
  /// In en, this message translates to:
  /// **'Arabic'**
  String get settingsLanguageArabic;

  /// No description provided for @settingsThemeLabel.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsThemeLabel;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsTimeZoneLabel.
  ///
  /// In en, this message translates to:
  /// **'Display time zone'**
  String get settingsTimeZoneLabel;

  /// No description provided for @settingsTimeZoneSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Every date and time in the app is shown in this zone. Stored data always stays in UTC, so changing this is safe.'**
  String get settingsTimeZoneSubtitle;

  /// No description provided for @settingsTimeZoneSystemDefault.
  ///
  /// In en, this message translates to:
  /// **'Device default ({zone})'**
  String settingsTimeZoneSystemDefault(String zone);

  /// No description provided for @settingsTimeZoneChange.
  ///
  /// In en, this message translates to:
  /// **'Change zone'**
  String get settingsTimeZoneChange;

  /// No description provided for @settingsTimeZoneChangeButton.
  ///
  /// In en, this message translates to:
  /// **'{zone} - Change zone'**
  String settingsTimeZoneChangeButton(String zone);

  /// No description provided for @settingsTimeZoneUseDevice.
  ///
  /// In en, this message translates to:
  /// **'Use device default'**
  String get settingsTimeZoneUseDevice;

  /// No description provided for @settingsTimeZoneSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search zones — e.g. Cairo'**
  String get settingsTimeZoneSearchHint;

  /// No description provided for @settingsTimeZoneNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No matching time zones.'**
  String get settingsTimeZoneNoMatches;

  /// No description provided for @settingsStartupTitle.
  ///
  /// In en, this message translates to:
  /// **'Launch at startup'**
  String get settingsStartupTitle;

  /// No description provided for @settingsStartupNoSupport.
  ///
  /// In en, this message translates to:
  /// **'Not available on this platform.'**
  String get settingsStartupNoSupport;

  /// No description provided for @settingsLaunchAtStartupLabel.
  ///
  /// In en, this message translates to:
  /// **'Open automatically when you log in'**
  String get settingsLaunchAtStartupLabel;

  /// No description provided for @settingsLaunchAtStartupOn.
  ///
  /// In en, this message translates to:
  /// **'On: the app will open automatically next time you log in.'**
  String get settingsLaunchAtStartupOn;

  /// No description provided for @settingsLaunchAtStartupOff.
  ///
  /// In en, this message translates to:
  /// **'Off: you\'ll need to open the app yourself.'**
  String get settingsLaunchAtStartupOff;

  /// No description provided for @settingsAlwaysOnTopTitle.
  ///
  /// In en, this message translates to:
  /// **'Always on top'**
  String get settingsAlwaysOnTopTitle;

  /// No description provided for @settingsAlwaysOnTopNoSupport.
  ///
  /// In en, this message translates to:
  /// **'Not supported on this platform.'**
  String get settingsAlwaysOnTopNoSupport;

  /// No description provided for @settingsAlwaysOnTopLabel.
  ///
  /// In en, this message translates to:
  /// **'Keep window on top'**
  String get settingsAlwaysOnTopLabel;

  /// No description provided for @settingsAlwaysOnTopOn.
  ///
  /// In en, this message translates to:
  /// **'Currently on top of other windows.'**
  String get settingsAlwaysOnTopOn;

  /// No description provided for @settingsAlwaysOnTopOff.
  ///
  /// In en, this message translates to:
  /// **'Not pinned above other windows.'**
  String get settingsAlwaysOnTopOff;

  /// No description provided for @settingsAiProvidersTitle.
  ///
  /// In en, this message translates to:
  /// **'AI providers'**
  String get settingsAiProvidersTitle;

  /// No description provided for @settingsAiProvidersSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Register your own API key to draft outreach emails with a real AI model. The template-fill fallback always stays available and needs no key.'**
  String get settingsAiProvidersSubtitle;

  /// No description provided for @settingsAiProvidersEmpty.
  ///
  /// In en, this message translates to:
  /// **'No AI providers registered yet — drafts fall back to template-fill only.'**
  String get settingsAiProvidersEmpty;

  /// No description provided for @settingsAiProviderSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{model} · key {maskedKey}'**
  String settingsAiProviderSubtitle(String model, String maskedKey);

  /// No description provided for @settingsAddAiProvider.
  ///
  /// In en, this message translates to:
  /// **'Add provider'**
  String get settingsAddAiProvider;

  /// No description provided for @settingsNewAiProviderTitle.
  ///
  /// In en, this message translates to:
  /// **'New AI provider'**
  String get settingsNewAiProviderTitle;

  /// No description provided for @settingsEditAiProviderTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit AI provider'**
  String get settingsEditAiProviderTitle;

  /// No description provided for @settingsAiProviderNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get settingsAiProviderNameLabel;

  /// No description provided for @settingsAiProviderKeyLabel.
  ///
  /// In en, this message translates to:
  /// **'API key'**
  String get settingsAiProviderKeyLabel;

  /// No description provided for @settingsAiProviderModelLabel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get settingsAiProviderModelLabel;

  /// No description provided for @settingsAiProviderKeyHint.
  ///
  /// In en, this message translates to:
  /// **'Stored encrypted on this device only — never synced or shared with the team.'**
  String get settingsAiProviderKeyHint;

  /// No description provided for @settingsTeamSyncTitle.
  ///
  /// In en, this message translates to:
  /// **'Team sync'**
  String get settingsTeamSyncTitle;

  /// No description provided for @settingsTeamSyncSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Connect to the team\'s shared PocketBase instance so brands, deals, and outreach sync across everyone\'s devices. Leave the URL blank to keep working locally on this device only.'**
  String get settingsTeamSyncSubtitle;

  /// No description provided for @settingsTeamSyncUrlLabel.
  ///
  /// In en, this message translates to:
  /// **'PocketBase URL'**
  String get settingsTeamSyncUrlLabel;

  /// No description provided for @settingsTeamSyncEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'Superuser email'**
  String get settingsTeamSyncEmailLabel;

  /// No description provided for @settingsTeamSyncPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Superuser password'**
  String get settingsTeamSyncPasswordLabel;

  /// No description provided for @settingsTeamSyncHint.
  ///
  /// In en, this message translates to:
  /// **'The whole team signs in with this same login — it isn\'t a personal account, so anyone can enter it here from any device.'**
  String get settingsTeamSyncHint;

  /// No description provided for @settingsTeamSyncTestConnection.
  ///
  /// In en, this message translates to:
  /// **'Test connection'**
  String get settingsTeamSyncTestConnection;

  /// No description provided for @settingsTeamSyncTestSuccess.
  ///
  /// In en, this message translates to:
  /// **'Connected successfully.'**
  String get settingsTeamSyncTestSuccess;

  /// No description provided for @settingsTeamSyncTestFailure.
  ///
  /// In en, this message translates to:
  /// **'Connection failed: {error}'**
  String settingsTeamSyncTestFailure(String error);

  /// No description provided for @settingsTeamSyncEnterUrlFirst.
  ///
  /// In en, this message translates to:
  /// **'Enter a PocketBase URL first.'**
  String get settingsTeamSyncEnterUrlFirst;

  /// No description provided for @settingsTeamSyncSaved.
  ///
  /// In en, this message translates to:
  /// **'Team sync settings saved.'**
  String get settingsTeamSyncSaved;

  /// No description provided for @settingsTeamSyncStatusNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Local-only'**
  String get settingsTeamSyncStatusNotConfigured;

  /// No description provided for @settingsTeamSyncStatusChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking…'**
  String get settingsTeamSyncStatusChecking;

  /// No description provided for @settingsTeamSyncStatusConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get settingsTeamSyncStatusConnected;

  /// No description provided for @settingsTeamSyncStatusFailed.
  ///
  /// In en, this message translates to:
  /// **'Not connected'**
  String get settingsTeamSyncStatusFailed;

  /// No description provided for @settingsPythonEnvironmentTitle.
  ///
  /// In en, this message translates to:
  /// **'Python environment'**
  String get settingsPythonEnvironmentTitle;

  /// No description provided for @settingsPythonEnvironmentSubtitle.
  ///
  /// In en, this message translates to:
  /// **'How this machine launches the local search pipeline — per-device, not shared with the team.'**
  String get settingsPythonEnvironmentSubtitle;

  /// No description provided for @settingsPythonExecutableLabel.
  ///
  /// In en, this message translates to:
  /// **'Python executable (blank = the one shipped with the app)'**
  String get settingsPythonExecutableLabel;

  /// No description provided for @settingsProjectRootOverrideLabel.
  ///
  /// In en, this message translates to:
  /// **'Project root override'**
  String get settingsProjectRootOverrideLabel;

  /// No description provided for @settingsProjectRootOverrideHint.
  ///
  /// In en, this message translates to:
  /// **'Leave blank unless the pipeline lives in another folder'**
  String get settingsProjectRootOverrideHint;

  /// No description provided for @settingsPythonEnvironmentSaved.
  ///
  /// In en, this message translates to:
  /// **'Python environment settings saved.'**
  String get settingsPythonEnvironmentSaved;

  /// No description provided for @settingsSearchTuningTitle.
  ///
  /// In en, this message translates to:
  /// **'Advanced Search Tuning'**
  String get settingsSearchTuningTitle;

  /// No description provided for @settingsSearchTuningSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Pacing, proxy, and threshold settings the scraper uses'**
  String get settingsSearchTuningSubtitle;

  /// No description provided for @settingsSearchTuningSaved.
  ///
  /// In en, this message translates to:
  /// **'Search tuning settings saved.'**
  String get settingsSearchTuningSaved;

  /// No description provided for @settingsSearchTuningDesktopOnly.
  ///
  /// In en, this message translates to:
  /// **'Search tuning only applies on the desktop machine that runs the scraper.'**
  String get settingsSearchTuningDesktopOnly;

  /// No description provided for @settingsThresholdsTitle.
  ///
  /// In en, this message translates to:
  /// **'Thresholds'**
  String get settingsThresholdsTitle;

  /// No description provided for @settingsMinimumSubscribersLabel.
  ///
  /// In en, this message translates to:
  /// **'Minimum subscribers'**
  String get settingsMinimumSubscribersLabel;

  /// No description provided for @settingsHandlesLimitLabel.
  ///
  /// In en, this message translates to:
  /// **'Handles per search run'**
  String get settingsHandlesLimitLabel;

  /// No description provided for @settingsRecentVideosMonthsLabel.
  ///
  /// In en, this message translates to:
  /// **'Recent-video window (months)'**
  String get settingsRecentVideosMonthsLabel;

  /// No description provided for @settingsPacingTitle.
  ///
  /// In en, this message translates to:
  /// **'Pacing'**
  String get settingsPacingTitle;

  /// No description provided for @settingsPacingHint.
  ///
  /// In en, this message translates to:
  /// **'Each delay is sampled randomly between its min and max on every request.'**
  String get settingsPacingHint;

  /// No description provided for @settingsPacingNormalTab.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get settingsPacingNormalTab;

  /// No description provided for @settingsPacingFastTab.
  ///
  /// In en, this message translates to:
  /// **'Fast (rotated IP)'**
  String get settingsPacingFastTab;

  /// No description provided for @settingsPacingFastLockedHint.
  ///
  /// In en, this message translates to:
  /// **'Only applied while proxy rotation or the AWS Gateway is on -- every request goes out under a different IP then, so these can run much faster without burning one address. Safe to edit now; the scraper won\'t use it until rotation is enabled.'**
  String get settingsPacingFastLockedHint;

  /// No description provided for @settingsHumanScrollDelayLabel.
  ///
  /// In en, this message translates to:
  /// **'Human scroll delay'**
  String get settingsHumanScrollDelayLabel;

  /// No description provided for @settingsJitterDelayLabel.
  ///
  /// In en, this message translates to:
  /// **'Jitter delay'**
  String get settingsJitterDelayLabel;

  /// No description provided for @settingsRecentVideosDelayLabel.
  ///
  /// In en, this message translates to:
  /// **'Recent-videos fetch delay'**
  String get settingsRecentVideosDelayLabel;

  /// No description provided for @settingsFastSubCountDelayLabel.
  ///
  /// In en, this message translates to:
  /// **'Fast sub-count check delay'**
  String get settingsFastSubCountDelayLabel;

  /// No description provided for @settingsFoundChannelsDelayLabel.
  ///
  /// In en, this message translates to:
  /// **'Found-channels delay'**
  String get settingsFoundChannelsDelayLabel;

  /// No description provided for @settingsIpCooldownLabel.
  ///
  /// In en, this message translates to:
  /// **'IP cooldown duration'**
  String get settingsIpCooldownLabel;

  /// No description provided for @settingsIpCooldownChanceLabel.
  ///
  /// In en, this message translates to:
  /// **'IP cooldown chance: {percent}%'**
  String settingsIpCooldownChanceLabel(String percent);

  /// No description provided for @settingsProxyTitle.
  ///
  /// In en, this message translates to:
  /// **'Proxy'**
  String get settingsProxyTitle;

  /// No description provided for @settingsProxyHostLabel.
  ///
  /// In en, this message translates to:
  /// **'Host'**
  String get settingsProxyHostLabel;

  /// No description provided for @settingsProxyPortLabel.
  ///
  /// In en, this message translates to:
  /// **'Port'**
  String get settingsProxyPortLabel;

  /// No description provided for @settingsProxyUsernameLabel.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get settingsProxyUsernameLabel;

  /// No description provided for @settingsProxyPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get settingsProxyPasswordLabel;

  /// No description provided for @settingsProxyEnableRotationLabel.
  ///
  /// In en, this message translates to:
  /// **'Enable proxy rotation'**
  String get settingsProxyEnableRotationLabel;

  /// No description provided for @settingsProxyIncludeDirectLabel.
  ///
  /// In en, this message translates to:
  /// **'Include this machine (no proxy)'**
  String get settingsProxyIncludeDirectLabel;

  /// No description provided for @settingsProxyIncludeDirectHint.
  ///
  /// In en, this message translates to:
  /// **'Lets requests keep going out from this machine\'s own connection sometimes, not only through the proxies below.'**
  String get settingsProxyIncludeDirectHint;

  /// No description provided for @settingsProxyLabelField.
  ///
  /// In en, this message translates to:
  /// **'Label'**
  String get settingsProxyLabelField;

  /// No description provided for @settingsProxyEnabledLabel.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get settingsProxyEnabledLabel;

  /// No description provided for @settingsProxyListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No proxies added yet.'**
  String get settingsProxyListEmpty;

  /// No description provided for @settingsAddProxy.
  ///
  /// In en, this message translates to:
  /// **'Add proxy'**
  String get settingsAddProxy;

  /// No description provided for @settingsNewProxyTitle.
  ///
  /// In en, this message translates to:
  /// **'New proxy'**
  String get settingsNewProxyTitle;

  /// No description provided for @settingsEditProxyTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit proxy'**
  String get settingsEditProxyTitle;

  /// No description provided for @settingsAwsGatewayTitle.
  ///
  /// In en, this message translates to:
  /// **'AWS Gateway IP rotation'**
  String get settingsAwsGatewayTitle;

  /// No description provided for @settingsAwsGatewayHint.
  ///
  /// In en, this message translates to:
  /// **'Routes requests through AWS API Gateway endpoints in different regions instead of a proxy list. Deployed and destroyed separately, with tools/aws_gateway_setup.py.'**
  String get settingsAwsGatewayHint;

  /// No description provided for @settingsAwsGatewayEmpty.
  ///
  /// In en, this message translates to:
  /// **'No gateways deployed yet. Run \"python tools/aws_gateway_setup.py deploy\" on the machine that runs searches.'**
  String get settingsAwsGatewayEmpty;

  /// No description provided for @settingsAwsGatewayEnabledToast.
  ///
  /// In en, this message translates to:
  /// **'AWS Gateway rotation enabled.'**
  String get settingsAwsGatewayEnabledToast;

  /// No description provided for @settingsAwsGatewayDisabledToast.
  ///
  /// In en, this message translates to:
  /// **'AWS Gateway rotation disabled.'**
  String get settingsAwsGatewayDisabledToast;

  /// No description provided for @settingsParallelTitle.
  ///
  /// In en, this message translates to:
  /// **'Parallel search'**
  String get settingsParallelTitle;

  /// No description provided for @settingsParallelHint.
  ///
  /// In en, this message translates to:
  /// **'Works several keywords at once, one per AWS gateway or proxy (never two on the same one), at the Normal speed. Off by default.'**
  String get settingsParallelHint;

  /// No description provided for @settingsParallelMaxWorkersLabel.
  ///
  /// In en, this message translates to:
  /// **'Most keywords at once'**
  String get settingsParallelMaxWorkersLabel;

  /// No description provided for @settingsParallelNeedsTwo.
  ///
  /// In en, this message translates to:
  /// **'Needs at least two AWS gateways or proxies. With {count}, runs stay one keyword at a time.'**
  String settingsParallelNeedsTwo(int count);

  /// No description provided for @settingsParallelActive.
  ///
  /// In en, this message translates to:
  /// **'The next run works {workers} keywords at a time, at the Normal speed.'**
  String settingsParallelActive(int workers);

  /// No description provided for @settingsAwsAccountsTitle.
  ///
  /// In en, this message translates to:
  /// **'AWS Accounts'**
  String get settingsAwsAccountsTitle;

  /// No description provided for @settingsAwsAccountsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Each teammate\'s own AWS IAM key for the gateway-deployer script, with history.'**
  String get settingsAwsAccountsSubtitle;

  /// No description provided for @settingsAwsAccountsNoTeammates.
  ///
  /// In en, this message translates to:
  /// **'No teammates yet — once people sign in, each gets a tab here.'**
  String get settingsAwsAccountsNoTeammates;

  /// No description provided for @settingsAwsAccountsOthersLocked.
  ///
  /// In en, this message translates to:
  /// **'Only {name} can view or edit their own AWS credentials.'**
  String settingsAwsAccountsOthersLocked(String name);

  /// No description provided for @settingsAwsAccountsNotSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in to manage your own AWS credentials.'**
  String get settingsAwsAccountsNotSignedIn;

  /// No description provided for @settingsAwsAccountsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your AWS credentials.'**
  String get settingsAwsAccountsLoadFailed;

  /// No description provided for @settingsAwsAccountsAccessKeyLabel.
  ///
  /// In en, this message translates to:
  /// **'Access key ID'**
  String get settingsAwsAccountsAccessKeyLabel;

  /// No description provided for @settingsAwsAccountsSecretKeyLabel.
  ///
  /// In en, this message translates to:
  /// **'Secret access key'**
  String get settingsAwsAccountsSecretKeyLabel;

  /// No description provided for @settingsAwsAccountsShowSecret.
  ///
  /// In en, this message translates to:
  /// **'Show'**
  String get settingsAwsAccountsShowSecret;

  /// No description provided for @settingsAwsAccountsHideSecret.
  ///
  /// In en, this message translates to:
  /// **'Hide'**
  String get settingsAwsAccountsHideSecret;

  /// No description provided for @settingsAwsAccountsRegionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Default region(s)'**
  String get settingsAwsAccountsRegionsLabel;

  /// No description provided for @settingsAwsAccountsRegionsHint.
  ///
  /// In en, this message translates to:
  /// **'Comma-separated, e.g. us-east-1, eu-west-1'**
  String get settingsAwsAccountsRegionsHint;

  /// No description provided for @settingsAwsAccountsSaveButton.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get settingsAwsAccountsSaveButton;

  /// No description provided for @settingsAwsAccountsSavedToast.
  ///
  /// In en, this message translates to:
  /// **'AWS credentials saved.'**
  String get settingsAwsAccountsSavedToast;

  /// No description provided for @settingsAwsAccountsSaveFailedToast.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t save: {error}'**
  String settingsAwsAccountsSaveFailedToast(String error);

  /// No description provided for @settingsAwsAccountsNotWiredNote.
  ///
  /// In en, this message translates to:
  /// **'This just records your key for the team. tools/aws_gateway_setup.py still reads its own data/.env on whichever machine runs it, independently of what\'s saved here — wiring the two together is a planned follow-up.'**
  String get settingsAwsAccountsNotWiredNote;

  /// No description provided for @settingsAwsAccountsSetupTitle.
  ///
  /// In en, this message translates to:
  /// **'How to set this up'**
  String get settingsAwsAccountsSetupTitle;

  /// No description provided for @settingsAwsAccountsSetupStep1.
  ///
  /// In en, this message translates to:
  /// **'1. Sign in to the AWS console (console.aws.amazon.com), or create a free account if you don\'t have one.'**
  String get settingsAwsAccountsSetupStep1;

  /// No description provided for @settingsAwsAccountsSetupStep2.
  ///
  /// In en, this message translates to:
  /// **'2. Open IAM → Users → Create user. Give it a name such as gratovo-gateway-deployer — it doesn\'t need console access, only programmatic access.'**
  String get settingsAwsAccountsSetupStep2;

  /// No description provided for @settingsAwsAccountsSetupStep3.
  ///
  /// In en, this message translates to:
  /// **'3. Attach a permissions policy: the AWS managed policy \"AmazonAPIGatewayAdministrator\" is the simplest choice. For a tighter scope, a custom policy allowing just the apigateway:* actions is enough — this only ever creates/deletes HTTP APIs, integrations, routes and stages.'**
  String get settingsAwsAccountsSetupStep3;

  /// No description provided for @settingsAwsAccountsSetupStep4.
  ///
  /// In en, this message translates to:
  /// **'4. Open the new user → Security credentials tab → Create access key → choose \"Application running outside AWS\". The secret access key is shown only once, so copy both values immediately.'**
  String get settingsAwsAccountsSetupStep4;

  /// No description provided for @settingsAwsAccountsSetupStep5.
  ///
  /// In en, this message translates to:
  /// **'5. Paste the Access key ID and Secret access key below, add the region(s) you plan to deploy to (e.g. us-east-1, eu-west-1), and press Save.'**
  String get settingsAwsAccountsSetupStep5;

  /// No description provided for @settingsAwsAccountsSetupStep6.
  ///
  /// In en, this message translates to:
  /// **'6. To actually deploy the gateways, run \"python tools/aws_gateway_setup.py deploy --regions <your regions>\" on the machine that runs searches, with the same key pair set as AWS_IAM_ACCESS_KEY_ID / AWS_IAM_SECRET_ACCESS_KEY in its data/.env.local file.'**
  String get settingsAwsAccountsSetupStep6;

  /// No description provided for @settingsAwsAccountsHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get settingsAwsAccountsHistoryTitle;

  /// No description provided for @settingsAwsAccountsHistoryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No saved versions yet.'**
  String get settingsAwsAccountsHistoryEmpty;

  /// No description provided for @settingsAwsAccountsHistoryRestore.
  ///
  /// In en, this message translates to:
  /// **'Restore'**
  String get settingsAwsAccountsHistoryRestore;

  /// No description provided for @settingsAwsAccountsHistoryRestoredToast.
  ///
  /// In en, this message translates to:
  /// **'Loaded into the fields below — press Save to keep it.'**
  String get settingsAwsAccountsHistoryRestoredToast;

  /// No description provided for @settingsAwsAccountsHistoryEntryBlank.
  ///
  /// In en, this message translates to:
  /// **'Cleared'**
  String get settingsAwsAccountsHistoryEntryBlank;

  /// No description provided for @settingsAwsAccountsHistoryEntryKey.
  ///
  /// In en, this message translates to:
  /// **'Key ending {last4}'**
  String settingsAwsAccountsHistoryEntryKey(String last4);

  /// No description provided for @settingsAwsAccountsRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get settingsAwsAccountsRetry;

  /// No description provided for @settingsAwsAccountsRotationOn.
  ///
  /// In en, this message translates to:
  /// **'IP rotation on'**
  String get settingsAwsAccountsRotationOn;

  /// No description provided for @settingsAwsAccountsRotationOff.
  ///
  /// In en, this message translates to:
  /// **'IP rotation off'**
  String get settingsAwsAccountsRotationOff;

  /// No description provided for @searchKeywordsExpand.
  ///
  /// In en, this message translates to:
  /// **'Expand to full height'**
  String get searchKeywordsExpand;

  /// No description provided for @searchKeywordsCollapse.
  ///
  /// In en, this message translates to:
  /// **'Shrink back down'**
  String get searchKeywordsCollapse;

  /// No description provided for @searchInputsReadOnlyHint.
  ///
  /// In en, this message translates to:
  /// **'Read-only here — keywords and search settings can only be edited on a desktop.'**
  String get searchInputsReadOnlyHint;

  /// No description provided for @searchCountryAny.
  ///
  /// In en, this message translates to:
  /// **'Any'**
  String get searchCountryAny;

  /// No description provided for @searchMaxVideosValue.
  ///
  /// In en, this message translates to:
  /// **'max {count}'**
  String searchMaxVideosValue(String count);

  /// No description provided for @searchMaxVideosLabel.
  ///
  /// In en, this message translates to:
  /// **'Max videos/search'**
  String get searchMaxVideosLabel;

  /// No description provided for @searchMaxVideosTooltip.
  ///
  /// In en, this message translates to:
  /// **'How many YouTube search results this run pulls in for each keyword before moving on — videos when Results Type is Video, channel entries when it\'s Channel.\n\nThis is a raw result cap, not a count of channels. Many videos come from the same uploader, and results for channels already in your database still count against it, so a higher number finds proportionally fewer new channels. The scraper keeps paging until it reaches this many results or YouTube runs out, whichever comes first.\n\nLeave blank to use the team\'s shared default.'**
  String get searchMaxVideosTooltip;

  /// No description provided for @searchInstalledAppRequired.
  ///
  /// In en, this message translates to:
  /// **'Searching runs the scraper on your own machine, which a browser tab can\'t do. Open the installed desktop app to start a run — everything else on this page works here.'**
  String get searchInstalledAppRequired;

  /// No description provided for @settingsFontScaleLabel.
  ///
  /// In en, this message translates to:
  /// **'Text size'**
  String get settingsFontScaleLabel;

  /// No description provided for @settingsFontScaleLabelWithPercent.
  ///
  /// In en, this message translates to:
  /// **'Text size - {percent}%'**
  String settingsFontScaleLabelWithPercent(String percent);

  /// No description provided for @settingsFontScaleReset.
  ///
  /// In en, this message translates to:
  /// **'Reset to 100%'**
  String get settingsFontScaleReset;

  /// No description provided for @commonUnknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get commonUnknown;

  /// No description provided for @emailsAccessLevelTitle.
  ///
  /// In en, this message translates to:
  /// **'Your access level'**
  String get emailsAccessLevelTitle;

  /// No description provided for @emailsAccessLevelFull.
  ///
  /// In en, this message translates to:
  /// **'Full access. You see every email in full, including names, brands and prices.'**
  String get emailsAccessLevelFull;

  /// No description provided for @emailsAccessLevelBasic.
  ///
  /// In en, this message translates to:
  /// **'Basic access. You see that emails happened and when, but names, channels, brands, prices and addresses are removed before they leave the server.'**
  String get emailsAccessLevelBasic;

  /// No description provided for @emailsAccessDeniedTitle.
  ///
  /// In en, this message translates to:
  /// **'No access to email data'**
  String get emailsAccessDeniedTitle;

  /// No description provided for @emailsAccessDeniedBody.
  ///
  /// In en, this message translates to:
  /// **'This account has not been granted access to email data. An admin has to raise your access level before anything here will load — it is refused by the database, not hidden by the app.'**
  String get emailsAccessDeniedBody;

  /// No description provided for @emailsRedactedNote.
  ///
  /// In en, this message translates to:
  /// **'The ••• marks are deliberate. Those fields were removed on the server for your access level, not lost.'**
  String get emailsRedactedNote;

  /// No description provided for @emailsRedactedFieldTooltip.
  ///
  /// In en, this message translates to:
  /// **'Hidden at your access level'**
  String get emailsRedactedFieldTooltip;

  /// No description provided for @emailsActionUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Not available at your access level'**
  String get emailsActionUnavailable;

  /// No description provided for @authSignInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in with the account you were given.'**
  String get authSignInSubtitle;

  /// No description provided for @authEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get authEmailLabel;

  /// No description provided for @authEmailInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address.'**
  String get authEmailInvalid;

  /// No description provided for @authPasswordLabel.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get authPasswordLabel;

  /// No description provided for @authPasswordRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your password.'**
  String get authPasswordRequired;

  /// No description provided for @authSignInButton.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get authSignInButton;

  /// No description provided for @authSignOutButton.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get authSignOutButton;

  /// No description provided for @authNoSelfSignupNotice.
  ///
  /// In en, this message translates to:
  /// **'Accounts are created by your administrator — there is no sign-up here.'**
  String get authNoSelfSignupNotice;

  /// No description provided for @authAdvancedToggle.
  ///
  /// In en, this message translates to:
  /// **'Advanced — server address'**
  String get authAdvancedToggle;

  /// No description provided for @authServerUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Can\'t reach the server. Check the address under Advanced, then restart the app.\n{error}'**
  String authServerUnreachable(String error);

  /// No description provided for @authErrorInvalidCredentials.
  ///
  /// In en, this message translates to:
  /// **'That email and password don\'t match an account.'**
  String get authErrorInvalidCredentials;

  /// No description provided for @authErrorEmailNotConfirmed.
  ///
  /// In en, this message translates to:
  /// **'This account hasn\'t been confirmed yet. Ask your administrator to confirm it.'**
  String get authErrorEmailNotConfirmed;

  /// No description provided for @authErrorOffline.
  ///
  /// In en, this message translates to:
  /// **'No connection. Check your internet and try again.'**
  String get authErrorOffline;

  /// No description provided for @authErrorNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'No server is configured. Open Advanced below and enter the address.'**
  String get authErrorNotConfigured;

  /// No description provided for @authErrorUnknown.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t sign in: {detail}'**
  String authErrorUnknown(String detail);

  /// No description provided for @authAccessPendingTitle.
  ///
  /// In en, this message translates to:
  /// **'Waiting for access'**
  String get authAccessPendingTitle;

  /// No description provided for @authAccessPendingBody.
  ///
  /// In en, this message translates to:
  /// **'You\'re signed in as {email}, but your account hasn\'t been given an access level yet. Ask your administrator to grant it, then check again.'**
  String authAccessPendingBody(String email);

  /// No description provided for @authAccessPendingRecheck.
  ///
  /// In en, this message translates to:
  /// **'Check again'**
  String get authAccessPendingRecheck;

  /// No description provided for @settingsAboutTitle.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get settingsAboutTitle;

  /// No description provided for @settingsAboutVersion.
  ///
  /// In en, this message translates to:
  /// **'Version {version} (build {build})'**
  String settingsAboutVersion(String version, String build);

  /// No description provided for @settingsAboutCopyVersion.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get settingsAboutCopyVersion;

  /// No description provided for @settingsAboutVersionCopied.
  ///
  /// In en, this message translates to:
  /// **'Version copied to clipboard.'**
  String get settingsAboutVersionCopied;

  /// No description provided for @settingsUpdateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Version {version} is ready to install.'**
  String settingsUpdateAvailable(String version);

  /// No description provided for @settingsUpdateDownloading.
  ///
  /// In en, this message translates to:
  /// **'Downloading version {version}…'**
  String settingsUpdateDownloading(String version);

  /// No description provided for @settingsUpdateInstalling.
  ///
  /// In en, this message translates to:
  /// **'Restarting to install…'**
  String get settingsUpdateInstalling;

  /// No description provided for @settingsUpdateInstall.
  ///
  /// In en, this message translates to:
  /// **'Update'**
  String get settingsUpdateInstall;

  /// No description provided for @settingsUpdateUpToDate.
  ///
  /// In en, this message translates to:
  /// **'Up to date'**
  String get settingsUpdateUpToDate;

  /// No description provided for @settingsUpdateCheckNow.
  ///
  /// In en, this message translates to:
  /// **'Check for updates'**
  String get settingsUpdateCheckNow;

  /// No description provided for @settingsUpdateConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Finish syncing first?'**
  String get settingsUpdateConfirmTitle;

  /// No description provided for @settingsUpdateConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'Changes made on this machine are still being uploaded. Installing now restarts the app before they finish.'**
  String get settingsUpdateConfirmBody;

  /// No description provided for @settingsUpdateConfirmSideBySide.
  ///
  /// In en, this message translates to:
  /// **'Version {version} installs in its own folder. Your current version stays where it is until you delete it.'**
  String settingsUpdateConfirmSideBySide(String version);

  /// No description provided for @settingsUpdateConfirmWait.
  ///
  /// In en, this message translates to:
  /// **'Wait for it'**
  String get settingsUpdateConfirmWait;

  /// No description provided for @settingsUpdateConfirmCountdown.
  ///
  /// In en, this message translates to:
  /// **'Install anyway ({seconds})'**
  String settingsUpdateConfirmCountdown(String seconds);

  /// No description provided for @settingsUpdateConfirmInstall.
  ///
  /// In en, this message translates to:
  /// **'Install anyway'**
  String get settingsUpdateConfirmInstall;

  /// No description provided for @settingsUpdateConfirmPaused.
  ///
  /// In en, this message translates to:
  /// **'Move the mouse or press a key to continue.'**
  String get settingsUpdateConfirmPaused;

  /// No description provided for @settingsAttentionUpdate.
  ///
  /// In en, this message translates to:
  /// **'Update ready'**
  String get settingsAttentionUpdate;

  /// No description provided for @settingsAttentionRejected.
  ///
  /// In en, this message translates to:
  /// **'Sign-in refused'**
  String get settingsAttentionRejected;

  /// No description provided for @settingsAttentionExpiring.
  ///
  /// In en, this message translates to:
  /// **'Expiring soon'**
  String get settingsAttentionExpiring;

  /// No description provided for @settingsGithubTitle.
  ///
  /// In en, this message translates to:
  /// **'GitHub (app updates)'**
  String get settingsGithubTitle;

  /// No description provided for @settingsGithubBody.
  ///
  /// In en, this message translates to:
  /// **'Updates come from the private repository. Sign in with the GitHub account that has access to it.'**
  String get settingsGithubBody;

  /// No description provided for @settingsGithubSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in with GitHub'**
  String get settingsGithubSignIn;

  /// No description provided for @settingsGithubSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get settingsGithubSignOut;

  /// No description provided for @settingsGithubRecheck.
  ///
  /// In en, this message translates to:
  /// **'Check access'**
  String get settingsGithubRecheck;

  /// No description provided for @settingsGithubSignedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as {login}'**
  String settingsGithubSignedInAs(String login);

  /// No description provided for @settingsGithubCodeInstruction.
  ///
  /// In en, this message translates to:
  /// **'Open {url} and enter this code:'**
  String settingsGithubCodeInstruction(String url);

  /// No description provided for @settingsGithubCodeCopied.
  ///
  /// In en, this message translates to:
  /// **'Code copied.'**
  String get settingsGithubCodeCopied;

  /// No description provided for @settingsGithubAccessGranted.
  ///
  /// In en, this message translates to:
  /// **'This account can see the releases.'**
  String get settingsGithubAccessGranted;

  /// No description provided for @settingsGithubAccessDenied.
  ///
  /// In en, this message translates to:
  /// **'This account cannot see the releases. Add {login} to the repository on GitHub, then check again.'**
  String settingsGithubAccessDenied(String login);

  /// No description provided for @settingsGithubTokenRejected.
  ///
  /// In en, this message translates to:
  /// **'GitHub rejected the stored sign-in. Sign in again.'**
  String get settingsGithubTokenRejected;

  /// No description provided for @settingsGithubAccessUnknown.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach GitHub to check access.'**
  String get settingsGithubAccessUnknown;

  /// No description provided for @settingsGithubNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'This build has no GitHub client ID, so sign-in is unavailable. Rebuild with --dart-define=GRATOVO_GITHUB_CLIENT_ID=...'**
  String get settingsGithubNotConfigured;

  /// No description provided for @settingsGithubDenied.
  ///
  /// In en, this message translates to:
  /// **'The sign-in was refused in the browser.'**
  String get settingsGithubDenied;

  /// No description provided for @settingsGithubExpired.
  ///
  /// In en, this message translates to:
  /// **'The code expired before it was entered. Try again.'**
  String get settingsGithubExpired;

  /// No description provided for @settingsGithubUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t reach GitHub.'**
  String get settingsGithubUnreachable;

  /// No description provided for @settingsGithubStorageFailed.
  ///
  /// In en, this message translates to:
  /// **'GitHub signed you in, but this computer couldn\'t save the token. Try again.'**
  String get settingsGithubStorageFailed;

  /// No description provided for @settingsGithubSharedToken.
  ///
  /// In en, this message translates to:
  /// **'Updates use a shared access token built into this app.'**
  String get settingsGithubSharedToken;

  /// No description provided for @settingsGithubSharedTokenOk.
  ///
  /// In en, this message translates to:
  /// **'The built-in token can read the releases.'**
  String get settingsGithubSharedTokenOk;

  /// No description provided for @settingsGithubSharedRejected.
  ///
  /// In en, this message translates to:
  /// **'The built-in token was refused — expired or revoked. Everyone on this version is affected; a new build is needed. You can sign in with your own GitHub account to keep updating meanwhile.'**
  String get settingsGithubSharedRejected;

  /// No description provided for @settingsGithubNoToken.
  ///
  /// In en, this message translates to:
  /// **'This build has no way to reach the releases, so it will never find an update.'**
  String get settingsGithubNoToken;

  /// No description provided for @settingsGithubSignInOptional.
  ///
  /// In en, this message translates to:
  /// **'Sign in as yourself (optional)'**
  String get settingsGithubSignInOptional;

  /// No description provided for @settingsAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'Supabase Account'**
  String get settingsAccountTitle;

  /// No description provided for @settingsAccountSignedOut.
  ///
  /// In en, this message translates to:
  /// **'Not signed in.'**
  String get settingsAccountSignedOut;

  /// No description provided for @settingsAccountProfileError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load your profile: {error}'**
  String settingsAccountProfileError(String error);

  /// No description provided for @settingsAccountColorLabel.
  ///
  /// In en, this message translates to:
  /// **'Your color'**
  String get settingsAccountColorLabel;

  /// No description provided for @settingsAccountColorHelp.
  ///
  /// In en, this message translates to:
  /// **'Teammates see this color around whatever you\'re editing.'**
  String get settingsAccountColorHelp;

  /// No description provided for @settingsAccountColorButton.
  ///
  /// In en, this message translates to:
  /// **'Change your color'**
  String get settingsAccountColorButton;

  /// No description provided for @settingsAccountColorOthersLabel.
  ///
  /// In en, this message translates to:
  /// **'Other accounts, for reference'**
  String get settingsAccountColorOthersLabel;

  /// No description provided for @settingsAccountStatusConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get settingsAccountStatusConnected;

  /// No description provided for @settingsAccountStatusSignedOut.
  ///
  /// In en, this message translates to:
  /// **'Signed out'**
  String get settingsAccountStatusSignedOut;

  /// No description provided for @settingsAccountStatusUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Unreachable'**
  String get settingsAccountStatusUnreachable;

  /// No description provided for @settingsServerAdvancedTitle.
  ///
  /// In en, this message translates to:
  /// **'Advanced — server address'**
  String get settingsServerAdvancedTitle;

  /// No description provided for @settingsServerAdvancedHelp.
  ///
  /// In en, this message translates to:
  /// **'Only change these if you\'re moving to a different Supabase project. Neither value is a secret; the key that is (service_role) is never stored in this app.'**
  String get settingsServerAdvancedHelp;

  /// No description provided for @settingsServerUrlLabel.
  ///
  /// In en, this message translates to:
  /// **'Project URL'**
  String get settingsServerUrlLabel;

  /// No description provided for @settingsServerAnonKeyLabel.
  ///
  /// In en, this message translates to:
  /// **'Public (anon) key'**
  String get settingsServerAnonKeyLabel;

  /// No description provided for @settingsServerAnonKeyHelp.
  ///
  /// In en, this message translates to:
  /// **'The anon/public key — safe to store here. Never paste the service_role key.'**
  String get settingsServerAnonKeyHelp;

  /// No description provided for @settingsSyncTitle.
  ///
  /// In en, this message translates to:
  /// **'Team sync'**
  String get settingsSyncTitle;

  /// No description provided for @settingsSyncDisabled.
  ///
  /// In en, this message translates to:
  /// **'No local database on this machine, so nothing can be saved or synced. The app is showing sample data.'**
  String get settingsSyncDisabled;

  /// No description provided for @settingsSyncPreparing.
  ///
  /// In en, this message translates to:
  /// **'Not synced with the team yet. Everything shown is what this machine already holds; your edits are saved here and upload once the first sync runs.'**
  String get settingsSyncPreparing;

  /// No description provided for @settingsSyncActive.
  ///
  /// In en, this message translates to:
  /// **'In sync with the team. Edits save here first and upload in the background; teammates’ changes and the shared catalog come down on each tick.'**
  String get settingsSyncActive;

  /// No description provided for @settingsSyncOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline. Your edits are saved here and will upload when you reconnect.'**
  String get settingsSyncOffline;

  /// No description provided for @settingsSyncBusy.
  ///
  /// In en, this message translates to:
  /// **'Syncing with the server…'**
  String get settingsSyncBusy;

  /// No description provided for @settingsSyncConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting to the server…'**
  String get settingsSyncConnecting;

  /// No description provided for @settingsSyncUploading.
  ///
  /// In en, this message translates to:
  /// **'Sending your changes to the server…'**
  String get settingsSyncUploading;

  /// No description provided for @settingsSyncDownloading.
  ///
  /// In en, this message translates to:
  /// **'Downloading changes from the server…'**
  String get settingsSyncDownloading;

  /// No description provided for @settingsSyncDetailTable.
  ///
  /// In en, this message translates to:
  /// **'Updating {table} — {rows} rows'**
  String settingsSyncDetailTable(String table, String rows);

  /// No description provided for @settingsSyncProgress.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} tables'**
  String settingsSyncProgress(int done, int total);

  /// No description provided for @settingsSyncDetailUpload.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Sending 1 local change} other{Sending {count} local changes}}'**
  String settingsSyncDetailUpload(int count);

  /// No description provided for @settingsSyncLastSynced.
  ///
  /// In en, this message translates to:
  /// **'Last synced at {when}'**
  String settingsSyncLastSynced(String when);

  /// No description provided for @settingsSyncDeferred.
  ///
  /// In en, this message translates to:
  /// **'Paused while a search runs, so the search keeps the connection. Your edits still upload.'**
  String get settingsSyncDeferred;

  /// No description provided for @settingsSyncError.
  ///
  /// In en, this message translates to:
  /// **'Sync problem: {detail}'**
  String settingsSyncError(String detail);

  /// No description provided for @settingsSyncLocalFault.
  ///
  /// In en, this message translates to:
  /// **'The database on this machine stopped responding. Nothing already saved is lost, but nothing new can be saved until it answers again — check the disk. {detail}'**
  String settingsSyncLocalFault(String detail);

  /// No description provided for @settingsSyncLogButton.
  ///
  /// In en, this message translates to:
  /// **'Sync details'**
  String get settingsSyncLogButton;

  /// No description provided for @settingsSyncLogTitle.
  ///
  /// In en, this message translates to:
  /// **'What the sync has been doing'**
  String get settingsSyncLogTitle;

  /// No description provided for @settingsSyncLogIntro.
  ///
  /// In en, this message translates to:
  /// **'Every request this machine has made to the server since the app started, newest at the bottom. Copy this into a bug report — it says which table was being downloaded, how long each page took and what the server answered.'**
  String get settingsSyncLogIntro;

  /// No description provided for @settingsSyncLogEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded yet. The first sync writes here.'**
  String get settingsSyncLogEmpty;

  /// No description provided for @settingsSyncLogFile.
  ///
  /// In en, this message translates to:
  /// **'The full history, across restarts, is kept at:\n{path}'**
  String settingsSyncLogFile(String path);

  /// No description provided for @settingsSyncLogCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get settingsSyncLogCopy;

  /// No description provided for @settingsSyncLogCopied.
  ///
  /// In en, this message translates to:
  /// **'Sync log copied.'**
  String get settingsSyncLogCopied;

  /// No description provided for @settingsSyncLogCounts.
  ///
  /// In en, this message translates to:
  /// **'{passes, plural, =0{No passes yet} =1{1 pass so far} other{{passes} passes so far}}, {failed, plural, =0{none with problems} =1{1 with problems} other{{failed} with problems}}.'**
  String settingsSyncLogCounts(int passes, int failed);

  /// No description provided for @syncNowTooltip.
  ///
  /// In en, this message translates to:
  /// **'Sync data with server'**
  String get syncNowTooltip;

  /// No description provided for @syncNowInProgress.
  ///
  /// In en, this message translates to:
  /// **'Syncing…'**
  String get syncNowInProgress;

  /// No description provided for @syncNowDone.
  ///
  /// In en, this message translates to:
  /// **'Up to date'**
  String get syncNowDone;

  /// No description provided for @syncNowLocalPushFailed.
  ///
  /// In en, this message translates to:
  /// **'Synced, but this machine\'s search results could not be uploaded.'**
  String get syncNowLocalPushFailed;

  /// No description provided for @syncNowLocalPullFailed.
  ///
  /// In en, this message translates to:
  /// **'Synced your edits, but the latest search data could not be downloaded.'**
  String get syncNowLocalPullFailed;

  /// No description provided for @syncNowPipelineBusy.
  ///
  /// In en, this message translates to:
  /// **'Synced your edits. Search results are shared by the search itself while it runs.'**
  String get syncNowPipelineBusy;

  /// No description provided for @syncNowError.
  ///
  /// In en, this message translates to:
  /// **'Could not reach the server: {detail}'**
  String syncNowError(String detail);

  /// No description provided for @settingsSyncLastManual.
  ///
  /// In en, this message translates to:
  /// **'Last manual sync at {when}: {detail}'**
  String settingsSyncLastManual(String when, String detail);

  /// No description provided for @settingsServerResetDefaults.
  ///
  /// In en, this message translates to:
  /// **'Reset to defaults'**
  String get settingsServerResetDefaults;

  /// No description provided for @settingsServerSavedRestart.
  ///
  /// In en, this message translates to:
  /// **'Saved. Restart the app for it to take effect.'**
  String get settingsServerSavedRestart;

  /// No description provided for @settingsServerClearSaved.
  ///
  /// In en, this message translates to:
  /// **'Clear saved values'**
  String get settingsServerClearSaved;

  /// No description provided for @settingsServerResetDone.
  ///
  /// In en, this message translates to:
  /// **'Back to the defaults this build shipped with.'**
  String get settingsServerResetDone;

  /// No description provided for @settingsServerCleared.
  ///
  /// In en, this message translates to:
  /// **'Saved values cleared.'**
  String get settingsServerCleared;

  /// No description provided for @settingsServerActionFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not change the server address: {error}'**
  String settingsServerActionFailed(String error);

  /// No description provided for @settingsServerStatusRestart.
  ///
  /// In en, this message translates to:
  /// **'Restart the app to use these values.'**
  String get settingsServerStatusRestart;

  /// No description provided for @settingsServerStatusUnsaved.
  ///
  /// In en, this message translates to:
  /// **'Unsaved changes.'**
  String get settingsServerStatusUnsaved;

  /// No description provided for @settingsServerStatusCustom.
  ///
  /// In en, this message translates to:
  /// **'This computer uses its own values.'**
  String get settingsServerStatusCustom;

  /// No description provided for @settingsServerStatusDefaults.
  ///
  /// In en, this message translates to:
  /// **'Using the defaults this build shipped with.'**
  String get settingsServerStatusDefaults;

  /// No description provided for @settingsServerShippedTitle.
  ///
  /// In en, this message translates to:
  /// **'Shipped with this build'**
  String get settingsServerShippedTitle;

  /// No description provided for @settingsServerShippedNone.
  ///
  /// In en, this message translates to:
  /// **'This build shipped without a server address. Enter one above.'**
  String get settingsServerShippedNone;

  /// No description provided for @accessLevelFull.
  ///
  /// In en, this message translates to:
  /// **'Full authority'**
  String get accessLevelFull;

  /// No description provided for @accessLevelFullExplanation.
  ///
  /// In en, this message translates to:
  /// **'You can see everything, including email contents, prices, brands, and contact addresses.'**
  String get accessLevelFullExplanation;

  /// No description provided for @accessLevelBasic.
  ///
  /// In en, this message translates to:
  /// **'Basic authority'**
  String get accessLevelBasic;

  /// No description provided for @accessLevelBasicExplanation.
  ///
  /// In en, this message translates to:
  /// **'You can see that emails and deals happened, and their status and timing. Influencer names, channels, brands, prices, and email addresses are removed by the server before they reach you.'**
  String get accessLevelBasicExplanation;

  /// No description provided for @accessLevelUnauthorized.
  ///
  /// In en, this message translates to:
  /// **'No access yet'**
  String get accessLevelUnauthorized;

  /// No description provided for @accessLevelUnauthorizedExplanation.
  ///
  /// In en, this message translates to:
  /// **'Your account hasn\'t been given an access level. Ask your administrator to grant one.'**
  String get accessLevelUnauthorizedExplanation;

  /// No description provided for @navLogs.
  ///
  /// In en, this message translates to:
  /// **'Logs'**
  String get navLogs;

  /// No description provided for @logsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search people, records, fields'**
  String get logsSearchHint;

  /// No description provided for @logsFilterActor.
  ///
  /// In en, this message translates to:
  /// **'Person'**
  String get logsFilterActor;

  /// No description provided for @logsFilterAction.
  ///
  /// In en, this message translates to:
  /// **'Action'**
  String get logsFilterAction;

  /// No description provided for @logsFilterEntity.
  ///
  /// In en, this message translates to:
  /// **'Record'**
  String get logsFilterEntity;

  /// No description provided for @logsFilterAllPeople.
  ///
  /// In en, this message translates to:
  /// **'Everyone'**
  String get logsFilterAllPeople;

  /// No description provided for @logsFilterAllActions.
  ///
  /// In en, this message translates to:
  /// **'All actions'**
  String get logsFilterAllActions;

  /// No description provided for @logsFilterAllEntities.
  ///
  /// In en, this message translates to:
  /// **'All records'**
  String get logsFilterAllEntities;

  /// No description provided for @logsRangeToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get logsRangeToday;

  /// No description provided for @logsRange7Days.
  ///
  /// In en, this message translates to:
  /// **'Last 7 days'**
  String get logsRange7Days;

  /// No description provided for @logsRange30Days.
  ///
  /// In en, this message translates to:
  /// **'Last 30 days'**
  String get logsRange30Days;

  /// No description provided for @logsClearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear filters'**
  String get logsClearFilters;

  /// No description provided for @logsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing has been recorded yet. Actions show up here as they happen.'**
  String get logsEmpty;

  /// No description provided for @logsNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No actions match these filters.'**
  String get logsNoMatches;

  /// No description provided for @logsEndOfList.
  ///
  /// In en, this message translates to:
  /// **'That is the whole log.'**
  String get logsEndOfList;

  /// No description provided for @logsShowingCount.
  ///
  /// In en, this message translates to:
  /// **'{count} entries so far'**
  String logsShowingCount(int count);

  /// Badge beside the Logs title — how many of the shown entries were recorded today.
  ///
  /// In en, this message translates to:
  /// **'{count} new'**
  String logsNewCount(int count);

  /// No description provided for @logsLoadingMore.
  ///
  /// In en, this message translates to:
  /// **'Loading more…'**
  String get logsLoadingMore;

  /// No description provided for @logsDeletedAccount.
  ///
  /// In en, this message translates to:
  /// **'account deleted'**
  String get logsDeletedAccount;

  /// No description provided for @logsDeletedAccountTooltip.
  ///
  /// In en, this message translates to:
  /// **'This account has been removed. What they did is kept.'**
  String get logsDeletedAccountTooltip;

  /// The authority the person held AT THE TIME of the action, not the authority they hold now.
  ///
  /// In en, this message translates to:
  /// **'as {role}'**
  String logsActorRole(String role);

  /// No description provided for @logsValueChange.
  ///
  /// In en, this message translates to:
  /// **'{from} → {to}'**
  String logsValueChange(String from, String to);

  /// Notes are recorded by length only, never by content.
  ///
  /// In en, this message translates to:
  /// **'{before} → {after} characters'**
  String logsNotesLengthChange(int before, int after);

  /// No description provided for @logsContentNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Contents are deliberately not recorded.'**
  String get logsContentNotRecorded;

  /// No description provided for @logsOpenRecord.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get logsOpenRecord;

  /// No description provided for @logsActionCreated.
  ///
  /// In en, this message translates to:
  /// **'Created'**
  String get logsActionCreated;

  /// No description provided for @logsActionUpdated.
  ///
  /// In en, this message translates to:
  /// **'Updated'**
  String get logsActionUpdated;

  /// No description provided for @logsActionDeleted.
  ///
  /// In en, this message translates to:
  /// **'Deleted'**
  String get logsActionDeleted;

  /// No description provided for @logsActionTagsChanged.
  ///
  /// In en, this message translates to:
  /// **'Tags changed'**
  String get logsActionTagsChanged;

  /// No description provided for @logsActionStageChanged.
  ///
  /// In en, this message translates to:
  /// **'Stage changed'**
  String get logsActionStageChanged;

  /// No description provided for @logsActionVettingChanged.
  ///
  /// In en, this message translates to:
  /// **'Vetting changed'**
  String get logsActionVettingChanged;

  /// No description provided for @logsActionNotesChanged.
  ///
  /// In en, this message translates to:
  /// **'Notes edited'**
  String get logsActionNotesChanged;

  /// No description provided for @logsActionContactsChanged.
  ///
  /// In en, this message translates to:
  /// **'Contacts changed'**
  String get logsActionContactsChanged;

  /// No description provided for @logsActionContactAttempt.
  ///
  /// In en, this message translates to:
  /// **'Outreach attempt'**
  String get logsActionContactAttempt;

  /// No description provided for @logsActionEmailSent.
  ///
  /// In en, this message translates to:
  /// **'Email sent'**
  String get logsActionEmailSent;

  /// No description provided for @logsActionSearchStarted.
  ///
  /// In en, this message translates to:
  /// **'Search started'**
  String get logsActionSearchStarted;

  /// No description provided for @logsActionVideosPulled.
  ///
  /// In en, this message translates to:
  /// **'Videos pulled'**
  String get logsActionVideosPulled;

  /// No description provided for @logsActionUnknown.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get logsActionUnknown;

  /// No description provided for @logsEntityChannel.
  ///
  /// In en, this message translates to:
  /// **'Channel'**
  String get logsEntityChannel;

  /// No description provided for @logsEntityDeal.
  ///
  /// In en, this message translates to:
  /// **'Deal'**
  String get logsEntityDeal;

  /// No description provided for @logsEntityBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get logsEntityBrand;

  /// No description provided for @logsEntityThread.
  ///
  /// In en, this message translates to:
  /// **'Email thread'**
  String get logsEntityThread;

  /// No description provided for @logsEntityRun.
  ///
  /// In en, this message translates to:
  /// **'Search run'**
  String get logsEntityRun;

  /// No description provided for @logsEntitySettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get logsEntitySettings;

  /// No description provided for @logsEntityOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get logsEntityOther;

  /// No description provided for @logsActivityTitle.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get logsActivityTitle;

  /// No description provided for @logsActivityEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded for this channel yet.'**
  String get logsActivityEmpty;

  /// No description provided for @logsActivitySeeAll.
  ///
  /// In en, this message translates to:
  /// **'See the whole log'**
  String get logsActivitySeeAll;

  /// No description provided for @notificationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsTitle;

  /// No description provided for @notificationsBellTooltip.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notificationsBellTooltip;

  /// No description provided for @notificationsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing yet. Toasts you see will be kept here.'**
  String get notificationsEmpty;

  /// No description provided for @notificationsClearAll.
  ///
  /// In en, this message translates to:
  /// **'Clear all'**
  String get notificationsClearAll;

  /// Badge on the Dashboard's notifications bell — how many notifications haven't been looked at yet.
  ///
  /// In en, this message translates to:
  /// **'{count} new'**
  String notificationsUnreadCount(int count);

  /// No description provided for @commonExpand.
  ///
  /// In en, this message translates to:
  /// **'Expand'**
  String get commonExpand;

  /// No description provided for @commonCollapse.
  ///
  /// In en, this message translates to:
  /// **'Collapse'**
  String get commonCollapse;

  /// No description provided for @commonCopied.
  ///
  /// In en, this message translates to:
  /// **'Copied to the clipboard'**
  String get commonCopied;

  /// No description provided for @commonDay.
  ///
  /// In en, this message translates to:
  /// **'Day'**
  String get commonDay;

  /// No description provided for @commonMonth.
  ///
  /// In en, this message translates to:
  /// **'Month'**
  String get commonMonth;

  /// No description provided for @commonYear.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get commonYear;

  /// No description provided for @commonHour.
  ///
  /// In en, this message translates to:
  /// **'Hour'**
  String get commonHour;

  /// No description provided for @commonMinute.
  ///
  /// In en, this message translates to:
  /// **'Minute'**
  String get commonMinute;

  /// No description provided for @commonSpinHint.
  ///
  /// In en, this message translates to:
  /// **'Scroll or use the arrow keys over a box to change it.'**
  String get commonSpinHint;

  /// No description provided for @influencerProfileNoDescription.
  ///
  /// In en, this message translates to:
  /// **'This channel has no description.'**
  String get influencerProfileNoDescription;

  /// No description provided for @influencerProfileShowFullDescription.
  ///
  /// In en, this message translates to:
  /// **'Show the full description'**
  String get influencerProfileShowFullDescription;

  /// No description provided for @influencerProfileShowLessDescription.
  ///
  /// In en, this message translates to:
  /// **'Show less'**
  String get influencerProfileShowLessDescription;

  /// No description provided for @influencerProfileViewProfilePicture.
  ///
  /// In en, this message translates to:
  /// **'View the profile picture'**
  String get influencerProfileViewProfilePicture;

  /// No description provided for @influencerProfileViewBanner.
  ///
  /// In en, this message translates to:
  /// **'View the banner'**
  String get influencerProfileViewBanner;

  /// No description provided for @influencerProfileImageZoomHint.
  ///
  /// In en, this message translates to:
  /// **'Scroll or pinch to zoom · drag to move'**
  String get influencerProfileImageZoomHint;

  /// No description provided for @influencerProfileImageResetZoom.
  ///
  /// In en, this message translates to:
  /// **'Reset zoom'**
  String get influencerProfileImageResetZoom;

  /// No description provided for @influencerProfileImageClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get influencerProfileImageClose;

  /// No description provided for @influencerProfileContactsTitle.
  ///
  /// In en, this message translates to:
  /// **'How to reach them'**
  String get influencerProfileContactsTitle;

  /// No description provided for @influencerProfileNoContacts.
  ///
  /// In en, this message translates to:
  /// **'No contact method recorded yet.'**
  String get influencerProfileNoContacts;

  /// No description provided for @influencerProfileAddContact.
  ///
  /// In en, this message translates to:
  /// **'Add a contact'**
  String get influencerProfileAddContact;

  /// No description provided for @influencerProfileContactValueHint.
  ///
  /// In en, this message translates to:
  /// **'Address, number or handle'**
  String get influencerProfileContactValueHint;

  /// No description provided for @influencerProfileContactLabelHint.
  ///
  /// In en, this message translates to:
  /// **'Whose? (optional)'**
  String get influencerProfileContactLabelHint;

  /// No description provided for @influencerProfileContactPrimary.
  ///
  /// In en, this message translates to:
  /// **'Primary'**
  String get influencerProfileContactPrimary;

  /// No description provided for @influencerProfileContactMakePrimary.
  ///
  /// In en, this message translates to:
  /// **'Make this the primary contact'**
  String get influencerProfileContactMakePrimary;

  /// No description provided for @influencerProfileContactRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove this contact'**
  String get influencerProfileContactRemove;

  /// No description provided for @influencerProfileContactCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get influencerProfileContactCopy;

  /// No description provided for @influencerProfileContactsSaved.
  ///
  /// In en, this message translates to:
  /// **'Contacts saved'**
  String get influencerProfileContactsSaved;

  /// No description provided for @contactMethodEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get contactMethodEmail;

  /// No description provided for @contactMethodWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp'**
  String get contactMethodWhatsapp;

  /// No description provided for @contactMethodPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get contactMethodPhone;

  /// No description provided for @contactMethodInstagram.
  ///
  /// In en, this message translates to:
  /// **'Instagram'**
  String get contactMethodInstagram;

  /// No description provided for @contactMethodTelegram.
  ///
  /// In en, this message translates to:
  /// **'Telegram'**
  String get contactMethodTelegram;

  /// No description provided for @contactMethodTwitter.
  ///
  /// In en, this message translates to:
  /// **'X / Twitter'**
  String get contactMethodTwitter;

  /// No description provided for @contactMethodDiscord.
  ///
  /// In en, this message translates to:
  /// **'Discord'**
  String get contactMethodDiscord;

  /// No description provided for @contactMethodOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get contactMethodOther;

  /// No description provided for @influencerProfileCrmBasisCount.
  ///
  /// In en, this message translates to:
  /// **'Based on {count} stored uploads'**
  String influencerProfileCrmBasisCount(int count);

  /// No description provided for @influencerProfileCrmBasisWindow.
  ///
  /// In en, this message translates to:
  /// **'A search stores roughly the last month of uploads. Pull more to widen what this is calculated from.'**
  String get influencerProfileCrmBasisWindow;

  /// No description provided for @influencerProfileCrmSpanDays.
  ///
  /// In en, this message translates to:
  /// **'covering {days} days'**
  String influencerProfileCrmSpanDays(int days);

  /// No description provided for @influencerProfileVideosAsList.
  ///
  /// In en, this message translates to:
  /// **'List view'**
  String get influencerProfileVideosAsList;

  /// No description provided for @influencerProfileVideosAsCards.
  ///
  /// In en, this message translates to:
  /// **'Card view'**
  String get influencerProfileVideosAsCards;

  /// No description provided for @influencerProfileVideoNoDescription.
  ///
  /// In en, this message translates to:
  /// **'No description stored.'**
  String get influencerProfileVideoNoDescription;

  /// No description provided for @influencerProfileVideoCount.
  ///
  /// In en, this message translates to:
  /// **'{count} stored'**
  String influencerProfileVideoCount(int count);

  /// No description provided for @influencerListHideImages.
  ///
  /// In en, this message translates to:
  /// **'Turn pictures off for this page'**
  String get influencerListHideImages;

  /// No description provided for @influencerListShowImages.
  ///
  /// In en, this message translates to:
  /// **'Turn pictures back on'**
  String get influencerListShowImages;

  /// No description provided for @influencerListShowLatestVideo.
  ///
  /// In en, this message translates to:
  /// **'Show the latest upload on each card'**
  String get influencerListShowLatestVideo;

  /// No description provided for @influencerListHideLatestVideo.
  ///
  /// In en, this message translates to:
  /// **'Hide the latest upload'**
  String get influencerListHideLatestVideo;

  /// No description provided for @influencerListNoLatestVideo.
  ///
  /// In en, this message translates to:
  /// **'No uploads stored'**
  String get influencerListNoLatestVideo;

  /// No description provided for @influencerListOpenChannel.
  ///
  /// In en, this message translates to:
  /// **'Open this channel'**
  String get influencerListOpenChannel;

  /// No description provided for @influencerListRightClickHint.
  ///
  /// In en, this message translates to:
  /// **'Right-click a channel to change its status or tags.'**
  String get influencerListRightClickHint;

  /// No description provided for @influencerListScrollToBottom.
  ///
  /// In en, this message translates to:
  /// **'Scroll to bottom'**
  String get influencerListScrollToBottom;

  /// No description provided for @influencerListPinPosition.
  ///
  /// In en, this message translates to:
  /// **'Pin this position'**
  String get influencerListPinPosition;

  /// No description provided for @influencerListReturnToPin.
  ///
  /// In en, this message translates to:
  /// **'Return to pinned position'**
  String get influencerListReturnToPin;

  /// No description provided for @influencerContextMenuStatus.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get influencerContextMenuStatus;

  /// No description provided for @influencerContextMenuChannelTag.
  ///
  /// In en, this message translates to:
  /// **'Channel tag'**
  String get influencerContextMenuChannelTag;

  /// No description provided for @influencerQuickTagPresetTooltip.
  ///
  /// In en, this message translates to:
  /// **'Quick-tag preset'**
  String get influencerQuickTagPresetTooltip;

  /// No description provided for @influencerQuickTagPresetDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Quick-tag preset'**
  String get influencerQuickTagPresetDialogTitle;

  /// No description provided for @influencerQuickTagPresetDialogDescription.
  ///
  /// In en, this message translates to:
  /// **'Pick the tags to add with Ctrl + right-click, or remove with Alt + right-click, on a channel.'**
  String get influencerQuickTagPresetDialogDescription;

  /// No description provided for @influencerQuickTagPresetEmpty.
  ///
  /// In en, this message translates to:
  /// **'No quick-tag preset set. Pick one with the brush icon first.'**
  String get influencerQuickTagPresetEmpty;

  /// No description provided for @channelTagUndecided.
  ///
  /// In en, this message translates to:
  /// **'Undecided'**
  String get channelTagUndecided;

  /// No description provided for @channelTagQualified.
  ///
  /// In en, this message translates to:
  /// **'Qualified'**
  String get channelTagQualified;

  /// No description provided for @channelTagHaramStuff.
  ///
  /// In en, this message translates to:
  /// **'Haram stuff'**
  String get channelTagHaramStuff;

  /// No description provided for @channelTagIrrelevant.
  ///
  /// In en, this message translates to:
  /// **'Irrelevant'**
  String get channelTagIrrelevant;

  /// No description provided for @channelTagInactive.
  ///
  /// In en, this message translates to:
  /// **'Inactive'**
  String get channelTagInactive;

  /// No description provided for @settingsImagesTitle.
  ///
  /// In en, this message translates to:
  /// **'Saved Pictures'**
  String get settingsImagesTitle;

  /// No description provided for @settingsAutoDownloadImagesLabel.
  ///
  /// In en, this message translates to:
  /// **'Save pictures on this machine'**
  String get settingsAutoDownloadImagesLabel;

  /// No description provided for @settingsAutoDownloadImagesOn.
  ///
  /// In en, this message translates to:
  /// **'Profile pictures, banners and thumbnails are kept after they load once, so this machine never fetches the same picture twice.'**
  String get settingsAutoDownloadImagesOn;

  /// No description provided for @settingsAutoDownloadImagesOff.
  ///
  /// In en, this message translates to:
  /// **'Pictures are fetched when they are shown and nothing is written to disk. A picture already saved is still used before the network either way.'**
  String get settingsAutoDownloadImagesOff;

  /// No description provided for @settingsImagesNoStorage.
  ///
  /// In en, this message translates to:
  /// **'This build has no filesystem to save into, so every picture is fetched when it is shown.'**
  String get settingsImagesNoStorage;

  /// No description provided for @settingsImageCacheSize.
  ///
  /// In en, this message translates to:
  /// **'{size} saved'**
  String settingsImageCacheSize(String size);

  /// No description provided for @settingsImageCacheEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing saved yet.'**
  String get settingsImageCacheEmpty;

  /// No description provided for @settingsClearImageCache.
  ///
  /// In en, this message translates to:
  /// **'Delete {size} saved pictures'**
  String settingsClearImageCache(String size);

  /// No description provided for @settingsImageCacheCleared.
  ///
  /// In en, this message translates to:
  /// **'Deleted {size} of saved pictures.'**
  String settingsImageCacheCleared(String size);

  /// No description provided for @logsRangeAny.
  ///
  /// In en, this message translates to:
  /// **'Any time'**
  String get logsRangeAny;

  /// No description provided for @outreachNewMessage.
  ///
  /// In en, this message translates to:
  /// **'New message'**
  String get outreachNewMessage;

  /// No description provided for @outreachPickInfluencerTitle.
  ///
  /// In en, this message translates to:
  /// **'Who do you want to message?'**
  String get outreachPickInfluencerTitle;

  /// No description provided for @outreachPickInfluencerHint.
  ///
  /// In en, this message translates to:
  /// **'Search channels by name or handle'**
  String get outreachPickInfluencerHint;

  /// No description provided for @outreachPickInfluencerEmpty.
  ///
  /// In en, this message translates to:
  /// **'No channels match.'**
  String get outreachPickInfluencerEmpty;

  /// OS notification title when a creator's reply lands. {who} is their handle.
  ///
  /// In en, this message translates to:
  /// **'{who} replied'**
  String outreachNotifyReplyTitle(String who);

  /// No description provided for @outreachNotifyReplyAnonymousTitle.
  ///
  /// In en, this message translates to:
  /// **'A creator replied'**
  String get outreachNotifyReplyAnonymousTitle;

  /// No description provided for @outreachNotifyFollowUpFailedTitle.
  ///
  /// In en, this message translates to:
  /// **'A follow-up could not be sent'**
  String get outreachNotifyFollowUpFailedTitle;

  /// No description provided for @archiveBulkCleanStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get archiveBulkCleanStop;

  /// No description provided for @outreachComposeOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening conversation…'**
  String get outreachComposeOpening;

  /// No description provided for @outreachReminderDueToday.
  ///
  /// In en, this message translates to:
  /// **'Due today'**
  String get outreachReminderDueToday;

  /// No description provided for @outreachReminderDueInDays.
  ///
  /// In en, this message translates to:
  /// **'Due in {count} days'**
  String outreachReminderDueInDays(int count);

  /// No description provided for @outreachReminderOverdueByDays.
  ///
  /// In en, this message translates to:
  /// **'Overdue by {count} days'**
  String outreachReminderOverdueByDays(int count);

  /// No description provided for @outreachLogReply.
  ///
  /// In en, this message translates to:
  /// **'Log a reply'**
  String get outreachLogReply;

  /// No description provided for @outreachShowProfile.
  ///
  /// In en, this message translates to:
  /// **'Show profile'**
  String get outreachShowProfile;

  /// No description provided for @outreachHideProfile.
  ///
  /// In en, this message translates to:
  /// **'Hide profile'**
  String get outreachHideProfile;

  /// No description provided for @outreachOpenFullProfile.
  ///
  /// In en, this message translates to:
  /// **'Open full profile'**
  String get outreachOpenFullProfile;

  /// No description provided for @outreachComposeMethodLabel.
  ///
  /// In en, this message translates to:
  /// **'Contact method'**
  String get outreachComposeMethodLabel;

  /// No description provided for @outreachComposeSendVia.
  ///
  /// In en, this message translates to:
  /// **'Sending via {method}'**
  String outreachComposeSendVia(String method);

  /// No description provided for @outreachComposeToLabel.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get outreachComposeToLabel;

  /// No description provided for @outreachComposeMessageLabel.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get outreachComposeMessageLabel;

  /// No description provided for @outreachComposeNoContactYet.
  ///
  /// In en, this message translates to:
  /// **'No contact on file for this channel. Add one to start the conversation.'**
  String get outreachComposeNoContactYet;

  /// No description provided for @outreachComposeAddContactFor.
  ///
  /// In en, this message translates to:
  /// **'Add a {method} contact'**
  String outreachComposeAddContactFor(String method);

  /// No description provided for @outreachComposeNothingToSend.
  ///
  /// In en, this message translates to:
  /// **'Write a message before marking it sent.'**
  String get outreachComposeNothingToSend;

  /// No description provided for @outreachOpenMailApp.
  ///
  /// In en, this message translates to:
  /// **'Open mail app'**
  String get outreachOpenMailApp;

  /// No description provided for @outreachMailAppRefused.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t open a mail app — the message is on your clipboard instead.'**
  String get outreachMailAppRefused;

  /// No description provided for @outreachBodyTooLongForMail.
  ///
  /// In en, this message translates to:
  /// **'The draft is long, so the mail app opened with just the subject — the body is on your clipboard to paste in.'**
  String get outreachBodyTooLongForMail;

  /// No description provided for @outreachCopyBody.
  ///
  /// In en, this message translates to:
  /// **'Copy body'**
  String get outreachCopyBody;

  /// No description provided for @outreachCopyMessage.
  ///
  /// In en, this message translates to:
  /// **'Copy message'**
  String get outreachCopyMessage;

  /// No description provided for @outreachCopyContactValue.
  ///
  /// In en, this message translates to:
  /// **'Copy {method}'**
  String outreachCopyContactValue(String method);

  /// No description provided for @outreachOpenContactLink.
  ///
  /// In en, this message translates to:
  /// **'Open link'**
  String get outreachOpenContactLink;

  /// No description provided for @outreachMarkSent.
  ///
  /// In en, this message translates to:
  /// **'Mark as sent'**
  String get outreachMarkSent;

  /// No description provided for @outreachMessageSentVia.
  ///
  /// In en, this message translates to:
  /// **'Logged as sent via {method}.'**
  String outreachMessageSentVia(String method);

  /// No description provided for @outreachAddContactValueHint.
  ///
  /// In en, this message translates to:
  /// **'Address, number or handle'**
  String get outreachAddContactValueHint;

  /// No description provided for @outreachAddContactAdd.
  ///
  /// In en, this message translates to:
  /// **'Add & use'**
  String get outreachAddContactAdd;

  /// No description provided for @outreachRecentUploadsTitle.
  ///
  /// In en, this message translates to:
  /// **'Recent uploads — timing reference'**
  String get outreachRecentUploadsTitle;

  /// No description provided for @commonDateUnknown.
  ///
  /// In en, this message translates to:
  /// **'date unknown'**
  String get commonDateUnknown;

  /// No description provided for @outreachScheduleFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Schedule follow-up'**
  String get outreachScheduleFollowUp;

  /// No description provided for @outreachFollowUpDefaultTitle.
  ///
  /// In en, this message translates to:
  /// **'Follow up with {handle}'**
  String outreachFollowUpDefaultTitle(String handle);

  /// No description provided for @outreachFollowUpReminderLabel.
  ///
  /// In en, this message translates to:
  /// **'Reminder note'**
  String get outreachFollowUpReminderLabel;

  /// No description provided for @outreachFollowUpWhenLabel.
  ///
  /// In en, this message translates to:
  /// **'When'**
  String get outreachFollowUpWhenLabel;

  /// No description provided for @outreachFollowUpTomorrow.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow'**
  String get outreachFollowUpTomorrow;

  /// No description provided for @outreachFollowUpIn3Days.
  ///
  /// In en, this message translates to:
  /// **'In 3 days'**
  String get outreachFollowUpIn3Days;

  /// No description provided for @outreachFollowUpInAWeek.
  ///
  /// In en, this message translates to:
  /// **'In a week'**
  String get outreachFollowUpInAWeek;

  /// No description provided for @outreachFollowUpCustom.
  ///
  /// In en, this message translates to:
  /// **'Custom…'**
  String get outreachFollowUpCustom;

  /// No description provided for @outreachFollowUpPickDateTime.
  ///
  /// In en, this message translates to:
  /// **'Pick date & time'**
  String get outreachFollowUpPickDateTime;

  /// No description provided for @outreachFollowUpScheduled.
  ///
  /// In en, this message translates to:
  /// **'Follow-up set for {date}.'**
  String outreachFollowUpScheduled(String date);

  /// No description provided for @outreachFollowUpSavedNoNotif.
  ///
  /// In en, this message translates to:
  /// **'Follow-up saved — you\'ll see it on the dashboard.'**
  String get outreachFollowUpSavedNoNotif;

  /// No description provided for @outreachFollowUpMarkedDone.
  ///
  /// In en, this message translates to:
  /// **'Follow-up cleared.'**
  String get outreachFollowUpMarkedDone;

  /// No description provided for @outreachFollowUpsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled follow-ups'**
  String get outreachFollowUpsSectionTitle;

  /// No description provided for @outreachFollowUpClear.
  ///
  /// In en, this message translates to:
  /// **'Mark done'**
  String get outreachFollowUpClear;

  /// No description provided for @outreachFollowUpNumbered.
  ///
  /// In en, this message translates to:
  /// **'Follow-up {number} of {total}'**
  String outreachFollowUpNumbered(int number, int total);

  /// No description provided for @outreachFollowUpLeft.
  ///
  /// In en, this message translates to:
  /// **'{duration} left'**
  String outreachFollowUpLeft(String duration);

  /// No description provided for @outreachFollowUpOverdue.
  ///
  /// In en, this message translates to:
  /// **'{duration} overdue'**
  String outreachFollowUpOverdue(String duration);

  /// No description provided for @outreachDurationDaysHours.
  ///
  /// In en, this message translates to:
  /// **'{days}d {hours}h'**
  String outreachDurationDaysHours(int days, int hours);

  /// No description provided for @outreachDurationHoursMinutes.
  ///
  /// In en, this message translates to:
  /// **'{hours}h {minutes}m'**
  String outreachDurationHoursMinutes(int hours, int minutes);

  /// No description provided for @outreachDurationMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m'**
  String outreachDurationMinutes(int minutes);

  /// No description provided for @outreachFollowUpsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No follow-up scheduled.'**
  String get outreachFollowUpsEmpty;

  /// No description provided for @outreachFollowUpsSequenceDone.
  ///
  /// In en, this message translates to:
  /// **'Three follow-ups sent with no reply. Wait two weeks to two months, then start a new thread with a new angle.'**
  String get outreachFollowUpsSequenceDone;

  /// No description provided for @outreachFollowUpsApproval.
  ///
  /// In en, this message translates to:
  /// **'Each follow-up is written and approved when it\'s due. Nothing is sent by itself.'**
  String get outreachFollowUpsApproval;

  /// No description provided for @outreachNoFollowUps.
  ///
  /// In en, this message translates to:
  /// **'No follow-ups scheduled.'**
  String get outreachNoFollowUps;

  /// No description provided for @outreachLogReplyTitle.
  ///
  /// In en, this message translates to:
  /// **'Log a reply'**
  String get outreachLogReplyTitle;

  /// No description provided for @outreachLogReplyBodyLabel.
  ///
  /// In en, this message translates to:
  /// **'What they said'**
  String get outreachLogReplyBodyLabel;

  /// No description provided for @outreachLogReplyMethodLabel.
  ///
  /// In en, this message translates to:
  /// **'Came in via'**
  String get outreachLogReplyMethodLabel;

  /// No description provided for @outreachLogReplyReceivedLabel.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get outreachLogReplyReceivedLabel;

  /// No description provided for @outreachReplyLogged.
  ///
  /// In en, this message translates to:
  /// **'Reply logged.'**
  String get outreachReplyLogged;

  /// No description provided for @influencerProfileContactAction.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get influencerProfileContactAction;

  /// No description provided for @influencerProfileOpenConversation.
  ///
  /// In en, this message translates to:
  /// **'Open conversation'**
  String get influencerProfileOpenConversation;

  /// No description provided for @navArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get navArchive;

  /// No description provided for @archiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get archiveTitle;

  /// No description provided for @archiveExplanation.
  ///
  /// In en, this message translates to:
  /// **'Channels tagged haram stuff or irrelevant are reduced to a short record 7 days after tagging, and everything else about them is deleted: videos, notes, contacts, description. Only what you see here is kept.'**
  String get archiveExplanation;

  /// No description provided for @archiveHoldingCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing archived yet} =1{1 archived channel} other{{count} archived channels}}'**
  String archiveHoldingCount(int count);

  /// No description provided for @archiveSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by handle'**
  String get archiveSearchHint;

  /// No description provided for @archiveFilterLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get archiveFilterLabel;

  /// No description provided for @archiveFilterAllLabels.
  ///
  /// In en, this message translates to:
  /// **'All reasons'**
  String get archiveFilterAllLabels;

  /// No description provided for @archiveSortLabel.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get archiveSortLabel;

  /// No description provided for @archiveSortArchivedAt.
  ///
  /// In en, this message translates to:
  /// **'Date archived'**
  String get archiveSortArchivedAt;

  /// No description provided for @archiveSortHandle.
  ///
  /// In en, this message translates to:
  /// **'Handle'**
  String get archiveSortHandle;

  /// No description provided for @archiveSortSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Subscribers'**
  String get archiveSortSubscribers;

  /// No description provided for @archiveSortVideos.
  ///
  /// In en, this message translates to:
  /// **'Videos found'**
  String get archiveSortVideos;

  /// No description provided for @archiveSortAverageViews.
  ///
  /// In en, this message translates to:
  /// **'Median views'**
  String get archiveSortAverageViews;

  /// No description provided for @archiveEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing has been archived yet.'**
  String get archiveEmpty;

  /// No description provided for @archiveEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'A channel arrives here 7 days after it is tagged haram stuff or irrelevant.'**
  String get archiveEmptyHint;

  /// No description provided for @archiveNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No archived channel matches this filter.'**
  String get archiveNoMatches;

  /// No description provided for @archiveColumnSubscribers.
  ///
  /// In en, this message translates to:
  /// **'Subscribers'**
  String get archiveColumnSubscribers;

  /// No description provided for @archiveColumnAvgViews.
  ///
  /// In en, this message translates to:
  /// **'Median views'**
  String get archiveColumnAvgViews;

  /// No description provided for @archiveColumnVideos.
  ///
  /// In en, this message translates to:
  /// **'Videos found'**
  String get archiveColumnVideos;

  /// No description provided for @archiveArchivedOn.
  ///
  /// In en, this message translates to:
  /// **'Archived {date}'**
  String archiveArchivedOn(String date);

  /// No description provided for @archiveFoundOn.
  ///
  /// In en, this message translates to:
  /// **'Found {date}'**
  String archiveFoundOn(String date);

  /// No description provided for @archiveNoAverage.
  ///
  /// In en, this message translates to:
  /// **'No view counts were ever recorded'**
  String get archiveNoAverage;

  /// No description provided for @archiveMedianNotFetched.
  ///
  /// In en, this message translates to:
  /// **'Rejected on its subscriber count during the search, before any video was fetched — there was never a median to record'**
  String get archiveMedianNotFetched;

  /// No description provided for @archiveMedianLifetime.
  ///
  /// In en, this message translates to:
  /// **'Median over every stored video. Nothing was uploaded in the 30 days before this channel was last read, so the usual 30-day figure has nothing to average'**
  String get archiveMedianLifetime;

  /// No description provided for @archiveMedianWindow30.
  ///
  /// In en, this message translates to:
  /// **'Median views over the 30 days before this channel was last read — the same figure the Influencers list shows'**
  String get archiveMedianWindow30;

  /// No description provided for @archiveVideosNotCounted.
  ///
  /// In en, this message translates to:
  /// **'Never counted — no videos were fetched for this channel before it was archived'**
  String get archiveVideosNotCounted;

  /// No description provided for @archiveVideosNone.
  ///
  /// In en, this message translates to:
  /// **'The channel\'s videos were read and there were none'**
  String get archiveVideosNone;

  /// No description provided for @archiveOpenOnYoutube.
  ///
  /// In en, this message translates to:
  /// **'Open on YouTube'**
  String get archiveOpenOnYoutube;

  /// No description provided for @archiveLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get archiveLoadMore;

  /// No description provided for @archiveLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the archive.'**
  String get archiveLoadFailed;

  /// No description provided for @archiveRestoreNote.
  ///
  /// In en, this message translates to:
  /// **'Use the ✕ on a row to free a channel: it is queued for enrichment and comes back to the Influencers list as a new find. Nothing that was deleted returns.'**
  String get archiveRestoreNote;

  /// No description provided for @archiveChangeReasonTooltip.
  ///
  /// In en, this message translates to:
  /// **'Change the reason'**
  String get archiveChangeReasonTooltip;

  /// No description provided for @archiveReasonChanged.
  ///
  /// In en, this message translates to:
  /// **'Reason changed to {reason}'**
  String archiveReasonChanged(String reason);

  /// No description provided for @archiveReasonChangeFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t change the reason.'**
  String get archiveReasonChangeFailed;

  /// No description provided for @archiveFreeTooltip.
  ///
  /// In en, this message translates to:
  /// **'Free this channel and re-enrich it'**
  String get archiveFreeTooltip;

  /// No description provided for @archiveFreeUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Freeing a channel re-enriches it, which needs the installed desktop app.'**
  String get archiveFreeUnavailable;

  /// No description provided for @archiveFreeConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Free {handle} from the archive?'**
  String archiveFreeConfirmTitle(String handle);

  /// No description provided for @archiveFreeConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'The record is removed and the channel is queued for enrichment. It comes back to the Influencers list as a new, un-vetted find — with no tags and no countdown. Nothing that was deleted when it was archived returns.'**
  String get archiveFreeConfirmBody;

  /// No description provided for @archiveFreeConfirmAction.
  ///
  /// In en, this message translates to:
  /// **'Free & enrich'**
  String get archiveFreeConfirmAction;

  /// No description provided for @archiveFreeStarted.
  ///
  /// In en, this message translates to:
  /// **'Freed {handle} — enriching now. See the Search page for progress.'**
  String archiveFreeStarted(String handle);

  /// No description provided for @archiveFreeBusy.
  ///
  /// In en, this message translates to:
  /// **'The pipeline is busy right now. Try again once the current run finishes.'**
  String get archiveFreeBusy;

  /// No description provided for @archiveFreeFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t free the channel.'**
  String get archiveFreeFailed;

  /// No description provided for @influencerArchivesIn.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =0{Archives today} =1{Archives tomorrow} other{Archives in {days} days}}'**
  String influencerArchivesIn(int days);

  /// No description provided for @influencerArchivePendingTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled for archiving'**
  String get influencerArchivePendingTitle;

  /// No description provided for @influencerArchivePendingBody.
  ///
  /// In en, this message translates to:
  /// **'This channel is tagged {label}. On {date} it will be reduced to a handle, its counts and that label, and everything else — every video, note and contact — will be deleted. Remove the tag to keep it.'**
  String influencerArchivePendingBody(String label, String date);

  /// No description provided for @influencerArchiveNow.
  ///
  /// In en, this message translates to:
  /// **'Archive now'**
  String get influencerArchiveNow;

  /// No description provided for @influencerArchiveNowConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive this channel now?'**
  String get influencerArchiveNowConfirmTitle;

  /// No description provided for @influencerArchiveNowConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'It will be reduced to its handle, subscriber count, median views, video count and label right now. Its videos, notes and contacts will be deleted and cannot be recovered.'**
  String get influencerArchiveNowConfirmBody;

  /// No description provided for @influencerArchiveNowConfirm.
  ///
  /// In en, this message translates to:
  /// **'Archive it'**
  String get influencerArchiveNowConfirm;

  /// No description provided for @influencerArchiveScheduled.
  ///
  /// In en, this message translates to:
  /// **'Archiving now.'**
  String get influencerArchiveScheduled;

  /// No description provided for @influencerArchiveKeep.
  ///
  /// In en, this message translates to:
  /// **'Keep this channel'**
  String get influencerArchiveKeep;

  /// No description provided for @influencerArchiveKept.
  ///
  /// In en, this message translates to:
  /// **'Archiving cancelled.'**
  String get influencerArchiveKept;

  /// No description provided for @commonRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get commonRefresh;

  /// No description provided for @commonSortAscending.
  ///
  /// In en, this message translates to:
  /// **'Ascending'**
  String get commonSortAscending;

  /// No description provided for @commonSortDescending.
  ///
  /// In en, this message translates to:
  /// **'Descending'**
  String get commonSortDescending;

  /// No description provided for @navConflicts.
  ///
  /// In en, this message translates to:
  /// **'Conflicts'**
  String get navConflicts;

  /// No description provided for @conflictDetectedSnack.
  ///
  /// In en, this message translates to:
  /// **'Somebody edited this first. Your version is saved on the Conflicts page.'**
  String get conflictDetectedSnack;

  /// No description provided for @conflictChannelGone.
  ///
  /// In en, this message translates to:
  /// **'That channel no longer exists.'**
  String get conflictChannelGone;

  /// No description provided for @conflictsTitle.
  ///
  /// In en, this message translates to:
  /// **'Conflicts'**
  String get conflictsTitle;

  /// No description provided for @conflictsExplanation.
  ///
  /// In en, this message translates to:
  /// **'An edit lands here only when it was written against a value somebody had already changed — so neither version contains the other. Editing on top of a colleague\'s saved work never appears here.'**
  String get conflictsExplanation;

  /// No description provided for @conflictsNone.
  ///
  /// In en, this message translates to:
  /// **'No conflicts.'**
  String get conflictsNone;

  /// No description provided for @conflictsNoneHint.
  ///
  /// In en, this message translates to:
  /// **'Edits that build on each other are applied silently; only genuinely diverging ones need a decision.'**
  String get conflictsNoneHint;

  /// No description provided for @conflictsOpenSection.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a decision'**
  String get conflictsOpenSection;

  /// No description provided for @conflictsResolvedSection.
  ///
  /// In en, this message translates to:
  /// **'Recently settled'**
  String get conflictsResolvedSection;

  /// No description provided for @conflictsOpenCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No conflicts} =1{1 conflict} other{{count} conflicts}}'**
  String conflictsOpenCount(int count);

  /// No description provided for @conflictsShellBanner.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{An edit is waiting for a decision} other{{count} edits are waiting for a decision}}'**
  String conflictsShellBanner(int count);

  /// No description provided for @conflictFieldNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get conflictFieldNotes;

  /// No description provided for @conflictFieldTags.
  ///
  /// In en, this message translates to:
  /// **'Channel tags'**
  String get conflictFieldTags;

  /// No description provided for @conflictFieldStage.
  ///
  /// In en, this message translates to:
  /// **'Pipeline stage'**
  String get conflictFieldStage;

  /// No description provided for @conflictFieldVetting.
  ///
  /// In en, this message translates to:
  /// **'Vetting status'**
  String get conflictFieldVetting;

  /// No description provided for @conflictFieldCriteria.
  ///
  /// In en, this message translates to:
  /// **'Relevance criteria'**
  String get conflictFieldCriteria;

  /// No description provided for @conflictFieldProvided.
  ///
  /// In en, this message translates to:
  /// **'Provided data'**
  String get conflictFieldProvided;

  /// No description provided for @conflictFieldContacts.
  ///
  /// In en, this message translates to:
  /// **'Contacts'**
  String get conflictFieldContacts;

  /// No description provided for @conflictOnChannel.
  ///
  /// In en, this message translates to:
  /// **'{field} on {channel}'**
  String conflictOnChannel(String field, String channel);

  /// No description provided for @conflictMineBy.
  ///
  /// In en, this message translates to:
  /// **'{name} wrote'**
  String conflictMineBy(String name);

  /// No description provided for @conflictTheirsBy.
  ///
  /// In en, this message translates to:
  /// **'{name} wrote'**
  String conflictTheirsBy(String name);

  /// No description provided for @conflictTheirsUnknown.
  ///
  /// In en, this message translates to:
  /// **'Someone else wrote'**
  String get conflictTheirsUnknown;

  /// No description provided for @conflictBaseWas.
  ///
  /// In en, this message translates to:
  /// **'Both started from'**
  String get conflictBaseWas;

  /// No description provided for @conflictKeepMine.
  ///
  /// In en, this message translates to:
  /// **'Keep this one'**
  String get conflictKeepMine;

  /// No description provided for @conflictKeepTheirs.
  ///
  /// In en, this message translates to:
  /// **'Keep this one'**
  String get conflictKeepTheirs;

  /// No description provided for @conflictMerge.
  ///
  /// In en, this message translates to:
  /// **'Write something else'**
  String get conflictMerge;

  /// No description provided for @conflictMergeTitle.
  ///
  /// In en, this message translates to:
  /// **'Combine both versions'**
  String get conflictMergeTitle;

  /// No description provided for @conflictMergeHint.
  ///
  /// In en, this message translates to:
  /// **'Both versions are above. Edit this into what the field should say.'**
  String get conflictMergeHint;

  /// No description provided for @conflictMergeSave.
  ///
  /// In en, this message translates to:
  /// **'Save this'**
  String get conflictMergeSave;

  /// No description provided for @conflictResolvedBy.
  ///
  /// In en, this message translates to:
  /// **'Settled by {name}'**
  String conflictResolvedBy(String name);

  /// No description provided for @conflictResolutionMine.
  ///
  /// In en, this message translates to:
  /// **'kept {name}\'s version'**
  String conflictResolutionMine(String name);

  /// No description provided for @conflictResolutionTheirs.
  ///
  /// In en, this message translates to:
  /// **'kept {name}\'s version'**
  String conflictResolutionTheirs(String name);

  /// No description provided for @conflictResolutionMerged.
  ///
  /// In en, this message translates to:
  /// **'combined both'**
  String get conflictResolutionMerged;

  /// No description provided for @conflictResolveFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t settle that conflict.'**
  String get conflictResolveFailed;

  /// No description provided for @conflictAlreadyResolved.
  ///
  /// In en, this message translates to:
  /// **'Somebody already settled that one.'**
  String get conflictAlreadyResolved;

  /// No description provided for @conflictOpenChannel.
  ///
  /// In en, this message translates to:
  /// **'Open the channel'**
  String get conflictOpenChannel;

  /// No description provided for @conflictProfileBannerTitle.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{An edit to this channel needs a decision} other{{count} edits to this channel need a decision}}'**
  String conflictProfileBannerTitle(int count);

  /// No description provided for @conflictProfileBannerAction.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get conflictProfileBannerAction;

  /// No description provided for @conflictDetectedAt.
  ///
  /// In en, this message translates to:
  /// **'Detected {date}'**
  String conflictDetectedAt(String date);

  /// No description provided for @conflictEmptyValue.
  ///
  /// In en, this message translates to:
  /// **'(empty)'**
  String get conflictEmptyValue;

  /// No description provided for @archiveBulkCleanAction.
  ///
  /// In en, this message translates to:
  /// **'Bulk clean'**
  String get archiveBulkCleanAction;

  /// No description provided for @archiveBulkCleanTitle.
  ///
  /// In en, this message translates to:
  /// **'Reject many channels at once, by size'**
  String get archiveBulkCleanTitle;

  /// No description provided for @archiveBulkCleanBody.
  ///
  /// In en, this message translates to:
  /// **'Tags every channel whose size falls inside the ranges below as rejected, in one pass. Nothing is deleted today: a tagged channel is archived 7 days later, and clearing the tag before then keeps it.'**
  String get archiveBulkCleanBody;

  /// No description provided for @archiveBulkCleanSubsSection.
  ///
  /// In en, this message translates to:
  /// **'Subscriber range to reject'**
  String get archiveBulkCleanSubsSection;

  /// No description provided for @archiveBulkCleanAvgSection.
  ///
  /// In en, this message translates to:
  /// **'Median-views range to reject'**
  String get archiveBulkCleanAvgSection;

  /// No description provided for @archiveBulkCleanRangeTip.
  ///
  /// In en, this message translates to:
  /// **'A reject band — the opposite of the search page\'s keep band. A channel inside every range you fill in is tagged; anything outside is left alone.'**
  String get archiveBulkCleanRangeTip;

  /// No description provided for @archiveBulkCleanMinLabel.
  ///
  /// In en, this message translates to:
  /// **'From (subscribers)'**
  String get archiveBulkCleanMinLabel;

  /// No description provided for @archiveBulkCleanMaxLabel.
  ///
  /// In en, this message translates to:
  /// **'To (subscribers)'**
  String get archiveBulkCleanMaxLabel;

  /// No description provided for @archiveBulkCleanAvgMinLabel.
  ///
  /// In en, this message translates to:
  /// **'From (median views)'**
  String get archiveBulkCleanAvgMinLabel;

  /// No description provided for @archiveBulkCleanAvgMaxLabel.
  ///
  /// In en, this message translates to:
  /// **'To (median views)'**
  String get archiveBulkCleanAvgMaxLabel;

  /// No description provided for @archiveBulkCleanBoundsHint.
  ///
  /// In en, this message translates to:
  /// **'Leave a side empty for an open end. A channel is rejected only when it is inside every range you fill in.'**
  String get archiveBulkCleanBoundsHint;

  /// No description provided for @archiveBulkCleanNeedsBound.
  ///
  /// In en, this message translates to:
  /// **'Set at least one end of one range.'**
  String get archiveBulkCleanNeedsBound;

  /// No description provided for @archiveBulkCleanLabelLabel.
  ///
  /// In en, this message translates to:
  /// **'Tag them as'**
  String get archiveBulkCleanLabelLabel;

  /// No description provided for @archiveBulkCleanImmediate.
  ///
  /// In en, this message translates to:
  /// **'Delete now, skipping the 7 days'**
  String get archiveBulkCleanImmediate;

  /// No description provided for @archiveBulkCleanImmediateHint.
  ///
  /// In en, this message translates to:
  /// **'Permanent, and it cascades: every video, note and contact on these channels goes with them. The grace period is the only thing standing between a mistyped range and losing them all.'**
  String get archiveBulkCleanImmediateHint;

  /// No description provided for @archiveBulkCleanPreview.
  ///
  /// In en, this message translates to:
  /// **'Check the range'**
  String get archiveBulkCleanPreview;

  /// No description provided for @archiveBulkCleanRecheck.
  ///
  /// In en, this message translates to:
  /// **'Re-check'**
  String get archiveBulkCleanRecheck;

  /// No description provided for @archiveBulkCleanDeleting.
  ///
  /// In en, this message translates to:
  /// **'Deleting {done} of {total}…'**
  String archiveBulkCleanDeleting(int done, int total);

  /// No description provided for @archiveBulkCleanMatched.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No channel matches this range} =1{1 channel matches} other{{count} channels match}}'**
  String archiveBulkCleanMatched(int count);

  /// No description provided for @archiveBulkCleanSkippedTagged.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{} =1{1 more is already tagged and counting down.} other{{count} more are already tagged and counting down.}}'**
  String archiveBulkCleanSkippedTagged(int count);

  /// No description provided for @archiveBulkCleanSkippedProtected.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{} =1{1 is left alone because there is a deal or an outreach history with them.} other{{count} are left alone because there are deals or outreach histories with them.}}'**
  String archiveBulkCleanSkippedProtected(int count);

  /// No description provided for @archiveBulkCleanSkippedUnknown.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{} =1{1 channel is missing a number these ranges need, and is in no range at all.} other{{count} channels are missing a number these ranges need, and are in no range at all.}}'**
  String archiveBulkCleanSkippedUnknown(int count);

  /// No description provided for @archiveBulkCleanConfirmTag.
  ///
  /// In en, this message translates to:
  /// **'Tag {count}'**
  String archiveBulkCleanConfirmTag(int count);

  /// No description provided for @archiveBulkCleanConfirmDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete {count} now'**
  String archiveBulkCleanConfirmDelete(int count);

  /// No description provided for @archiveBulkCleanTagged.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 channel tagged. It is archived in 7 days.} other{{count} channels tagged. They are archived in 7 days.}}'**
  String archiveBulkCleanTagged(int count);

  /// No description provided for @archiveBulkCleanArchived.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 channel archived.} other{{count} channels archived.}}'**
  String archiveBulkCleanArchived(int count);

  /// No description provided for @archiveBulkCleanFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t run the bulk clean.'**
  String get archiveBulkCleanFailed;

  /// No description provided for @archiveBulkCleanUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Bulk cleaning needs full authority.'**
  String get archiveBulkCleanUnavailable;

  /// No description provided for @archiveBulkCleanModeLive.
  ///
  /// In en, this message translates to:
  /// **'Live'**
  String get archiveBulkCleanModeLive;

  /// No description provided for @archiveBulkCleanModeScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled for archive'**
  String get archiveBulkCleanModeScheduled;

  /// No description provided for @archiveBulkCleanDueTitle.
  ///
  /// In en, this message translates to:
  /// **'Act on channels already counting down'**
  String get archiveBulkCleanDueTitle;

  /// No description provided for @archiveBulkCleanDueBody.
  ///
  /// In en, this message translates to:
  /// **'Acts on channels already tagged and counting down to being archived. Narrow by the ranges below, or leave them blank to reach every channel currently due.'**
  String get archiveBulkCleanDueBody;

  /// No description provided for @archiveBulkCleanDueMatched.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No channel is currently due in this range} =1{1 channel is currently due} other{{count} channels are currently due}}'**
  String archiveBulkCleanDueMatched(int count);

  /// No description provided for @archiveBulkCleanConfirmArchiveNow.
  ///
  /// In en, this message translates to:
  /// **'Archive {count} now'**
  String archiveBulkCleanConfirmArchiveNow(int count);

  /// No description provided for @archiveBulkCleanConfirmUndo.
  ///
  /// In en, this message translates to:
  /// **'Undo archive for {count}'**
  String archiveBulkCleanConfirmUndo(int count);

  /// No description provided for @archiveBulkCleanArchiveNowHint.
  ///
  /// In en, this message translates to:
  /// **'Skips whatever is left of the 7 days and deletes now. Permanent, and it cascades: every video, note and contact on these channels goes with them.'**
  String get archiveBulkCleanArchiveNowHint;

  /// No description provided for @archiveBulkCleanUndoHint.
  ///
  /// In en, this message translates to:
  /// **'Clears every tag on these channels, the same as unchecking them by hand. Cancels the countdown — nothing is deleted.'**
  String get archiveBulkCleanUndoHint;

  /// No description provided for @archiveBulkCleanUndone.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 channel untagged. The countdown is cancelled.} other{{count} channels untagged. The countdown is cancelled.}}'**
  String archiveBulkCleanUndone(int count);

  /// No description provided for @searchAutoCleanTitle.
  ///
  /// In en, this message translates to:
  /// **'Auto-clean results'**
  String get searchAutoCleanTitle;

  /// No description provided for @searchAutoCleanBody.
  ///
  /// In en, this message translates to:
  /// **'Two keep bands — a subscriber range and an average-views range. A channel that lands inside both is collected as normal. A channel outside either one is acted on: for the subscriber band, during the run itself, before its videos cost anything; for both bands, by a sweep of that run\'s finds after it ends.'**
  String get searchAutoCleanBody;

  /// No description provided for @searchAutoCleanEnable.
  ///
  /// In en, this message translates to:
  /// **'Apply this to every run'**
  String get searchAutoCleanEnable;

  /// No description provided for @searchAutoCleanEnableHint.
  ///
  /// In en, this message translates to:
  /// **'Runs on its own, with no confirmation step. The below/above actions decide what that means — leave it off unless those are choices you would make without reading a count first.'**
  String get searchAutoCleanEnableHint;

  /// No description provided for @searchAutoCleanOff.
  ///
  /// In en, this message translates to:
  /// **'Off — finished runs are left alone'**
  String get searchAutoCleanOff;

  /// No description provided for @searchAutoCleanNoBounds.
  ///
  /// In en, this message translates to:
  /// **'On, but no range set — nothing will be cleaned'**
  String get searchAutoCleanNoBounds;

  /// No description provided for @searchAutoCleanSubsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Subscriber range to keep'**
  String get searchAutoCleanSubsSectionTitle;

  /// No description provided for @searchAutoCleanAvgSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Median-views range to keep'**
  String get searchAutoCleanAvgSectionTitle;

  /// No description provided for @searchAutoCleanKeepBandTip.
  ///
  /// In en, this message translates to:
  /// **'A keep band. A channel whose number lands inside it is collected as normal; one outside it — on either side — is what this rule acts on.'**
  String get searchAutoCleanKeepBandTip;

  /// No description provided for @searchAutoCleanActionSweepNote.
  ///
  /// In en, this message translates to:
  /// **'Archive during the run — the channel is tagged rejected and synced up before its videos are fetched, and the after-the-run sweep tags it too.'**
  String get searchAutoCleanActionSweepNote;

  /// No description provided for @searchAutoCleanActionDelayNote.
  ///
  /// In en, this message translates to:
  /// **'Keep, fetch videos later — the channel stays and is not archived; its videos are skipped now and read later from the backlog.'**
  String get searchAutoCleanActionDelayNote;

  /// No description provided for @searchAutoCleanActionOffNote.
  ///
  /// In en, this message translates to:
  /// **'Treat as in range — nothing special; collected exactly like a channel inside the band.'**
  String get searchAutoCleanActionOffNote;

  /// No description provided for @searchAutoCleanAvgNote.
  ///
  /// In en, this message translates to:
  /// **'Same keep band as above, but a channel\'s median views are not known until its videos are read — so one outside this range is always handled by the after-the-run sweep, never deferred.'**
  String get searchAutoCleanAvgNote;

  /// No description provided for @searchAutoCleanHousePreset.
  ///
  /// In en, this message translates to:
  /// **'Use the house rule: about 50K views, no size cap'**
  String get searchAutoCleanHousePreset;

  /// No description provided for @searchAutoCleanKeepAvgMinLabel.
  ///
  /// In en, this message translates to:
  /// **'Keep from (median views)'**
  String get searchAutoCleanKeepAvgMinLabel;

  /// No description provided for @searchAutoCleanKeepAvgMaxLabel.
  ///
  /// In en, this message translates to:
  /// **'Keep up to (median views)'**
  String get searchAutoCleanKeepAvgMaxLabel;

  /// No description provided for @searchAutoCleanKeepSummary.
  ///
  /// In en, this message translates to:
  /// **'Keeps {range}'**
  String searchAutoCleanKeepSummary(String range);

  /// No description provided for @searchAutoCleanRejectsSummary.
  ///
  /// In en, this message translates to:
  /// **'Rejects new finds {ranges}'**
  String searchAutoCleanRejectsSummary(String ranges);

  /// No description provided for @searchAutoCleanGateBelow.
  ///
  /// In en, this message translates to:
  /// **'below → {action}'**
  String searchAutoCleanGateBelow(String action);

  /// No description provided for @searchAutoCleanGateAbove.
  ///
  /// In en, this message translates to:
  /// **'above → {action}'**
  String searchAutoCleanGateAbove(String action);

  /// No description provided for @searchAutoCleanAlsoRejects.
  ///
  /// In en, this message translates to:
  /// **'also rejects {ranges}'**
  String searchAutoCleanAlsoRejects(String ranges);

  /// No description provided for @searchAutoCleanActionSweep.
  ///
  /// In en, this message translates to:
  /// **'archived'**
  String get searchAutoCleanActionSweep;

  /// No description provided for @searchAutoCleanActionDelay.
  ///
  /// In en, this message translates to:
  /// **'videos deferred'**
  String get searchAutoCleanActionDelay;

  /// No description provided for @searchAutoCleanActionOff.
  ///
  /// In en, this message translates to:
  /// **'left in range'**
  String get searchAutoCleanActionOff;

  /// No description provided for @searchAutoCleanBelowMinLabel.
  ///
  /// In en, this message translates to:
  /// **'Below the range'**
  String get searchAutoCleanBelowMinLabel;

  /// No description provided for @searchAutoCleanAboveMaxLabel.
  ///
  /// In en, this message translates to:
  /// **'Above the range'**
  String get searchAutoCleanAboveMaxLabel;

  /// No description provided for @searchAutoCleanKeepMinLabel.
  ///
  /// In en, this message translates to:
  /// **'Keep from (subscribers)'**
  String get searchAutoCleanKeepMinLabel;

  /// No description provided for @searchAutoCleanKeepMaxLabel.
  ///
  /// In en, this message translates to:
  /// **'Keep up to (subscribers)'**
  String get searchAutoCleanKeepMaxLabel;

  /// No description provided for @searchAutoCleanActionSweepOption.
  ///
  /// In en, this message translates to:
  /// **'Archive it during the run'**
  String get searchAutoCleanActionSweepOption;

  /// No description provided for @searchAutoCleanActionDelayOption.
  ///
  /// In en, this message translates to:
  /// **'Keep it, fetch its videos later'**
  String get searchAutoCleanActionDelayOption;

  /// No description provided for @searchAutoCleanActionOffOption.
  ///
  /// In en, this message translates to:
  /// **'Treat it as in range'**
  String get searchAutoCleanActionOffOption;

  /// No description provided for @searchAutoCleanAnd.
  ///
  /// In en, this message translates to:
  /// **' and '**
  String get searchAutoCleanAnd;

  /// No description provided for @searchAutoCleanSubscribersWord.
  ///
  /// In en, this message translates to:
  /// **'subscribers'**
  String get searchAutoCleanSubscribersWord;

  /// No description provided for @searchAutoCleanAvgViewsWord.
  ///
  /// In en, this message translates to:
  /// **'median views'**
  String get searchAutoCleanAvgViewsWord;

  /// No description provided for @searchAutoCleanUnder.
  ///
  /// In en, this message translates to:
  /// **'under {value} {what}'**
  String searchAutoCleanUnder(String what, int value);

  /// No description provided for @searchAutoCleanOver.
  ///
  /// In en, this message translates to:
  /// **'over {value} {what}'**
  String searchAutoCleanOver(String what, int value);

  /// No description provided for @searchAutoCleanBetween.
  ///
  /// In en, this message translates to:
  /// **'{from}–{to} {what}'**
  String searchAutoCleanBetween(String what, int from, int to);

  /// No description provided for @searchAutoCleanBoundsHint.
  ///
  /// In en, this message translates to:
  /// **'Leave a side of a range empty for an open end. With no range set at all, nothing is cleaned.'**
  String get searchAutoCleanBoundsHint;

  /// No description provided for @searchAutoCleanNeedsBound.
  ///
  /// In en, this message translates to:
  /// **'Set at least one end of one range, or nothing will be cleaned.'**
  String get searchAutoCleanNeedsBound;

  /// No description provided for @searchAutoCleanScopeNote.
  ///
  /// In en, this message translates to:
  /// **'Only channels the finished run itself found. A channel discovered by an earlier run, or one somebody has already looked at, is never touched.'**
  String get searchAutoCleanScopeNote;

  /// No description provided for @searchAutoCleanGraceNote.
  ///
  /// In en, this message translates to:
  /// **'Tagging only. The tagged channels are archived 7 days later, so removing the tag before then keeps them. Nothing is deleted automatically.'**
  String get searchAutoCleanGraceNote;

  /// No description provided for @searchAutoCleanRan.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Last run: nothing matched the ranges} =1{Last run: 1 channel tagged, archived in 7 days} other{Last run: {count} channels tagged, archived in 7 days}}'**
  String searchAutoCleanRan(int count);

  /// No description provided for @searchAutoCleanSkippedUnknown.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{} =1{1 more was left alone: no median views have been recorded for it, so it is in no range at all.} other{{count} more were left alone: no median views have been recorded for them, so they are in no range at all.}}'**
  String searchAutoCleanSkippedUnknown(int count);

  /// No description provided for @searchAutoCleanFailed.
  ///
  /// In en, this message translates to:
  /// **'The automatic clean couldn\'t run. The search itself finished normally.'**
  String get searchAutoCleanFailed;

  /// No description provided for @searchAutoCleanMinVideosLabel.
  ///
  /// In en, this message translates to:
  /// **'Min videos (last 30 days)'**
  String get searchAutoCleanMinVideosLabel;

  /// No description provided for @searchAutoCleanMinVideosHint.
  ///
  /// In en, this message translates to:
  /// **'Reject a channel that posted fewer than this many videos in the last 30 days. Leave blank to ignore how active a channel is.'**
  String get searchAutoCleanMinVideosHint;

  /// No description provided for @searchAutoCleanFewerVideos.
  ///
  /// In en, this message translates to:
  /// **'fewer than {value} videos in 30 days'**
  String searchAutoCleanFewerVideos(int value);

  /// No description provided for @dashboardAnalyticsTitle.
  ///
  /// In en, this message translates to:
  /// **'Channel analytics'**
  String get dashboardAnalyticsTitle;

  /// No description provided for @dashboardAnalyticsBody.
  ///
  /// In en, this message translates to:
  /// **'Everything the pipeline has found, and what is in it. The filters only narrow what is shown and counted here — they change nothing and archive nothing. Min/Max are inclusive: a channel is shown when it sits at or inside every bound you set. Every figure below follows the filter.'**
  String get dashboardAnalyticsBody;

  /// No description provided for @dashboardAnalyticsFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the analytics.'**
  String get dashboardAnalyticsFailed;

  /// No description provided for @dashboardAnalyticsNoChannels.
  ///
  /// In en, this message translates to:
  /// **'No channel matches this filter.'**
  String get dashboardAnalyticsNoChannels;

  /// No description provided for @dashboardAnalyticsFilterCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get dashboardAnalyticsFilterCountry;

  /// No description provided for @dashboardAnalyticsFilterStage.
  ///
  /// In en, this message translates to:
  /// **'Pipeline stage'**
  String get dashboardAnalyticsFilterStage;

  /// No description provided for @dashboardAnalyticsFilterVetting.
  ///
  /// In en, this message translates to:
  /// **'Vetting'**
  String get dashboardAnalyticsFilterVetting;

  /// No description provided for @dashboardAnalyticsFilterTag.
  ///
  /// In en, this message translates to:
  /// **'Tag'**
  String get dashboardAnalyticsFilterTag;

  /// No description provided for @dashboardAnalyticsFilterAny.
  ///
  /// In en, this message translates to:
  /// **'Any'**
  String get dashboardAnalyticsFilterAny;

  /// No description provided for @dashboardAnalyticsFilterMinSubs.
  ///
  /// In en, this message translates to:
  /// **'Min subscribers'**
  String get dashboardAnalyticsFilterMinSubs;

  /// No description provided for @dashboardAnalyticsFilterMaxSubs.
  ///
  /// In en, this message translates to:
  /// **'Max subscribers'**
  String get dashboardAnalyticsFilterMaxSubs;

  /// No description provided for @dashboardAnalyticsFilterMinAvgViews.
  ///
  /// In en, this message translates to:
  /// **'Min median views (30d)'**
  String get dashboardAnalyticsFilterMinAvgViews;

  /// No description provided for @dashboardAnalyticsFilterMaxAvgViews.
  ///
  /// In en, this message translates to:
  /// **'Max median views (30d)'**
  String get dashboardAnalyticsFilterMaxAvgViews;

  /// No description provided for @dashboardAnalyticsFilterMinVideos.
  ///
  /// In en, this message translates to:
  /// **'Min videos uploaded last month'**
  String get dashboardAnalyticsFilterMinVideos;

  /// No description provided for @dashboardAnalyticsClearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear filters'**
  String get dashboardAnalyticsClearFilters;

  /// No description provided for @dashboardAnalyticsLegendLive.
  ///
  /// In en, this message translates to:
  /// **'Live'**
  String get dashboardAnalyticsLegendLive;

  /// No description provided for @dashboardAnalyticsLegendArchiveDue.
  ///
  /// In en, this message translates to:
  /// **'Archive due'**
  String get dashboardAnalyticsLegendArchiveDue;

  /// No description provided for @dashboardAnalyticsLegendArchived.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get dashboardAnalyticsLegendArchived;

  /// No description provided for @dashboardAnalyticsArchivedCount.
  ///
  /// In en, this message translates to:
  /// **'+{count} archived'**
  String dashboardAnalyticsArchivedCount(String count);

  /// No description provided for @dashboardAnalyticsArchivedValue.
  ///
  /// In en, this message translates to:
  /// **'+{value} archived'**
  String dashboardAnalyticsArchivedValue(String value);

  /// No description provided for @dashboardAnalyticsArchivedViewsNote.
  ///
  /// In en, this message translates to:
  /// **'Archived channels\' median views are taken over every stored video at archive time — a slightly wider span than the live 30-day figure.'**
  String get dashboardAnalyticsArchivedViewsNote;

  /// No description provided for @dashboardAnalyticsArchiveDueCount.
  ///
  /// In en, this message translates to:
  /// **'-{count} archive due'**
  String dashboardAnalyticsArchiveDueCount(String count);

  /// No description provided for @dashboardAnalyticsArchiveDueValue.
  ///
  /// In en, this message translates to:
  /// **'-{value} archive due'**
  String dashboardAnalyticsArchiveDueValue(String value);

  /// No description provided for @dashboardAnalyticsStatChannels.
  ///
  /// In en, this message translates to:
  /// **'Channels'**
  String get dashboardAnalyticsStatChannels;

  /// No description provided for @dashboardAnalyticsStatMedianSubs.
  ///
  /// In en, this message translates to:
  /// **'Median subscribers'**
  String get dashboardAnalyticsStatMedianSubs;

  /// No description provided for @dashboardAnalyticsStatMeanSubs.
  ///
  /// In en, this message translates to:
  /// **'Mean subscribers'**
  String get dashboardAnalyticsStatMeanSubs;

  /// No description provided for @dashboardAnalyticsStatTotalSubs.
  ///
  /// In en, this message translates to:
  /// **'Combined reach'**
  String get dashboardAnalyticsStatTotalSubs;

  /// No description provided for @dashboardAnalyticsStatFound.
  ///
  /// In en, this message translates to:
  /// **'Found channels this month'**
  String get dashboardAnalyticsStatFound;

  /// No description provided for @dashboardAnalyticsStatUploads.
  ///
  /// In en, this message translates to:
  /// **'Uploads this month'**
  String get dashboardAnalyticsStatUploads;

  /// No description provided for @dashboardAnalyticsStatAvgViews.
  ///
  /// In en, this message translates to:
  /// **'Median views (30d)'**
  String get dashboardAnalyticsStatAvgViews;

  /// No description provided for @dashboardAnalyticsStatWithDeal.
  ///
  /// In en, this message translates to:
  /// **'Have had a deal'**
  String get dashboardAnalyticsStatWithDeal;

  /// No description provided for @dashboardAnalyticsSubsCoverage.
  ///
  /// In en, this message translates to:
  /// **'{known} of {total} have a subscriber count'**
  String dashboardAnalyticsSubsCoverage(int known, int total);

  /// No description provided for @dashboardAnalyticsMeanVsMedian.
  ///
  /// In en, this message translates to:
  /// **'Subscriber counts are skewed: one large channel pulls the mean up, so the median is the one that describes a typical row.'**
  String get dashboardAnalyticsMeanVsMedian;

  /// No description provided for @dashboardAnalyticsChartTiers.
  ///
  /// In en, this message translates to:
  /// **'Subscriber distribution'**
  String get dashboardAnalyticsChartTiers;

  /// No description provided for @dashboardAnalyticsChartCountries.
  ///
  /// In en, this message translates to:
  /// **'Countries'**
  String get dashboardAnalyticsChartCountries;

  /// No description provided for @dashboardAnalyticsChartStages.
  ///
  /// In en, this message translates to:
  /// **'Pipeline stage'**
  String get dashboardAnalyticsChartStages;

  /// No description provided for @dashboardAnalyticsChartVetting.
  ///
  /// In en, this message translates to:
  /// **'Vetting'**
  String get dashboardAnalyticsChartVetting;

  /// No description provided for @dashboardAnalyticsChartTags.
  ///
  /// In en, this message translates to:
  /// **'Tags'**
  String get dashboardAnalyticsChartTags;

  /// No description provided for @dashboardAnalyticsChartDiscovered.
  ///
  /// In en, this message translates to:
  /// **'Found per month'**
  String get dashboardAnalyticsChartDiscovered;

  /// No description provided for @dashboardAnalyticsChartViewTiers.
  ///
  /// In en, this message translates to:
  /// **'Median views distribution'**
  String get dashboardAnalyticsChartViewTiers;

  /// No description provided for @dashboardAnalyticsToggleIndependent.
  ///
  /// In en, this message translates to:
  /// **'Toggle independent scale'**
  String get dashboardAnalyticsToggleIndependent;

  /// No description provided for @dashboardAnalyticsViewsNote.
  ///
  /// In en, this message translates to:
  /// **'{known} of {total} have a measured 30-day median; the rest count as 0 under <10K. Same buckets as the subscriber chart above.'**
  String dashboardAnalyticsViewsNote(int known, int total);

  /// No description provided for @dashboardAnalyticsCountriesNote.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Top 12 by channel count.} =1{Top 12 by channel count. 1 channel has no country recorded.} other{Top 12 by channel count. {count} channels have no country recorded.}}'**
  String dashboardAnalyticsCountriesNote(int count);

  /// No description provided for @dashboardAnalyticsTagsNote.
  ///
  /// In en, this message translates to:
  /// **'A channel carrying two tags is counted under both, so these add up to more than the total.'**
  String get dashboardAnalyticsTagsNote;

  /// No description provided for @dashboardAnalyticsUntagged.
  ///
  /// In en, this message translates to:
  /// **'No tag'**
  String get dashboardAnalyticsUntagged;

  /// No description provided for @dashboardAnalyticsNothingHere.
  ///
  /// In en, this message translates to:
  /// **'Nothing to draw yet.'**
  String get dashboardAnalyticsNothingHere;

  /// No description provided for @navEmailLibrary.
  ///
  /// In en, this message translates to:
  /// **'Email critique library'**
  String get navEmailLibrary;

  /// No description provided for @emailLibraryTitle.
  ///
  /// In en, this message translates to:
  /// **'Email critique library'**
  String get emailLibraryTitle;

  /// No description provided for @emailLibraryTabInfluencers.
  ///
  /// In en, this message translates to:
  /// **'Influencers'**
  String get emailLibraryTabInfluencers;

  /// No description provided for @emailLibraryTabBrands.
  ///
  /// In en, this message translates to:
  /// **'Brands'**
  String get emailLibraryTabBrands;

  /// No description provided for @emailLibraryNewRecord.
  ///
  /// In en, this message translates to:
  /// **'New email record'**
  String get emailLibraryNewRecord;

  /// No description provided for @emailLibraryNewRecordTitle.
  ///
  /// In en, this message translates to:
  /// **'New email record'**
  String get emailLibraryNewRecordTitle;

  /// No description provided for @emailLibraryEditRecordTitle.
  ///
  /// In en, this message translates to:
  /// **'Email record'**
  String get emailLibraryEditRecordTitle;

  /// No description provided for @emailLibraryManageTags.
  ///
  /// In en, this message translates to:
  /// **'Manage tags'**
  String get emailLibraryManageTags;

  /// No description provided for @emailLibrarySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search subject, body, context and critique'**
  String get emailLibrarySearchHint;

  /// No description provided for @emailLibrarySourceAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get emailLibrarySourceAll;

  /// No description provided for @emailLibrarySourceVideo.
  ///
  /// In en, this message translates to:
  /// **'From videos'**
  String get emailLibrarySourceVideo;

  /// No description provided for @emailLibrarySourceTestDraft.
  ///
  /// In en, this message translates to:
  /// **'Test drafts'**
  String get emailLibrarySourceTestDraft;

  /// No description provided for @emailLibrarySourceAppDraft.
  ///
  /// In en, this message translates to:
  /// **'My drafts'**
  String get emailLibrarySourceAppDraft;

  /// No description provided for @emailLibrarySourceMine.
  ///
  /// In en, this message translates to:
  /// **'My examples'**
  String get emailLibrarySourceMine;

  /// No description provided for @emailLibraryBadgeTestDraft.
  ///
  /// In en, this message translates to:
  /// **'Test draft'**
  String get emailLibraryBadgeTestDraft;

  /// No description provided for @emailLibraryBadgeAppDraft.
  ///
  /// In en, this message translates to:
  /// **'My draft'**
  String get emailLibraryBadgeAppDraft;

  /// No description provided for @emailLibraryBadgeMine.
  ///
  /// In en, this message translates to:
  /// **'My example'**
  String get emailLibraryBadgeMine;

  /// No description provided for @emailLibraryVerdictGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get emailLibraryVerdictGood;

  /// No description provided for @emailLibraryVerdictBad.
  ///
  /// In en, this message translates to:
  /// **'Bad'**
  String get emailLibraryVerdictBad;

  /// No description provided for @emailLibraryUnrated.
  ///
  /// In en, this message translates to:
  /// **'Not rated'**
  String get emailLibraryUnrated;

  /// No description provided for @emailLibraryFieldVerdict.
  ///
  /// In en, this message translates to:
  /// **'Verdict'**
  String get emailLibraryFieldVerdict;

  /// No description provided for @emailLibraryVerdictWhyBad.
  ///
  /// In en, this message translates to:
  /// **'Why is it bad?'**
  String get emailLibraryVerdictWhyBad;

  /// No description provided for @emailLibraryVerdictWhyGood.
  ///
  /// In en, this message translates to:
  /// **'What makes it good? (optional)'**
  String get emailLibraryVerdictWhyGood;

  /// No description provided for @emailLibraryVerdictWhyHint.
  ///
  /// In en, this message translates to:
  /// **'Good drafts become cases later skill versions must still pass. A bad one is drafted again with your reason, to check the fault is gone.'**
  String get emailLibraryVerdictWhyHint;

  /// No description provided for @emailLibraryVerdictWhyRequired.
  ///
  /// In en, this message translates to:
  /// **'Say what\'s wrong, so the next run knows what to look for.'**
  String get emailLibraryVerdictWhyRequired;

  /// No description provided for @emailLibraryBenchImported.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 test draft} other{{count} test drafts}} imported from the last bench run.'**
  String emailLibraryBenchImported(int count);

  /// No description provided for @emailLibraryMyExample.
  ///
  /// In en, this message translates to:
  /// **'My example'**
  String get emailLibraryMyExample;

  /// No description provided for @emailLibraryMyExampleHint.
  ///
  /// In en, this message translates to:
  /// **'One of your own emails that worked. The skill factory reads it as an example, never as wording to copy.'**
  String get emailLibraryMyExampleHint;

  /// No description provided for @emailLibraryKnobs.
  ///
  /// In en, this message translates to:
  /// **'Written for: {knobs}'**
  String emailLibraryKnobs(String knobs);

  /// No description provided for @emailLibraryClearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear filters'**
  String get emailLibraryClearFilters;

  /// No description provided for @emailLibrarySortLastEdited.
  ///
  /// In en, this message translates to:
  /// **'Last edited'**
  String get emailLibrarySortLastEdited;

  /// No description provided for @emailLibrarySortLastCreated.
  ///
  /// In en, this message translates to:
  /// **'Last created'**
  String get emailLibrarySortLastCreated;

  /// No description provided for @emailLibrarySortVideoDate.
  ///
  /// In en, this message translates to:
  /// **'Video date'**
  String get emailLibrarySortVideoDate;

  /// No description provided for @emailLibraryEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet. Add the first email and what the expert said about it.'**
  String get emailLibraryEmpty;

  /// No description provided for @emailLibraryNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No records match this filter.'**
  String get emailLibraryNoMatches;

  /// No description provided for @emailLibraryLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read the local library.'**
  String get emailLibraryLoadFailed;

  /// No description provided for @emailLibraryUnavailable.
  ///
  /// In en, this message translates to:
  /// **'There is no local email critique library on this machine.'**
  String get emailLibraryUnavailable;

  /// No description provided for @emailLibraryUnavailableDetail.
  ///
  /// In en, this message translates to:
  /// **'The library is a single file, data/database/email_library.db, next to the pipeline\'s own database. It is only available in the installed desktop app. If you are on desktop and still see this, check Settings -> Search Tuning -> Project root.'**
  String get emailLibraryUnavailableDetail;

  /// No description provided for @emailLibraryFieldVideoDate.
  ///
  /// In en, this message translates to:
  /// **'Video date'**
  String get emailLibraryFieldVideoDate;

  /// No description provided for @emailLibraryNoDate.
  ///
  /// In en, this message translates to:
  /// **'No date'**
  String get emailLibraryNoDate;

  /// No description provided for @emailLibraryVideoDateDay.
  ///
  /// In en, this message translates to:
  /// **'Day'**
  String get emailLibraryVideoDateDay;

  /// No description provided for @emailLibraryVideoDateMonth.
  ///
  /// In en, this message translates to:
  /// **'Month'**
  String get emailLibraryVideoDateMonth;

  /// No description provided for @emailLibraryVideoDateYear.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get emailLibraryVideoDateYear;

  /// No description provided for @emailLibraryFieldVideoUrl.
  ///
  /// In en, this message translates to:
  /// **'Video URL'**
  String get emailLibraryFieldVideoUrl;

  /// No description provided for @emailLibraryVideoUrlHint.
  ///
  /// In en, this message translates to:
  /// **'Link to the training video'**
  String get emailLibraryVideoUrlHint;

  /// No description provided for @emailLibraryFieldTimecode.
  ///
  /// In en, this message translates to:
  /// **'Timecode'**
  String get emailLibraryFieldTimecode;

  /// No description provided for @emailLibraryTimecodeHint.
  ///
  /// In en, this message translates to:
  /// **'1:05:30'**
  String get emailLibraryTimecodeHint;

  /// No description provided for @emailLibraryTimecodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use h:mm:ss, m:ss, or plain seconds.'**
  String get emailLibraryTimecodeInvalid;

  /// No description provided for @emailLibraryTimecodeHours.
  ///
  /// In en, this message translates to:
  /// **'Hours'**
  String get emailLibraryTimecodeHours;

  /// No description provided for @emailLibraryTimecodeMinutes.
  ///
  /// In en, this message translates to:
  /// **'Minutes'**
  String get emailLibraryTimecodeMinutes;

  /// No description provided for @emailLibraryTimecodeSeconds.
  ///
  /// In en, this message translates to:
  /// **'Seconds'**
  String get emailLibraryTimecodeSeconds;

  /// No description provided for @emailLibraryTimecodeScrollHint.
  ///
  /// In en, this message translates to:
  /// **'Scroll or use the arrow keys over a box to change it.'**
  String get emailLibraryTimecodeScrollHint;

  /// No description provided for @emailLibraryOpenAtTimecode.
  ///
  /// In en, this message translates to:
  /// **'Open the video at this point'**
  String get emailLibraryOpenAtTimecode;

  /// No description provided for @emailLibraryOpenVideo.
  ///
  /// In en, this message translates to:
  /// **'Open the source video'**
  String get emailLibraryOpenVideo;

  /// No description provided for @emailLibraryOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open that link.'**
  String get emailLibraryOpenFailed;

  /// No description provided for @emailLibraryFieldStage.
  ///
  /// In en, this message translates to:
  /// **'Stage'**
  String get emailLibraryFieldStage;

  /// No description provided for @emailLibraryFieldNiche.
  ///
  /// In en, this message translates to:
  /// **'Niches'**
  String get emailLibraryFieldNiche;

  /// No description provided for @emailLibraryNicheSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search niches'**
  String get emailLibraryNicheSearchHint;

  /// No description provided for @emailLibraryNoNicheTags.
  ///
  /// In en, this message translates to:
  /// **'No tags yet. Use + to add one.'**
  String get emailLibraryNoNicheTags;

  /// No description provided for @emailLibraryFieldContext.
  ///
  /// In en, this message translates to:
  /// **'Context'**
  String get emailLibraryFieldContext;

  /// No description provided for @emailLibraryContextHint.
  ///
  /// In en, this message translates to:
  /// **'Who it was written to, and what had happened before it'**
  String get emailLibraryContextHint;

  /// No description provided for @emailLibraryFieldSubject.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get emailLibraryFieldSubject;

  /// No description provided for @emailLibraryFieldBody.
  ///
  /// In en, this message translates to:
  /// **'Email body'**
  String get emailLibraryFieldBody;

  /// No description provided for @emailLibraryBodyHint.
  ///
  /// In en, this message translates to:
  /// **'Paste the email exactly as it was written'**
  String get emailLibraryBodyHint;

  /// No description provided for @emailLibraryFieldCritique.
  ///
  /// In en, this message translates to:
  /// **'Expert critique'**
  String get emailLibraryFieldCritique;

  /// No description provided for @emailLibraryCritiqueHint.
  ///
  /// In en, this message translates to:
  /// **'What the expert said about it, and why'**
  String get emailLibraryCritiqueHint;

  /// No description provided for @emailLibraryAddTag.
  ///
  /// In en, this message translates to:
  /// **'Add tag'**
  String get emailLibraryAddTag;

  /// No description provided for @emailLibraryAddStageTag.
  ///
  /// In en, this message translates to:
  /// **'New stage tag'**
  String get emailLibraryAddStageTag;

  /// No description provided for @emailLibraryAddNicheTag.
  ///
  /// In en, this message translates to:
  /// **'New niche tag'**
  String get emailLibraryAddNicheTag;

  /// No description provided for @emailLibraryTagLabel.
  ///
  /// In en, this message translates to:
  /// **'Label'**
  String get emailLibraryTagLabel;

  /// No description provided for @emailLibraryTagLabelHelp.
  ///
  /// In en, this message translates to:
  /// **'An existing tag with this name is reused.'**
  String get emailLibraryTagLabelHelp;

  /// No description provided for @emailLibraryQuotedToContext.
  ///
  /// In en, this message translates to:
  /// **'Added to the context note.'**
  String get emailLibraryQuotedToContext;

  /// No description provided for @emailLibraryAddKeyword.
  ///
  /// In en, this message translates to:
  /// **'Add a keyword'**
  String get emailLibraryAddKeyword;

  /// The + row in the @-mention menu, naming the keyword it would add.
  ///
  /// In en, this message translates to:
  /// **'Add \"@{keyword}\"'**
  String emailLibraryAddKeywordNamed(String keyword);

  /// No description provided for @emailLibraryAddPlaceholderTag.
  ///
  /// In en, this message translates to:
  /// **'New keyword'**
  String get emailLibraryAddPlaceholderTag;

  /// No description provided for @emailLibraryPlaceholderHelp.
  ///
  /// In en, this message translates to:
  /// **'One word. Spaces become underscores, so it can be typed back as @word.'**
  String get emailLibraryPlaceholderHelp;

  /// No description provided for @emailLibrarySaveAndAnother.
  ///
  /// In en, this message translates to:
  /// **'Save & add another'**
  String get emailLibrarySaveAndAnother;

  /// No description provided for @emailLibrarySaved.
  ///
  /// In en, this message translates to:
  /// **'Saved.'**
  String get emailLibrarySaved;

  /// No description provided for @emailLibrarySaveFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not save to the local library.'**
  String get emailLibrarySaveFailed;

  /// No description provided for @emailLibraryNothingToSave.
  ///
  /// In en, this message translates to:
  /// **'Nothing typed yet.'**
  String get emailLibraryNothingToSave;

  /// No description provided for @emailLibraryDiscardTitle.
  ///
  /// In en, this message translates to:
  /// **'Discard this record?'**
  String get emailLibraryDiscardTitle;

  /// No description provided for @emailLibraryDiscardBody.
  ///
  /// In en, this message translates to:
  /// **'What is typed here has not been saved.'**
  String get emailLibraryDiscardBody;

  /// No description provided for @emailLibraryDiscard.
  ///
  /// In en, this message translates to:
  /// **'Discard'**
  String get emailLibraryDiscard;

  /// No description provided for @emailLibraryDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this record?'**
  String get emailLibraryDeleteTitle;

  /// No description provided for @emailLibraryDeleteBody.
  ///
  /// In en, this message translates to:
  /// **'The email and its critique are removed from the local library. This cannot be undone.'**
  String get emailLibraryDeleteBody;

  /// No description provided for @emailLibraryNoSubject.
  ///
  /// In en, this message translates to:
  /// **'No subject'**
  String get emailLibraryNoSubject;

  /// No description provided for @emailLibraryRenameTag.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get emailLibraryRenameTag;

  /// How many email records carry a tag, in the manage-tags sheet.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{On no records} =1{On 1 record} other{On {count} records}}'**
  String emailLibraryTagUsage(int count);

  /// No description provided for @emailLibraryDeleteTagTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete \"{label}\"?'**
  String emailLibraryDeleteTagTitle(String label);

  /// No description provided for @emailLibraryDeleteTagBody.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No records use this tag.} =1{It is removed from 1 record as well.} other{It is removed from {count} records as well.}}'**
  String emailLibraryDeleteTagBody(int count);

  /// No description provided for @logsActionReplyReceived.
  ///
  /// In en, this message translates to:
  /// **'Reply received'**
  String get logsActionReplyReceived;

  /// No description provided for @outreachSendWithGmail.
  ///
  /// In en, this message translates to:
  /// **'Send with Gmail'**
  String get outreachSendWithGmail;

  /// No description provided for @outreachSendingWithGmail.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get outreachSendingWithGmail;

  /// No description provided for @outreachGmailSentAs.
  ///
  /// In en, this message translates to:
  /// **'Sent from {account}.'**
  String outreachGmailSentAs(String account);

  /// No description provided for @outreachGmailSentWithFollowUps.
  ///
  /// In en, this message translates to:
  /// **'Sent from {account}. {count, plural, =1{1 follow-up is queued} other{{count} follow-ups are queued}} — cancelled the moment they reply.'**
  String outreachGmailSentWithFollowUps(String account, int count);

  /// No description provided for @outreachGmailSendFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t send: {reason}'**
  String outreachGmailSendFailed(String reason);

  /// No description provided for @outreachGmailNotEmail.
  ///
  /// In en, this message translates to:
  /// **'The mailbox sends email. Use the copy and open actions for {method}.'**
  String outreachGmailNotEmail(String method);

  /// No description provided for @outreachGmailNotConnected.
  ///
  /// In en, this message translates to:
  /// **'No outreach mailbox is connected on this machine.'**
  String get outreachGmailNotConnected;

  /// No description provided for @outreachGmailConnectAction.
  ///
  /// In en, this message translates to:
  /// **'Connect one'**
  String get outreachGmailConnectAction;

  /// No description provided for @outreachGmailReconnectAction.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get outreachGmailReconnectAction;

  /// No description provided for @outreachGmailSendUnavailableHint.
  ///
  /// In en, this message translates to:
  /// **'Connect a mailbox in Settings to send from inside the app. Until then, the mail-app hand-off still works.'**
  String get outreachGmailSendUnavailableHint;

  /// No description provided for @outreachFollowUpBodyLabel.
  ///
  /// In en, this message translates to:
  /// **'Follow-up message'**
  String get outreachFollowUpBodyLabel;

  /// No description provided for @outreachCheckReplies.
  ///
  /// In en, this message translates to:
  /// **'Check for replies'**
  String get outreachCheckReplies;

  /// No description provided for @outreachCheckingReplies.
  ///
  /// In en, this message translates to:
  /// **'Checking the mailbox…'**
  String get outreachCheckingReplies;

  /// No description provided for @outreachNoNewReplies.
  ///
  /// In en, this message translates to:
  /// **'No new replies.'**
  String get outreachNoNewReplies;

  /// No description provided for @outreachRepliesApplied.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 new reply} other{{count} new replies}} recorded.'**
  String outreachRepliesApplied(int count);

  /// No description provided for @outreachRepliesAppliedWithCancels.
  ///
  /// In en, this message translates to:
  /// **'{replies, plural, =1{1 new reply} other{{replies} new replies}} recorded, {cancelled, plural, =1{1 queued follow-up cancelled} other{{cancelled} queued follow-ups cancelled}}.'**
  String outreachRepliesAppliedWithCancels(int replies, int cancelled);

  /// No description provided for @outreachFollowUpsSentNote.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 follow-up went out} other{{count} follow-ups went out}}.'**
  String outreachFollowUpsSentNote(int count);

  /// No description provided for @outreachMarkedInterested.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 channel moved to Interested} other{{count} channels moved to Interested}}.'**
  String outreachMarkedInterested(int count);

  /// No description provided for @outreachSweepFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t check the mailbox: {reason}'**
  String outreachSweepFailed(String reason);

  /// No description provided for @outreachQueuedFollowUps.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No follow-ups queued} =1{1 follow-up queued} other{{count} follow-ups queued}}'**
  String outreachQueuedFollowUps(int count);

  /// No description provided for @outreachCancelFollowUps.
  ///
  /// In en, this message translates to:
  /// **'Cancel the queued follow-ups'**
  String get outreachCancelFollowUps;

  /// No description provided for @outreachFollowUpsCancelled.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing was queued} =1{1 follow-up cancelled} other{{count} follow-ups cancelled}}.'**
  String outreachFollowUpsCancelled(int count);

  /// No description provided for @settingsMailboxTitle.
  ///
  /// In en, this message translates to:
  /// **'Outreach mailbox'**
  String get settingsMailboxTitle;

  /// No description provided for @settingsMailboxSubtitle.
  ///
  /// In en, this message translates to:
  /// **'The Gmail account outreach is sent from, and the follow-ups waiting behind it. Set up per machine — whoever runs the pipeline sends the mail.'**
  String get settingsMailboxSubtitle;

  /// No description provided for @settingsMailboxConnectedAs.
  ///
  /// In en, this message translates to:
  /// **'Connected as {account}'**
  String settingsMailboxConnectedAs(String account);

  /// No description provided for @settingsMailboxNotConnected.
  ///
  /// In en, this message translates to:
  /// **'No mailbox connected'**
  String get settingsMailboxNotConnected;

  /// No description provided for @settingsMailboxLabelledAs.
  ///
  /// In en, this message translates to:
  /// **'Sent mail is labelled “{label}”'**
  String settingsMailboxLabelledAs(String label);

  /// No description provided for @settingsMailboxConnectHint.
  ///
  /// In en, this message translates to:
  /// **'Connect the Gmail account outreach is sent from. A browser window opens for you to sign in as that address.'**
  String get settingsMailboxConnectHint;

  /// No description provided for @settingsMailboxSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get settingsMailboxSignIn;

  /// No description provided for @settingsMailboxAddAnother.
  ///
  /// In en, this message translates to:
  /// **'Add another mailbox'**
  String get settingsMailboxAddAnother;

  /// No description provided for @settingsMailboxConnecting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for browser…'**
  String get settingsMailboxConnecting;

  /// No description provided for @settingsMailboxConnectingHint.
  ///
  /// In en, this message translates to:
  /// **'Finish signing in in the browser window that just opened.'**
  String get settingsMailboxConnectingHint;

  /// No description provided for @settingsMailboxConnected.
  ///
  /// In en, this message translates to:
  /// **'Mailbox connected.'**
  String get settingsMailboxConnected;

  /// No description provided for @settingsMailboxSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get settingsMailboxSignOut;

  /// No description provided for @settingsMailboxSignedOut.
  ///
  /// In en, this message translates to:
  /// **'Mailbox signed out on this machine.'**
  String get settingsMailboxSignedOut;

  /// No description provided for @settingsMailboxSignedOutOf.
  ///
  /// In en, this message translates to:
  /// **'Signed out of {account}.'**
  String settingsMailboxSignedOutOf(String account);

  /// No description provided for @settingsMailboxSignOutTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign out of this mailbox?'**
  String get settingsMailboxSignOutTitle;

  /// No description provided for @settingsMailboxSignOutBody.
  ///
  /// In en, this message translates to:
  /// **'This machine stops sending outreach and following up until a mailbox is connected again. The Google account keeps its access until you revoke it at myaccount.google.com/permissions.'**
  String get settingsMailboxSignOutBody;

  /// No description provided for @settingsMailboxSignOutTitleFor.
  ///
  /// In en, this message translates to:
  /// **'Sign out of {account}?'**
  String settingsMailboxSignOutTitleFor(String account);

  /// No description provided for @settingsMailboxSignOutBodyFor.
  ///
  /// In en, this message translates to:
  /// **'This machine stops sending outreach as {account} and following up on its conversations until it is connected again. The Google account keeps its access until you revoke it at myaccount.google.com/permissions.'**
  String settingsMailboxSignOutBodyFor(String account);

  /// No description provided for @settingsMailboxTokenExpiryNote.
  ///
  /// In en, this message translates to:
  /// **'While the Google app is in Testing mode the connection lapses after seven days — sign in again to renew it.'**
  String get settingsMailboxTokenExpiryNote;

  /// No description provided for @settingsMailboxRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get settingsMailboxRefresh;

  /// No description provided for @settingsMailboxTestSend.
  ///
  /// In en, this message translates to:
  /// **'Send a test email'**
  String get settingsMailboxTestSend;

  /// No description provided for @settingsMailboxTestSent.
  ///
  /// In en, this message translates to:
  /// **'Test message sent to {to}.'**
  String settingsMailboxTestSent(String to);

  /// No description provided for @settingsMailboxCountersSent.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 message sent} other{{count} messages sent}}'**
  String settingsMailboxCountersSent(int count);

  /// No description provided for @settingsMailboxCountersAwaiting.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 awaiting a reply} other{{count} awaiting a reply}}'**
  String settingsMailboxCountersAwaiting(int count);

  /// No description provided for @settingsMailboxCountersQueued.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 follow-up queued} other{{count} follow-ups queued}}'**
  String settingsMailboxCountersQueued(int count);

  /// No description provided for @settingsMailboxFailedSteps.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 follow-up gave up after repeated failures} other{{count} follow-ups gave up after repeated failures}}'**
  String settingsMailboxFailedSteps(int count);

  /// No description provided for @settingsMailboxDesktopOnly.
  ///
  /// In en, this message translates to:
  /// **'Sending is done by the installed desktop app on the machine that runs the pipeline.'**
  String get settingsMailboxDesktopOnly;

  /// No description provided for @settingsMailboxAccountsRowTitle.
  ///
  /// In en, this message translates to:
  /// **'Signed in'**
  String get settingsMailboxAccountsRowTitle;

  /// No description provided for @settingsMailboxCapLine.
  ///
  /// In en, this message translates to:
  /// **'{cap} cold emails a day · {left} left today'**
  String settingsMailboxCapLine(int cap, int left);

  /// No description provided for @settingsMailboxWarmupWarming.
  ///
  /// In en, this message translates to:
  /// **'Warming up: day {days} of at least 14'**
  String settingsMailboxWarmupWarming(int days);

  /// No description provided for @settingsMailboxWarmupDone.
  ///
  /// In en, this message translates to:
  /// **'Warmed up {days} days'**
  String settingsMailboxWarmupDone(int days);

  /// No description provided for @settingsMailboxWarmupNotSet.
  ///
  /// In en, this message translates to:
  /// **'Warm-up start not set'**
  String get settingsMailboxWarmupNotSet;

  /// No description provided for @settingsMailboxEditLimits.
  ///
  /// In en, this message translates to:
  /// **'Daily cap and warm-up'**
  String get settingsMailboxEditLimits;

  /// No description provided for @settingsMailboxLimitsTitle.
  ///
  /// In en, this message translates to:
  /// **'Daily cap and warm-up for {account}'**
  String settingsMailboxLimitsTitle(String account);

  /// No description provided for @settingsMailboxCapLabel.
  ///
  /// In en, this message translates to:
  /// **'Cold emails a day: {cap}'**
  String settingsMailboxCapLabel(int cap);

  /// No description provided for @settingsMailboxCapHelp.
  ///
  /// In en, this message translates to:
  /// **'35 is the house default; anywhere from 10 to 50. Replies to people who wrote back never count.'**
  String get settingsMailboxCapHelp;

  /// No description provided for @settingsMailboxWarmupLabel.
  ///
  /// In en, this message translates to:
  /// **'Warm-up started on'**
  String get settingsMailboxWarmupLabel;

  /// No description provided for @settingsMailboxWarmupHelp.
  ///
  /// In en, this message translates to:
  /// **'The warm-up itself runs in Instantly. 14 days is the minimum before cold email; 30 to 90 is better.'**
  String get settingsMailboxWarmupHelp;

  /// No description provided for @settingsMailboxWarmupPick.
  ///
  /// In en, this message translates to:
  /// **'Pick a date'**
  String get settingsMailboxWarmupPick;

  /// No description provided for @settingsMailboxWarmupClear.
  ///
  /// In en, this message translates to:
  /// **'Clear date'**
  String get settingsMailboxWarmupClear;

  /// No description provided for @settingsMailboxLimitsSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved. The next send uses the new limits.'**
  String get settingsMailboxLimitsSaved;

  /// No description provided for @settingsAgencyTitle.
  ///
  /// In en, this message translates to:
  /// **'Agency facts'**
  String get settingsAgencyTitle;

  /// No description provided for @settingsAgencySubtitle.
  ///
  /// In en, this message translates to:
  /// **'What the drafting engine may say about the agency, who it refuses to work with, and the team\'s daily target. Shared with the whole team.'**
  String get settingsAgencySubtitle;

  /// No description provided for @settingsAgencyName.
  ///
  /// In en, this message translates to:
  /// **'Agency name'**
  String get settingsAgencyName;

  /// No description provided for @settingsAgencySender.
  ///
  /// In en, this message translates to:
  /// **'Who signs the emails'**
  String get settingsAgencySender;

  /// No description provided for @settingsAgencyWhatWeDo.
  ///
  /// In en, this message translates to:
  /// **'What we do'**
  String get settingsAgencyWhatWeDo;

  /// No description provided for @settingsAgencyWebsite.
  ///
  /// In en, this message translates to:
  /// **'Website'**
  String get settingsAgencyWebsite;

  /// No description provided for @settingsAgencyTrueClaims.
  ///
  /// In en, this message translates to:
  /// **'True claims'**
  String get settingsAgencyTrueClaims;

  /// No description provided for @settingsAgencyTrueClaimsHelp.
  ///
  /// In en, this message translates to:
  /// **'One fact per line. The engine only claims what is here, in its own words, and only when it answers something.'**
  String get settingsAgencyTrueClaimsHelp;

  /// No description provided for @settingsAgencyPastCampaigns.
  ///
  /// In en, this message translates to:
  /// **'Past campaigns'**
  String get settingsAgencyPastCampaigns;

  /// No description provided for @settingsAgencyPastCampaignsHelp.
  ///
  /// In en, this message translates to:
  /// **'One per line, for example the brand and the creator.'**
  String get settingsAgencyPastCampaignsHelp;

  /// No description provided for @settingsAgencyIncubator.
  ///
  /// In en, this message translates to:
  /// **'We are part of a group of experienced agency owners who review our work'**
  String get settingsAgencyIncubator;

  /// No description provided for @settingsAgencyIncubatorHelp.
  ///
  /// In en, this message translates to:
  /// **'Only if it is true. The engine uses it only as a last resort.'**
  String get settingsAgencyIncubatorHelp;

  /// No description provided for @settingsAgencyBoycottSection.
  ///
  /// In en, this message translates to:
  /// **'Boycott'**
  String get settingsAgencyBoycottSection;

  /// No description provided for @settingsAgencyBoycottCountries.
  ///
  /// In en, this message translates to:
  /// **'Boycotted countries'**
  String get settingsAgencyBoycottCountries;

  /// No description provided for @settingsAgencyBoycottCountriesHelp.
  ///
  /// In en, this message translates to:
  /// **'Two-letter country codes, separated by commas. A brand from one of these gets no pitch and no creator.'**
  String get settingsAgencyBoycottCountriesHelp;

  /// No description provided for @settingsAgencyBoycottBrands.
  ///
  /// In en, this message translates to:
  /// **'Boycotted brands'**
  String get settingsAgencyBoycottBrands;

  /// No description provided for @settingsAgencyBoycottBrandsHelp.
  ///
  /// In en, this message translates to:
  /// **'One brand per line, including brands that support the occupation of Palestine.'**
  String get settingsAgencyBoycottBrandsHelp;

  /// No description provided for @settingsAgencyCountryInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use two-letter country codes, like IL.'**
  String get settingsAgencyCountryInvalid;

  /// No description provided for @settingsAgencyDailyTarget.
  ///
  /// In en, this message translates to:
  /// **'Good emails a day (team target)'**
  String get settingsAgencyDailyTarget;

  /// No description provided for @settingsAgencyDailyTargetInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number from 1 to 500.'**
  String get settingsAgencyDailyTargetInvalid;

  /// No description provided for @settingsAgencySaved.
  ///
  /// In en, this message translates to:
  /// **'Agency facts saved for the team.'**
  String get settingsAgencySaved;

  /// No description provided for @creatorPrescreenTitle.
  ///
  /// In en, this message translates to:
  /// **'Pre-screen'**
  String get creatorPrescreenTitle;

  /// No description provided for @creatorPrescreenViewsMet.
  ///
  /// In en, this message translates to:
  /// **'{views} median views in 30 days, meets the ~50K bar'**
  String creatorPrescreenViewsMet(String views);

  /// No description provided for @creatorPrescreenViewsBelow.
  ///
  /// In en, this message translates to:
  /// **'{views} median views in 30 days, under the ~50K bar'**
  String creatorPrescreenViewsBelow(String views);

  /// No description provided for @creatorPrescreenViewsUnknown.
  ///
  /// In en, this message translates to:
  /// **'Views not measured yet'**
  String get creatorPrescreenViewsUnknown;

  /// No description provided for @creatorPrescreenUploads.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No uploads in the last 30 days} =1{1 upload in the last 30 days} other{{count} uploads in the last 30 days}}'**
  String creatorPrescreenUploads(int count);

  /// No description provided for @creatorPrescreenSponsored.
  ///
  /// In en, this message translates to:
  /// **'Sponsorship disclosures in {percent}% of the stored videos'**
  String creatorPrescreenSponsored(int percent);

  /// No description provided for @creatorPrescreenNotSponsored.
  ///
  /// In en, this message translates to:
  /// **'No sponsorship disclosures in the stored videos'**
  String get creatorPrescreenNotSponsored;

  /// No description provided for @creatorPrescreenSponsorUnknown.
  ///
  /// In en, this message translates to:
  /// **'Videos not read for sponsorships yet'**
  String get creatorPrescreenSponsorUnknown;

  /// No description provided for @creatorPrescreenBrands.
  ///
  /// In en, this message translates to:
  /// **'Seen with: {brands}'**
  String creatorPrescreenBrands(String brands);

  /// No description provided for @creatorPrescreenCountry.
  ///
  /// In en, this message translates to:
  /// **'Country: {country}'**
  String creatorPrescreenCountry(String country);

  /// No description provided for @creatorPrescreenCountryUnknown.
  ///
  /// In en, this message translates to:
  /// **'Country not listed'**
  String get creatorPrescreenCountryUnknown;

  /// No description provided for @creatorPrescreenAgent.
  ///
  /// In en, this message translates to:
  /// **'Has an agent: take the discount path, buy below their ask and sell at it.'**
  String get creatorPrescreenAgent;

  /// No description provided for @creatorGoldMine.
  ///
  /// In en, this message translates to:
  /// **'Gold mine'**
  String get creatorGoldMine;

  /// No description provided for @creatorGoldMineHelp.
  ///
  /// In en, this message translates to:
  /// **'No agent, and strong views or engagement for their size. Start with discounted deals; after 2-3 deals that prove we deliver, a person may propose exclusive management at 20-40% (about 25% to start).'**
  String get creatorGoldMineHelp;

  /// No description provided for @creatorFlagLabel.
  ///
  /// In en, this message translates to:
  /// **'Creator'**
  String get creatorFlagLabel;

  /// No description provided for @creatorFlagNotRecorded.
  ///
  /// In en, this message translates to:
  /// **'Not recorded'**
  String get creatorFlagNotRecorded;

  /// No description provided for @creatorFlagMale.
  ///
  /// In en, this message translates to:
  /// **'Male'**
  String get creatorFlagMale;

  /// No description provided for @creatorFlagFemale.
  ///
  /// In en, this message translates to:
  /// **'Female'**
  String get creatorFlagFemale;

  /// No description provided for @creatorFlagCouple.
  ///
  /// In en, this message translates to:
  /// **'Couple'**
  String get creatorFlagCouple;

  /// No description provided for @creatorFlagUnknown.
  ///
  /// In en, this message translates to:
  /// **'Can\'t tell'**
  String get creatorFlagUnknown;

  /// No description provided for @creatorFlagOutOfScope.
  ///
  /// In en, this message translates to:
  /// **'Out of scope: the agency does not contact or pitch female creators or couple channels.'**
  String get creatorFlagOutOfScope;

  /// No description provided for @creatorFlagSaved.
  ///
  /// In en, this message translates to:
  /// **'Creator flag saved.'**
  String get creatorFlagSaved;

  /// No description provided for @mediaKitTitle.
  ///
  /// In en, this message translates to:
  /// **'Media kit'**
  String get mediaKitTitle;

  /// No description provided for @mediaKitEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit media kit'**
  String get mediaKitEdit;

  /// No description provided for @mediaKitEmpty.
  ///
  /// In en, this message translates to:
  /// **'No media kit yet. Ask the creator for their audience analytics (top countries, age) and their rates.'**
  String get mediaKitEmpty;

  /// No description provided for @mediaKitReady.
  ///
  /// In en, this message translates to:
  /// **'Ready to pitch'**
  String get mediaKitReady;

  /// No description provided for @mediaKitNotReady.
  ///
  /// In en, this message translates to:
  /// **'Not ready to pitch yet'**
  String get mediaKitNotReady;

  /// No description provided for @mediaKitAudienceShare.
  ///
  /// In en, this message translates to:
  /// **'{share}% of the audience in the US, UK and Canada'**
  String mediaKitAudienceShare(String share);

  /// No description provided for @mediaKitGapAnalytics.
  ///
  /// In en, this message translates to:
  /// **'Missing: audience analytics (top countries and age band)'**
  String get mediaKitGapAnalytics;

  /// No description provided for @mediaKitGapRate.
  ///
  /// In en, this message translates to:
  /// **'Missing: a rate agreed with the creator'**
  String get mediaKitGapRate;

  /// No description provided for @mediaKitGapAudience.
  ///
  /// In en, this message translates to:
  /// **'Under 20% of the audience in the US, UK and Canada, too little even in tech'**
  String get mediaKitGapAudience;

  /// No description provided for @mediaKitGapOutOfScope.
  ///
  /// In en, this message translates to:
  /// **'Out of scope: female or couple channel'**
  String get mediaKitGapOutOfScope;

  /// No description provided for @mediaKitCountriesLine.
  ///
  /// In en, this message translates to:
  /// **'Top countries: {countries}'**
  String mediaKitCountriesLine(String countries);

  /// No description provided for @mediaKitAgeLine.
  ///
  /// In en, this message translates to:
  /// **'Main age band: {age}'**
  String mediaKitAgeLine(String age);

  /// No description provided for @mediaKitEngagementLine.
  ///
  /// In en, this message translates to:
  /// **'Engagement: {rate}%'**
  String mediaKitEngagementLine(String rate);

  /// No description provided for @mediaKitLinkLine.
  ///
  /// In en, this message translates to:
  /// **'Kit: {link}'**
  String mediaKitLinkLine(String link);

  /// No description provided for @mediaKitRateAgreed.
  ///
  /// In en, this message translates to:
  /// **'{format}: {price}, agreed'**
  String mediaKitRateAgreed(String format, String price);

  /// No description provided for @mediaKitRateAsking.
  ///
  /// In en, this message translates to:
  /// **'{format}: {price}, asking'**
  String mediaKitRateAsking(String format, String price);

  /// No description provided for @mediaKitCountriesLabel.
  ///
  /// In en, this message translates to:
  /// **'Top countries'**
  String get mediaKitCountriesLabel;

  /// No description provided for @mediaKitCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Country code'**
  String get mediaKitCountryCode;

  /// No description provided for @mediaKitShare.
  ///
  /// In en, this message translates to:
  /// **'Share (%)'**
  String get mediaKitShare;

  /// No description provided for @mediaKitAddCountry.
  ///
  /// In en, this message translates to:
  /// **'Add a country'**
  String get mediaKitAddCountry;

  /// No description provided for @mediaKitAgeBand.
  ///
  /// In en, this message translates to:
  /// **'Main age band'**
  String get mediaKitAgeBand;

  /// No description provided for @mediaKitAgeBandHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 18-34'**
  String get mediaKitAgeBandHint;

  /// No description provided for @mediaKitEngagement.
  ///
  /// In en, this message translates to:
  /// **'Engagement (%)'**
  String get mediaKitEngagement;

  /// No description provided for @mediaKitLink.
  ///
  /// In en, this message translates to:
  /// **'Media kit link'**
  String get mediaKitLink;

  /// No description provided for @mediaKitRatesLabel.
  ///
  /// In en, this message translates to:
  /// **'Rate card (USD)'**
  String get mediaKitRatesLabel;

  /// No description provided for @mediaKitFormat.
  ///
  /// In en, this message translates to:
  /// **'Format'**
  String get mediaKitFormat;

  /// No description provided for @mediaKitPrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get mediaKitPrice;

  /// No description provided for @mediaKitAgreed.
  ///
  /// In en, this message translates to:
  /// **'Agreed with the creator'**
  String get mediaKitAgreed;

  /// No description provided for @mediaKitAddRate.
  ///
  /// In en, this message translates to:
  /// **'Add a rate'**
  String get mediaKitAddRate;

  /// No description provided for @mediaKitRemoveRow.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get mediaKitRemoveRow;

  /// No description provided for @mediaKitInvalidCode.
  ///
  /// In en, this message translates to:
  /// **'Two letters'**
  String get mediaKitInvalidCode;

  /// No description provided for @mediaKitInvalidNumber.
  ///
  /// In en, this message translates to:
  /// **'A number'**
  String get mediaKitInvalidNumber;

  /// No description provided for @mediaKitSaved.
  ///
  /// In en, this message translates to:
  /// **'Media kit saved.'**
  String get mediaKitSaved;

  /// No description provided for @influencerFilterShowOnly.
  ///
  /// In en, this message translates to:
  /// **'Show only'**
  String get influencerFilterShowOnly;

  /// No description provided for @influencerFilterHasEmail.
  ///
  /// In en, this message translates to:
  /// **'Has an email'**
  String get influencerFilterHasEmail;

  /// No description provided for @influencerFilterSponsored.
  ///
  /// In en, this message translates to:
  /// **'Sponsored before'**
  String get influencerFilterSponsored;

  /// No description provided for @influencerFilterShortlisted.
  ///
  /// In en, this message translates to:
  /// **'Shortlisted'**
  String get influencerFilterShortlisted;

  /// No description provided for @influencerFilterReadyToPitch.
  ///
  /// In en, this message translates to:
  /// **'Ready to pitch'**
  String get influencerFilterReadyToPitch;

  /// No description provided for @influencerFilterNeverContacted.
  ///
  /// In en, this message translates to:
  /// **'Never contacted'**
  String get influencerFilterNeverContacted;

  /// No description provided for @influencerContextMenuShortlist.
  ///
  /// In en, this message translates to:
  /// **'Shortlist'**
  String get influencerContextMenuShortlist;

  /// No description provided for @influencerContextMenuUnshortlist.
  ///
  /// In en, this message translates to:
  /// **'Remove from shortlist'**
  String get influencerContextMenuUnshortlist;

  /// No description provided for @influencerContextMenuAddToCampaign.
  ///
  /// In en, this message translates to:
  /// **'Add to campaign'**
  String get influencerContextMenuAddToCampaign;

  /// No description provided for @influencerContextMenuNoCampaigns.
  ///
  /// In en, this message translates to:
  /// **'No active campaign to add to. Create one from a brand first.'**
  String get influencerContextMenuNoCampaigns;

  /// No description provided for @influencerContextMenuAddedToCampaign.
  ///
  /// In en, this message translates to:
  /// **'Added to {campaign}.'**
  String influencerContextMenuAddedToCampaign(String campaign);

  /// No description provided for @influencerContextMenuAddedNotReady.
  ///
  /// In en, this message translates to:
  /// **'Added to {campaign}, but not ready to pitch yet: get their audience analytics and an agreed rate before the proposal goes out.'**
  String influencerContextMenuAddedNotReady(String campaign);

  /// No description provided for @commonClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get commonClose;

  /// No description provided for @navRailCollapse.
  ///
  /// In en, this message translates to:
  /// **'Show icons only'**
  String get navRailCollapse;

  /// No description provided for @navRailExpand.
  ///
  /// In en, this message translates to:
  /// **'Show labels'**
  String get navRailExpand;

  /// No description provided for @outreachHideThreadList.
  ///
  /// In en, this message translates to:
  /// **'Hide the conversation list'**
  String get outreachHideThreadList;

  /// No description provided for @outreachShowThreadList.
  ///
  /// In en, this message translates to:
  /// **'Show the conversation list'**
  String get outreachShowThreadList;

  /// No description provided for @outreachDeleteThread.
  ///
  /// In en, this message translates to:
  /// **'Delete conversation'**
  String get outreachDeleteThread;

  /// No description provided for @outreachDeleteThreadConfirm.
  ///
  /// In en, this message translates to:
  /// **'This removes the conversation and every message in it, for everyone. A later reply to it will arrive with no conversation to attach to.'**
  String get outreachDeleteThreadConfirm;

  /// No description provided for @outreachThreadDeleted.
  ///
  /// In en, this message translates to:
  /// **'Conversation deleted.'**
  String get outreachThreadDeleted;

  /// No description provided for @outreachDeleteMessage.
  ///
  /// In en, this message translates to:
  /// **'Delete message'**
  String get outreachDeleteMessage;

  /// No description provided for @outreachDeleteMessageConfirm.
  ///
  /// In en, this message translates to:
  /// **'This removes the record of this message. A message that really went out is not recalled by deleting it here.'**
  String get outreachDeleteMessageConfirm;

  /// No description provided for @outreachMessageDeleted.
  ///
  /// In en, this message translates to:
  /// **'Message deleted.'**
  String get outreachMessageDeleted;

  /// No description provided for @outreachCopyAiBrief.
  ///
  /// In en, this message translates to:
  /// **'Copy brief for AI'**
  String get outreachCopyAiBrief;

  /// No description provided for @outreachAiBriefCopied.
  ///
  /// In en, this message translates to:
  /// **'Channel brief and prompt copied — paste it into your AI.'**
  String get outreachAiBriefCopied;

  /// No description provided for @outreachBriefDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Brief for AI'**
  String get outreachBriefDialogTitle;

  /// No description provided for @outreachBriefDialogSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Everything the AI is given about this channel — and what it is asked to do with it. It is already on your clipboard.'**
  String get outreachBriefDialogSubtitle;

  /// No description provided for @outreachBriefCopyAgain.
  ///
  /// In en, this message translates to:
  /// **'Copy again'**
  String get outreachBriefCopyAgain;

  /// No description provided for @outreachBriefPromptSection.
  ///
  /// In en, this message translates to:
  /// **'What the AI is asked to do'**
  String get outreachBriefPromptSection;

  /// No description provided for @outreachBriefSectionChannel.
  ///
  /// In en, this message translates to:
  /// **'Channel'**
  String get outreachBriefSectionChannel;

  /// No description provided for @outreachBriefSectionAudience.
  ///
  /// In en, this message translates to:
  /// **'Audience'**
  String get outreachBriefSectionAudience;

  /// No description provided for @outreachBriefSectionLatestUpload.
  ///
  /// In en, this message translates to:
  /// **'Latest upload'**
  String get outreachBriefSectionLatestUpload;

  /// No description provided for @outreachBriefSectionRecentUploads.
  ///
  /// In en, this message translates to:
  /// **'Recent uploads'**
  String get outreachBriefSectionRecentUploads;

  /// No description provided for @outreachBriefSectionFit.
  ///
  /// In en, this message translates to:
  /// **'Why this channel'**
  String get outreachBriefSectionFit;

  /// No description provided for @outreachBriefSectionDraft.
  ///
  /// In en, this message translates to:
  /// **'Drafting with'**
  String get outreachBriefSectionDraft;

  /// No description provided for @outreachBriefSectionOther.
  ///
  /// In en, this message translates to:
  /// **'Also included'**
  String get outreachBriefSectionOther;

  /// No description provided for @outreachBriefFieldChannelName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get outreachBriefFieldChannelName;

  /// No description provided for @outreachBriefFieldChannelHandle.
  ///
  /// In en, this message translates to:
  /// **'Handle'**
  String get outreachBriefFieldChannelHandle;

  /// No description provided for @outreachBriefFieldContactName.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get outreachBriefFieldContactName;

  /// No description provided for @outreachBriefFieldCountry.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get outreachBriefFieldCountry;

  /// No description provided for @outreachBriefFieldChannelUrl.
  ///
  /// In en, this message translates to:
  /// **'Channel link'**
  String get outreachBriefFieldChannelUrl;

  /// No description provided for @outreachBriefFieldChannelDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get outreachBriefFieldChannelDescription;

  /// No description provided for @outreachBriefFieldSubscriberCount.
  ///
  /// In en, this message translates to:
  /// **'Subscribers'**
  String get outreachBriefFieldSubscriberCount;

  /// No description provided for @outreachBriefFieldMedianViews.
  ///
  /// In en, this message translates to:
  /// **'Median views'**
  String get outreachBriefFieldMedianViews;

  /// No description provided for @outreachBriefFieldLastVideoTitle.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get outreachBriefFieldLastVideoTitle;

  /// No description provided for @outreachBriefFieldLastVideoPublishedAt.
  ///
  /// In en, this message translates to:
  /// **'Published'**
  String get outreachBriefFieldLastVideoPublishedAt;

  /// No description provided for @outreachBriefFieldLastVideoViews.
  ///
  /// In en, this message translates to:
  /// **'Views'**
  String get outreachBriefFieldLastVideoViews;

  /// No description provided for @outreachBriefFieldLastVideoUrl.
  ///
  /// In en, this message translates to:
  /// **'Link'**
  String get outreachBriefFieldLastVideoUrl;

  /// No description provided for @outreachBriefFieldLastVideoDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get outreachBriefFieldLastVideoDescription;

  /// No description provided for @outreachBriefFieldRecentVideoTitles.
  ///
  /// In en, this message translates to:
  /// **'Titles'**
  String get outreachBriefFieldRecentVideoTitles;

  /// No description provided for @outreachBriefFieldRelevanceCriteria.
  ///
  /// In en, this message translates to:
  /// **'Relevance criteria'**
  String get outreachBriefFieldRelevanceCriteria;

  /// No description provided for @outreachBriefFieldNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get outreachBriefFieldNotes;

  /// No description provided for @outreachBriefFieldSenderName.
  ///
  /// In en, this message translates to:
  /// **'Sending as'**
  String get outreachBriefFieldSenderName;

  /// No description provided for @outreachBriefFieldWritingRules.
  ///
  /// In en, this message translates to:
  /// **'Writing rules'**
  String get outreachBriefFieldWritingRules;

  /// No description provided for @outreachBriefFieldTemplateName.
  ///
  /// In en, this message translates to:
  /// **'Template'**
  String get outreachBriefFieldTemplateName;

  /// No description provided for @outreachBriefFieldTemplateSubject.
  ///
  /// In en, this message translates to:
  /// **'Template subject'**
  String get outreachBriefFieldTemplateSubject;

  /// No description provided for @outreachBriefFieldTemplateBody.
  ///
  /// In en, this message translates to:
  /// **'Template body'**
  String get outreachBriefFieldTemplateBody;

  /// No description provided for @outreachBriefThin.
  ///
  /// In en, this message translates to:
  /// **'Almost nothing is recorded for this channel, so the draft has almost nothing to work with. Adding notes, relevance criteria or fresh uploads is what makes the difference here.'**
  String get outreachBriefThin;

  /// No description provided for @videoCatchUpTitle.
  ///
  /// In en, this message translates to:
  /// **'Filling in missing videos'**
  String get videoCatchUpTitle;

  /// No description provided for @videoCatchUpWhat.
  ///
  /// In en, this message translates to:
  /// **'Channels found by earlier searches that never had their recent uploads read. This runs quietly in the background so their median views fill in, and steps aside the moment you start a search.'**
  String get videoCatchUpWhat;

  /// Video catch-up panel headline while the sweep is working. 'read' is how many channels' upload lists have been fetched, 'saved' how many of those have had their video details written; 'read' always leads 'saved'. All three numbers arrive already grouped with thousands separators.
  ///
  /// In en, this message translates to:
  /// **'{read} read · {saved} saved of {total}'**
  String videoCatchUpProgress(String read, String saved, String total);

  /// No description provided for @videoCatchUpStarting.
  ///
  /// In en, this message translates to:
  /// **'Counting how many channels are still missing videos…'**
  String get videoCatchUpStarting;

  /// Video catch-up panel: a rough throughput and time-to-finish estimate, shown once enough of the pass has run to mean anything. 'timeLeft' is a pre-formatted span like '4h 10m' or '35m'.
  ///
  /// In en, this message translates to:
  /// **'≈ {rate} channels/min · about {timeLeft} left'**
  String videoCatchUpEta(String rate, String timeLeft);

  /// Video catch-up panel: reassurance that the sweep resumes rather than restarting. Shown while it is running or paused.
  ///
  /// In en, this message translates to:
  /// **'Progress is saved as it goes — closing the app or starting a search won\'t lose it; the next run carries on from here.'**
  String get videoCatchUpResumeNote;

  /// No description provided for @videoCatchUpCurrentChannel.
  ///
  /// In en, this message translates to:
  /// **'Now reading {handle}'**
  String videoCatchUpCurrentChannel(String handle);

  /// Video catch-up panel: shown in place of 'Now reading …' while the sweep pauses reading to upload finished channels to the team store. Usually seconds; after an upgrade it can be thousands of objects and many minutes, which is why it gets its own line. Both counts are pre-formatted.
  ///
  /// In en, this message translates to:
  /// **'Sharing finished channels with the team — {shared} of {total} uploaded. Reading resumes when this is done.'**
  String videoCatchUpSharing(String shared, String total);

  /// Legend for the lighter fill of the video catch-up progress bar: how far the sweep has got through reading channels' upload lists.
  ///
  /// In en, this message translates to:
  /// **'Uploads read'**
  String get videoCatchUpLayerReading;

  /// Legend for the solid fill of the video catch-up progress bar: how many of those channels' videos have actually been fetched from the API and written.
  ///
  /// In en, this message translates to:
  /// **'Details saved'**
  String get videoCatchUpLayerFetching;

  /// No description provided for @videoCatchUpDone.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing left to fill in} =1{Filled in 1 channel — done for now} other{Filled in {count} channels — done for now}}'**
  String videoCatchUpDone(int count);

  /// No description provided for @videoCatchUpPaused.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Paused so the pipeline is free — it picks up where it left off} other{Paused after {count} channel(s) so the pipeline is free — it picks up where it left off}}'**
  String videoCatchUpPaused(int count);

  /// No description provided for @videoCatchUpFailed.
  ///
  /// In en, this message translates to:
  /// **'Stopped early. Nothing is lost — it tries again on its own.'**
  String get videoCatchUpFailed;

  /// No description provided for @channelArrivalsFromSearch.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 new channel just arrived from the search running on this computer} other{{count} new channels just arrived from the search running on this computer}}'**
  String channelArrivalsFromSearch(int count);

  /// No description provided for @channelArrivalsFromTeam.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 new channel just arrived from the team\'s shared data} other{{count} new channels just arrived from the team\'s shared data}}'**
  String channelArrivalsFromTeam(int count);

  /// No description provided for @channelArrivalsDismiss.
  ///
  /// In en, this message translates to:
  /// **'Dismiss'**
  String get channelArrivalsDismiss;

  /// No description provided for @searchResumedNotice.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Picked up last session\'s interrupted search — 1 keyword left} other{Picked up last session\'s interrupted search — {count} keywords left}}'**
  String searchResumedNotice(int count);

  /// No description provided for @searchResumedAction.
  ///
  /// In en, this message translates to:
  /// **'View'**
  String get searchResumedAction;

  /// No description provided for @dashboardKeywordsTitle.
  ///
  /// In en, this message translates to:
  /// **'Keyword evaluation'**
  String get dashboardKeywordsTitle;

  /// No description provided for @dashboardKeywordsBody.
  ///
  /// In en, this message translates to:
  /// **'Every keyword the pipeline has searched, and how watched the channels it brought in are. Each channel sits in a tier by its trailing-30-day median views.'**
  String get dashboardKeywordsBody;

  /// No description provided for @dashboardKeywordsFilterHint.
  ///
  /// In en, this message translates to:
  /// **'Filter keywords'**
  String get dashboardKeywordsFilterHint;

  /// No description provided for @dashboardKeywordsSortLabel.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get dashboardKeywordsSortLabel;

  /// No description provided for @dashboardKeywordsSortWeighted.
  ///
  /// In en, this message translates to:
  /// **'Tier-weighted score'**
  String get dashboardKeywordsSortWeighted;

  /// No description provided for @dashboardKeywordsSortChannels.
  ///
  /// In en, this message translates to:
  /// **'Channel count'**
  String get dashboardKeywordsSortChannels;

  /// No description provided for @dashboardKeywordsSortMedian.
  ///
  /// In en, this message translates to:
  /// **'Median views'**
  String get dashboardKeywordsSortMedian;

  /// No description provided for @dashboardKeywordsSortHighestFirst.
  ///
  /// In en, this message translates to:
  /// **'Highest first — tap for lowest'**
  String get dashboardKeywordsSortHighestFirst;

  /// No description provided for @dashboardKeywordsSortLowestFirst.
  ///
  /// In en, this message translates to:
  /// **'Lowest first — tap for highest'**
  String get dashboardKeywordsSortLowestFirst;

  /// No description provided for @dashboardKeywordsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No keyword has brought in a measured channel yet.'**
  String get dashboardKeywordsEmpty;

  /// No description provided for @dashboardKeywordsScoreCaption.
  ///
  /// In en, this message translates to:
  /// **'score'**
  String get dashboardKeywordsScoreCaption;

  /// No description provided for @dashboardKeywordsRowSummary.
  ///
  /// In en, this message translates to:
  /// **'{channels} ch · ~{views} vid'**
  String dashboardKeywordsRowSummary(String channels, String views);

  /// No description provided for @dashboardKeywordsShowingCount.
  ///
  /// In en, this message translates to:
  /// **'Showing {shown} of {total}'**
  String dashboardKeywordsShowingCount(int shown, int total);

  /// No description provided for @dashboardKeywordsSheetSummary.
  ///
  /// In en, this message translates to:
  /// **'Tier-weighted score {score} · {channels} channels measured'**
  String dashboardKeywordsSheetSummary(String score, int channels);

  /// No description provided for @dashboardKeywordsTierOver1m.
  ///
  /// In en, this message translates to:
  /// **'1M+ median views'**
  String get dashboardKeywordsTierOver1m;

  /// No description provided for @dashboardKeywordsTier250kTo1m.
  ///
  /// In en, this message translates to:
  /// **'250K–1M median views'**
  String get dashboardKeywordsTier250kTo1m;

  /// No description provided for @dashboardKeywordsTier50kTo250k.
  ///
  /// In en, this message translates to:
  /// **'50K–250K median views'**
  String get dashboardKeywordsTier50kTo250k;

  /// No description provided for @dashboardKeywordsTierUnder50k.
  ///
  /// In en, this message translates to:
  /// **'Under 50K median views'**
  String get dashboardKeywordsTierUnder50k;

  /// No description provided for @navScratchpad.
  ///
  /// In en, this message translates to:
  /// **'Scratchpad'**
  String get navScratchpad;

  /// No description provided for @scratchpadYouTab.
  ///
  /// In en, this message translates to:
  /// **'you'**
  String get scratchpadYouTab;

  /// No description provided for @scratchpadNoTeammates.
  ///
  /// In en, this message translates to:
  /// **'No teammates yet — once people sign in, each gets a tab here.'**
  String get scratchpadNoTeammates;

  /// No description provided for @scratchpadOthersReadOnly.
  ///
  /// In en, this message translates to:
  /// **'Read-only. You can only edit your own box.'**
  String get scratchpadOthersReadOnly;

  /// No description provided for @scratchpadHint.
  ///
  /// In en, this message translates to:
  /// **'Shared with the team. Saves a moment after you stop typing.'**
  String get scratchpadHint;

  /// No description provided for @scratchpadLastSaved.
  ///
  /// In en, this message translates to:
  /// **'Last saved'**
  String get scratchpadLastSaved;

  /// No description provided for @scratchpadLastSyncedHere.
  ///
  /// In en, this message translates to:
  /// **'This device last synced'**
  String get scratchpadLastSyncedHere;

  /// No description provided for @scratchpadNever.
  ///
  /// In en, this message translates to:
  /// **'never'**
  String get scratchpadNever;

  /// No description provided for @scratchpadSyncLog.
  ///
  /// In en, this message translates to:
  /// **'Sync log (this device)'**
  String get scratchpadSyncLog;

  /// No description provided for @scratchpadLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the scratchpad.'**
  String get scratchpadLoadFailed;

  /// No description provided for @scratchpadRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get scratchpadRetry;

  /// No description provided for @scratchpadEmptyBox.
  ///
  /// In en, this message translates to:
  /// **'Nothing here yet.'**
  String get scratchpadEmptyBox;

  /// No description provided for @settingsMergeTitle.
  ///
  /// In en, this message translates to:
  /// **'Databases needing manual merge'**
  String get settingsMergeTitle;

  /// No description provided for @settingsMergeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'When a new build ships a rebuilt database, this machine\'s older copy is set aside rather than deleted. The current copy is in use; the old one waits in the folder below for you to merge anything you still need.'**
  String get settingsMergeSubtitle;

  /// No description provided for @settingsMergeThisDevice.
  ///
  /// In en, this message translates to:
  /// **'This device'**
  String get settingsMergeThisDevice;

  /// No description provided for @settingsMergeAcrossTeam.
  ///
  /// In en, this message translates to:
  /// **'Across the team'**
  String get settingsMergeAcrossTeam;

  /// No description provided for @settingsMergeNoneThisDevice.
  ///
  /// In en, this message translates to:
  /// **'Nothing on this device needs merging.'**
  String get settingsMergeNoneThisDevice;

  /// No description provided for @settingsMergePendingCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 file needs merging} other{{count} files need merging}}'**
  String settingsMergePendingCount(int count);

  /// No description provided for @settingsMergeSetAside.
  ///
  /// In en, this message translates to:
  /// **'Set aside {when}'**
  String settingsMergeSetAside(String when);

  /// No description provided for @settingsMergeFromRelease.
  ///
  /// In en, this message translates to:
  /// **'From: {note}'**
  String settingsMergeFromRelease(String note);

  /// No description provided for @settingsMergeOpenFolder.
  ///
  /// In en, this message translates to:
  /// **'Open folder'**
  String get settingsMergeOpenFolder;

  /// No description provided for @settingsMergeMarkResolved.
  ///
  /// In en, this message translates to:
  /// **'Mark resolved'**
  String get settingsMergeMarkResolved;

  /// No description provided for @settingsMergeRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get settingsMergeRefresh;

  /// No description provided for @settingsMergeResolveTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this merge resolved?'**
  String get settingsMergeResolveTitle;

  /// No description provided for @settingsMergeResolveBody.
  ///
  /// In en, this message translates to:
  /// **'You\'ve merged anything you need from the set-aside copy of {name}. Delete that copy now, or keep it in the folder just in case.'**
  String settingsMergeResolveBody(String name);

  /// No description provided for @settingsMergeResolveKeepFile.
  ///
  /// In en, this message translates to:
  /// **'Keep file'**
  String get settingsMergeResolveKeepFile;

  /// No description provided for @settingsMergeResolveDeleteFile.
  ///
  /// In en, this message translates to:
  /// **'Delete file'**
  String get settingsMergeResolveDeleteFile;

  /// No description provided for @settingsMergeCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get settingsMergeCancel;

  /// No description provided for @settingsMergeTeamNobody.
  ///
  /// In en, this message translates to:
  /// **'No one on the team has a database waiting to be merged.'**
  String get settingsMergeTeamNobody;

  /// No description provided for @settingsMergeTeamUpdated.
  ///
  /// In en, this message translates to:
  /// **'Updated {when}'**
  String settingsMergeTeamUpdated(String when);

  /// No description provided for @settingsMergeYou.
  ///
  /// In en, this message translates to:
  /// **'you'**
  String get settingsMergeYou;

  /// No description provided for @settingsMergeLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t read the merge status.'**
  String get settingsMergeLoadFailed;

  /// No description provided for @templatePerfSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Performance'**
  String get templatePerfSectionTitle;

  /// No description provided for @templatePerfUsage.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Not sent yet} =1{Sent once} other{Sent {count} times}}'**
  String templatePerfUsage(int count);

  /// No description provided for @templatePerfReplyRate.
  ///
  /// In en, this message translates to:
  /// **'{percent}% replied'**
  String templatePerfReplyRate(String percent);

  /// No description provided for @templatePerfNoRepliesYet.
  ///
  /// In en, this message translates to:
  /// **'No replies yet'**
  String get templatePerfNoRepliesYet;

  /// No description provided for @templatePerfAvgReplyDays.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{Avg. reply: 1 day} other{Avg. reply: {days} days}}'**
  String templatePerfAvgReplyDays(int days);

  /// No description provided for @templatePerfAvgReplyHours.
  ///
  /// In en, this message translates to:
  /// **'{hours, plural, =1{Avg. reply: 1 hour} other{Avg. reply: {hours} hours}}'**
  String templatePerfAvgReplyHours(int hours);

  /// No description provided for @templatePerfAvgReplyMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{Avg. reply: 1 minute} other{Avg. reply: {minutes} minutes}}'**
  String templatePerfAvgReplyMinutes(int minutes);

  /// Auto-computed working-days assist shown next to the manually-entered estimate on the deal detail screen. Not the manual field's value -- a suggestion the user can accept with the 'use this' action.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Pipeline suggests: 1 working day, based on deal created → last updated} other{Pipeline suggests: {count} working days, based on deal created → last updated}}'**
  String workingDaysSuggestionText(int count);

  /// No description provided for @workingDaysSuggestionUseThis.
  ///
  /// In en, this message translates to:
  /// **'Use this'**
  String get workingDaysSuggestionUseThis;

  /// No description provided for @workingDaysSuggestionApplied.
  ///
  /// In en, this message translates to:
  /// **'Working days estimate updated.'**
  String get workingDaysSuggestionApplied;

  /// No description provided for @workingDaysSuggestionFieldHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 6'**
  String get workingDaysSuggestionFieldHint;

  /// No description provided for @contactDiscoveryScanAction.
  ///
  /// In en, this message translates to:
  /// **'Scan for contacts'**
  String get contactDiscoveryScanAction;

  /// No description provided for @contactDiscoverySuggestionsTitle.
  ///
  /// In en, this message translates to:
  /// **'Found in the description'**
  String get contactDiscoverySuggestionsTitle;

  /// No description provided for @contactDiscoveryNoneFound.
  ///
  /// In en, this message translates to:
  /// **'No likely contacts found in the description.'**
  String get contactDiscoveryNoneFound;

  /// No description provided for @contactDiscoveryBusinessInquiry.
  ///
  /// In en, this message translates to:
  /// **'Business inquiry'**
  String get contactDiscoveryBusinessInquiry;

  /// No description provided for @contactDiscoveryAddSuggestion.
  ///
  /// In en, this message translates to:
  /// **'Add this contact'**
  String get contactDiscoveryAddSuggestion;

  /// No description provided for @onboardingWizardTitle.
  ///
  /// In en, this message translates to:
  /// **'Let\'s get this machine set up'**
  String get onboardingWizardTitle;

  /// No description provided for @onboardingWizardSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Five things worth checking once. Fix what you can right here, or skip anything and handle it later in Settings.'**
  String get onboardingWizardSubtitle;

  /// No description provided for @onboardingStepStatusDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get onboardingStepStatusDone;

  /// No description provided for @onboardingStepStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Needs a look'**
  String get onboardingStepStatusPending;

  /// No description provided for @onboardingSignInStepTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get onboardingSignInStepTitle;

  /// No description provided for @onboardingSignInStepSubtitle.
  ///
  /// In en, this message translates to:
  /// **'This machine reaches the team\'s shared data through your account.'**
  String get onboardingSignInStepSubtitle;

  /// No description provided for @onboardingSignInDoneDetail.
  ///
  /// In en, this message translates to:
  /// **'Signed in as {email}.'**
  String onboardingSignInDoneDetail(String email);

  /// No description provided for @onboardingSignInPendingDetail.
  ///
  /// In en, this message translates to:
  /// **'Not signed in on this machine yet.'**
  String get onboardingSignInPendingDetail;

  /// No description provided for @onboardingPythonStepTitle.
  ///
  /// In en, this message translates to:
  /// **'Python & pipeline'**
  String get onboardingPythonStepTitle;

  /// No description provided for @onboardingPythonStepSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Where this machine looks for the scraper, and which Python interpreter runs it.'**
  String get onboardingPythonStepSubtitle;

  /// No description provided for @onboardingPythonDoneDetail.
  ///
  /// In en, this message translates to:
  /// **'A pipeline location was found for this machine.'**
  String get onboardingPythonDoneDetail;

  /// No description provided for @onboardingPythonPendingDetail.
  ///
  /// In en, this message translates to:
  /// **'Searching isn\'t run from this build, so there\'s nothing to check here.'**
  String get onboardingPythonPendingDetail;

  /// No description provided for @onboardingMailboxStepTitle.
  ///
  /// In en, this message translates to:
  /// **'Outreach mailbox'**
  String get onboardingMailboxStepTitle;

  /// No description provided for @onboardingMailboxStepSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Connect the Gmail account this machine sends outreach from.'**
  String get onboardingMailboxStepSubtitle;

  /// No description provided for @onboardingMailboxDoneDetail.
  ///
  /// In en, this message translates to:
  /// **'A mailbox is connected and ready to send.'**
  String get onboardingMailboxDoneDetail;

  /// No description provided for @onboardingMailboxPendingDetail.
  ///
  /// In en, this message translates to:
  /// **'No mailbox connected yet.'**
  String get onboardingMailboxPendingDetail;

  /// No description provided for @onboardingTimeZoneStepTitle.
  ///
  /// In en, this message translates to:
  /// **'Time zone'**
  String get onboardingTimeZoneStepTitle;

  /// No description provided for @onboardingTimeZoneStepSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Every date and time in the app is shown in this zone.'**
  String get onboardingTimeZoneStepSubtitle;

  /// No description provided for @onboardingTimeZoneDoneDetail.
  ///
  /// In en, this message translates to:
  /// **'Matches this device\'s own time zone.'**
  String get onboardingTimeZoneDoneDetail;

  /// No description provided for @onboardingTimeZonePendingDetail.
  ///
  /// In en, this message translates to:
  /// **'Doesn\'t match this device\'s time zone.'**
  String get onboardingTimeZonePendingDetail;

  /// No description provided for @onboardingAwsStepTitle.
  ///
  /// In en, this message translates to:
  /// **'AWS setup'**
  String get onboardingAwsStepTitle;

  /// No description provided for @onboardingAwsStepSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Connect the AWS access key this machine\'s pipeline runs searches through.'**
  String get onboardingAwsStepSubtitle;

  /// No description provided for @onboardingAwsDoneDetail.
  ///
  /// In en, this message translates to:
  /// **'AWS credentials are saved for this account.'**
  String get onboardingAwsDoneDetail;

  /// No description provided for @onboardingAwsPendingDetail.
  ///
  /// In en, this message translates to:
  /// **'No AWS credentials saved yet.'**
  String get onboardingAwsPendingDetail;

  /// No description provided for @onboardingFinishButton.
  ///
  /// In en, this message translates to:
  /// **'Continue to the app'**
  String get onboardingFinishButton;

  /// No description provided for @onboardingSkipToSettingsButton.
  ///
  /// In en, this message translates to:
  /// **'Skip — handle this later in Settings'**
  String get onboardingSkipToSettingsButton;

  /// No description provided for @fullBismillah.
  ///
  /// In en, this message translates to:
  /// **'Bismillah Ar-Rahman Ar-Raheem'**
  String get fullBismillah;

  /// No description provided for @shortBismillah.
  ///
  /// In en, this message translates to:
  /// **'Bismillah'**
  String get shortBismillah;

  /// No description provided for @fullSalam.
  ///
  /// In en, this message translates to:
  /// **'As-Salamu \'Alaykum Wa-rahmatullahi Wa-barakatuh'**
  String get fullSalam;

  /// No description provided for @shortSalam.
  ///
  /// In en, this message translates to:
  /// **'As-Salamu \'Alaykum'**
  String get shortSalam;

  /// No description provided for @teamDashboardNavLabel.
  ///
  /// In en, this message translates to:
  /// **'Team'**
  String get teamDashboardNavLabel;

  /// No description provided for @teamDashboardTitle.
  ///
  /// In en, this message translates to:
  /// **'Team performance'**
  String get teamDashboardTitle;

  /// No description provided for @teamDashboardWeekRange.
  ///
  /// In en, this message translates to:
  /// **'{start} – {end}'**
  String teamDashboardWeekRange(String start, String end);

  /// No description provided for @teamDashboardPreviousWeek.
  ///
  /// In en, this message translates to:
  /// **'Previous week'**
  String get teamDashboardPreviousWeek;

  /// No description provided for @teamDashboardNextWeek.
  ///
  /// In en, this message translates to:
  /// **'Next week'**
  String get teamDashboardNextWeek;

  /// No description provided for @teamDashboardThisWeek.
  ///
  /// In en, this message translates to:
  /// **'This week'**
  String get teamDashboardThisWeek;

  /// No description provided for @teamDashboardColumnMember.
  ///
  /// In en, this message translates to:
  /// **'Team member'**
  String get teamDashboardColumnMember;

  /// No description provided for @teamDashboardColumnMessagesSent.
  ///
  /// In en, this message translates to:
  /// **'Messages sent'**
  String get teamDashboardColumnMessagesSent;

  /// No description provided for @teamDashboardColumnRepliesReceived.
  ///
  /// In en, this message translates to:
  /// **'Replies received'**
  String get teamDashboardColumnRepliesReceived;

  /// No description provided for @teamDashboardColumnReplyRate.
  ///
  /// In en, this message translates to:
  /// **'Reply rate'**
  String get teamDashboardColumnReplyRate;

  /// No description provided for @teamDashboardColumnMedianResponse.
  ///
  /// In en, this message translates to:
  /// **'Median first response'**
  String get teamDashboardColumnMedianResponse;

  /// No description provided for @teamDashboardNoData.
  ///
  /// In en, this message translates to:
  /// **'—'**
  String get teamDashboardNoData;

  /// No description provided for @teamDashboardEmptyState.
  ///
  /// In en, this message translates to:
  /// **'No outreach activity recorded for this week.'**
  String get teamDashboardEmptyState;

  /// No description provided for @teamDashboardAttributionNote.
  ///
  /// In en, this message translates to:
  /// **'Replies received and first-response time are credited to whoever sent the message being replied to — outreach_messages itself doesn\'t record a sender, so this is inferred from the activity log rather than stored directly.'**
  String get teamDashboardAttributionNote;

  /// No description provided for @teamDashboardDealsSummaryTitle.
  ///
  /// In en, this message translates to:
  /// **'Team deals this week'**
  String get teamDashboardDealsSummaryTitle;

  /// No description provided for @teamDashboardDealsClosedLabel.
  ///
  /// In en, this message translates to:
  /// **'Deals closed'**
  String get teamDashboardDealsClosedLabel;

  /// No description provided for @teamDashboardMarginClosedLabel.
  ///
  /// In en, this message translates to:
  /// **'Margin closed'**
  String get teamDashboardMarginClosedLabel;

  /// No description provided for @teamDashboardDealsCaveat.
  ///
  /// In en, this message translates to:
  /// **'Not broken out per person: no record in the database says who moved a deal\'s stage, only that it changed.'**
  String get teamDashboardDealsCaveat;

  /// No description provided for @teamDashboardDurationDaysHours.
  ///
  /// In en, this message translates to:
  /// **'{days}d {hours}h'**
  String teamDashboardDurationDaysHours(int days, int hours);

  /// No description provided for @teamDashboardDurationHoursMinutes.
  ///
  /// In en, this message translates to:
  /// **'{hours}h {minutes}m'**
  String teamDashboardDurationHoursMinutes(int hours, int minutes);

  /// No description provided for @teamDashboardDurationMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m'**
  String teamDashboardDurationMinutes(int minutes);

  /// No description provided for @teamDashboardLoadError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the team dashboard.'**
  String get teamDashboardLoadError;

  /// No description provided for @rateHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Rate history'**
  String get rateHistoryTitle;

  /// No description provided for @rateHistoryEmpty.
  ///
  /// In en, this message translates to:
  /// **'No closed deals yet for this channel.'**
  String get rateHistoryEmpty;

  /// No description provided for @rateHistoryMedianViewsLabel.
  ///
  /// In en, this message translates to:
  /// **'Median views at deal'**
  String get rateHistoryMedianViewsLabel;

  /// No description provided for @rateHistoryViewsNotMeasured.
  ///
  /// In en, this message translates to:
  /// **'Not measured'**
  String get rateHistoryViewsNotMeasured;

  /// No description provided for @ownerPickerUnassigned.
  ///
  /// In en, this message translates to:
  /// **'Unassigned'**
  String get ownerPickerUnassigned;

  /// No description provided for @deliverableSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Deliverables'**
  String get deliverableSectionTitle;

  /// No description provided for @deliverableSectionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Individual pieces of content for this deal, tracked one by one — separate from the summary line above.'**
  String get deliverableSectionSubtitle;

  /// No description provided for @deliverableEmptyState.
  ///
  /// In en, this message translates to:
  /// **'No deliverables tracked yet.'**
  String get deliverableEmptyState;

  /// No description provided for @deliverableAddButton.
  ///
  /// In en, this message translates to:
  /// **'Add deliverable'**
  String get deliverableAddButton;

  /// No description provided for @deliverableAddDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a deliverable'**
  String get deliverableAddDialogTitle;

  /// No description provided for @deliverableTypeIntegration.
  ///
  /// In en, this message translates to:
  /// **'Integration'**
  String get deliverableTypeIntegration;

  /// No description provided for @deliverableTypeDedicated.
  ///
  /// In en, this message translates to:
  /// **'Dedicated video'**
  String get deliverableTypeDedicated;

  /// No description provided for @deliverableTypeShort.
  ///
  /// In en, this message translates to:
  /// **'Short'**
  String get deliverableTypeShort;

  /// No description provided for @deliverableTypeCommunityPost.
  ///
  /// In en, this message translates to:
  /// **'Community post'**
  String get deliverableTypeCommunityPost;

  /// No description provided for @deliverableTypeOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get deliverableTypeOther;

  /// No description provided for @deliverableStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get deliverableStatusPending;

  /// No description provided for @deliverableStatusDrafted.
  ///
  /// In en, this message translates to:
  /// **'Drafted'**
  String get deliverableStatusDrafted;

  /// No description provided for @deliverableStatusApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get deliverableStatusApproved;

  /// No description provided for @deliverableStatusPublished.
  ///
  /// In en, this message translates to:
  /// **'Published'**
  String get deliverableStatusPublished;

  /// No description provided for @deliverableAgreedDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Agreed'**
  String get deliverableAgreedDateLabel;

  /// No description provided for @deliverableDraftReceivedDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Draft received'**
  String get deliverableDraftReceivedDateLabel;

  /// No description provided for @deliverableApprovedDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Approval date'**
  String get deliverableApprovedDateLabel;

  /// No description provided for @deliverableDateNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get deliverableDateNotSet;

  /// No description provided for @deliverablePublishedUrlLabel.
  ///
  /// In en, this message translates to:
  /// **'Published link'**
  String get deliverablePublishedUrlLabel;

  /// No description provided for @deliverablePublishedUrlHint.
  ///
  /// In en, this message translates to:
  /// **'https://…'**
  String get deliverablePublishedUrlHint;

  /// No description provided for @deliverableNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Notes for this deliverable'**
  String get deliverableNotesHint;

  /// No description provided for @deliverableMoveUpTooltip.
  ///
  /// In en, this message translates to:
  /// **'Move up'**
  String get deliverableMoveUpTooltip;

  /// No description provided for @deliverableMoveDownTooltip.
  ///
  /// In en, this message translates to:
  /// **'Move down'**
  String get deliverableMoveDownTooltip;

  /// No description provided for @deliverableDeleteTooltip.
  ///
  /// In en, this message translates to:
  /// **'Delete deliverable'**
  String get deliverableDeleteTooltip;

  /// No description provided for @deliverableDeleteConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this deliverable?'**
  String get deliverableDeleteConfirmTitle;

  /// No description provided for @deliverableDeleteConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This removes it from the deal. This can\'t be undone.'**
  String get deliverableDeleteConfirmBody;

  /// No description provided for @deliverableAddedToast.
  ///
  /// In en, this message translates to:
  /// **'Deliverable added'**
  String get deliverableAddedToast;

  /// No description provided for @deliverableDeletedToast.
  ///
  /// In en, this message translates to:
  /// **'Deliverable deleted'**
  String get deliverableDeletedToast;

  /// No description provided for @deliverableLoadError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load deliverables.'**
  String get deliverableLoadError;

  /// No description provided for @manualEngagementTitle.
  ///
  /// In en, this message translates to:
  /// **'Manual engagement'**
  String get manualEngagementTitle;

  /// No description provided for @manualEngagementDisclaimer.
  ///
  /// In en, this message translates to:
  /// **'Entered by hand — never pulled automatically from any API.'**
  String get manualEngagementDisclaimer;

  /// No description provided for @manualEngagementRateLabel.
  ///
  /// In en, this message translates to:
  /// **'Engagement rate'**
  String get manualEngagementRateLabel;

  /// No description provided for @manualEngagementRateNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not entered'**
  String get manualEngagementRateNotSet;

  /// No description provided for @manualEngagementRateHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 4.2'**
  String get manualEngagementRateHint;

  /// No description provided for @manualEngagementNoteLabel.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get manualEngagementNoteLabel;

  /// No description provided for @manualEngagementNoteNotSet.
  ///
  /// In en, this message translates to:
  /// **'No note'**
  String get manualEngagementNoteNotSet;

  /// No description provided for @manualEngagementNeverEntered.
  ///
  /// In en, this message translates to:
  /// **'No manual engagement entered yet.'**
  String get manualEngagementNeverEntered;

  /// No description provided for @manualEngagementUpdatedToday.
  ///
  /// In en, this message translates to:
  /// **'Updated today'**
  String get manualEngagementUpdatedToday;

  /// No description provided for @manualEngagementUpdatedDaysAgo.
  ///
  /// In en, this message translates to:
  /// **'Updated {count}d ago'**
  String manualEngagementUpdatedDaysAgo(int count);

  /// No description provided for @manualEngagementEditTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit manual engagement'**
  String get manualEngagementEditTitle;

  /// No description provided for @manualEngagementEditRateHelp.
  ///
  /// In en, this message translates to:
  /// **'A percentage you looked up yourself — from a media kit, the channel\'s own analytics, wherever. Leave blank to clear it.'**
  String get manualEngagementEditRateHelp;

  /// No description provided for @manualEngagementEditNoteHelp.
  ///
  /// In en, this message translates to:
  /// **'Where this number came from, or any context worth keeping.'**
  String get manualEngagementEditNoteHelp;

  /// No description provided for @manualEngagementEditAction.
  ///
  /// In en, this message translates to:
  /// **'Edit manual engagement'**
  String get manualEngagementEditAction;

  /// No description provided for @manualEngagementClearAction.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get manualEngagementClearAction;

  /// No description provided for @manualEngagementSaved.
  ///
  /// In en, this message translates to:
  /// **'Manual engagement saved.'**
  String get manualEngagementSaved;

  /// No description provided for @manualEngagementCleared.
  ///
  /// In en, this message translates to:
  /// **'Manual engagement cleared.'**
  String get manualEngagementCleared;

  /// No description provided for @manualEngagementRateInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a percentage between 0 and 100, or leave it blank.'**
  String get manualEngagementRateInvalid;

  /// No description provided for @jobSchedulerCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled jobs'**
  String get jobSchedulerCardTitle;

  /// No description provided for @jobSchedulerCardSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Background jobs this machine runs on its own schedule, checked once a minute.'**
  String get jobSchedulerCardSubtitle;

  /// No description provided for @jobSchedulerRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get jobSchedulerRefresh;

  /// No description provided for @jobSchedulerLoadError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the scheduled jobs.'**
  String get jobSchedulerLoadError;

  /// No description provided for @jobSchedulerEmptyState.
  ///
  /// In en, this message translates to:
  /// **'No scheduled jobs on this machine.'**
  String get jobSchedulerEmptyState;

  /// No description provided for @jobSchedulerDisabledBadge.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get jobSchedulerDisabledBadge;

  /// No description provided for @jobSchedulerLastRunNever.
  ///
  /// In en, this message translates to:
  /// **'Last run: never'**
  String get jobSchedulerLastRunNever;

  /// No description provided for @jobSchedulerLastRunLabel.
  ///
  /// In en, this message translates to:
  /// **'Last run: {when}'**
  String jobSchedulerLastRunLabel(String when);

  /// No description provided for @jobSchedulerNextRunNone.
  ///
  /// In en, this message translates to:
  /// **'Next run: not scheduled'**
  String get jobSchedulerNextRunNone;

  /// No description provided for @jobSchedulerNextRunLabel.
  ///
  /// In en, this message translates to:
  /// **'Next run: {when}'**
  String jobSchedulerNextRunLabel(String when);

  /// No description provided for @jobSchedulerDeleteTooltip.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get jobSchedulerDeleteTooltip;

  /// No description provided for @jobSchedulerDeleteConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this scheduled job?'**
  String get jobSchedulerDeleteConfirmTitle;

  /// No description provided for @jobSchedulerDeleteConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'\"{kind}\" will stop running on this machine. This can\'t be undone.'**
  String jobSchedulerDeleteConfirmBody(String kind);

  /// No description provided for @jobSchedulerDeleteConfirmCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get jobSchedulerDeleteConfirmCancel;

  /// No description provided for @jobSchedulerDeleteConfirmDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get jobSchedulerDeleteConfirmDelete;

  /// No description provided for @paymentSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get paymentSectionTitle;

  /// No description provided for @paymentMarginLabel.
  ///
  /// In en, this message translates to:
  /// **'Your margin'**
  String get paymentMarginLabel;

  /// No description provided for @paymentCurrencyLabel.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get paymentCurrencyLabel;

  /// No description provided for @paymentMethodLabel.
  ///
  /// In en, this message translates to:
  /// **'Payment method'**
  String get paymentMethodLabel;

  /// No description provided for @paymentMethodHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. wire, PayPal, Instapay'**
  String get paymentMethodHint;

  /// No description provided for @paymentReferenceLabel.
  ///
  /// In en, this message translates to:
  /// **'Payment reference'**
  String get paymentReferenceLabel;

  /// No description provided for @paymentReferenceHint.
  ///
  /// In en, this message translates to:
  /// **'Transaction ID, wire reference…'**
  String get paymentReferenceHint;

  /// No description provided for @paymentInvoiceSentLabel.
  ///
  /// In en, this message translates to:
  /// **'Invoice sent'**
  String get paymentInvoiceSentLabel;

  /// No description provided for @paymentInvoicePaidLabel.
  ///
  /// In en, this message translates to:
  /// **'Invoice paid'**
  String get paymentInvoicePaidLabel;

  /// No description provided for @paymentPayoutDueLabel.
  ///
  /// In en, this message translates to:
  /// **'Payout due'**
  String get paymentPayoutDueLabel;

  /// No description provided for @paymentPayoutPaidLabel.
  ///
  /// In en, this message translates to:
  /// **'Payout paid'**
  String get paymentPayoutPaidLabel;

  /// No description provided for @paymentNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get paymentNotSet;

  /// No description provided for @paymentMarkSentNow.
  ///
  /// In en, this message translates to:
  /// **'Mark sent now'**
  String get paymentMarkSentNow;

  /// No description provided for @paymentMarkPaidNow.
  ///
  /// In en, this message translates to:
  /// **'Mark paid now'**
  String get paymentMarkPaidNow;

  /// No description provided for @paymentMarkDueToday.
  ///
  /// In en, this message translates to:
  /// **'Set due today'**
  String get paymentMarkDueToday;

  /// No description provided for @paymentPickDateTooltip.
  ///
  /// In en, this message translates to:
  /// **'Pick a date'**
  String get paymentPickDateTooltip;

  /// No description provided for @paymentClearDateTooltip.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get paymentClearDateTooltip;

  /// No description provided for @paymentDetailsSaved.
  ///
  /// In en, this message translates to:
  /// **'Payment details saved'**
  String get paymentDetailsSaved;

  /// No description provided for @paymentDateSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get paymentDateSaved;

  /// No description provided for @financeNavLabel.
  ///
  /// In en, this message translates to:
  /// **'Finance'**
  String get financeNavLabel;

  /// No description provided for @financeTitle.
  ///
  /// In en, this message translates to:
  /// **'Finance'**
  String get financeTitle;

  /// No description provided for @financeSummaryBrandRevenue.
  ///
  /// In en, this message translates to:
  /// **'Total brand revenue'**
  String get financeSummaryBrandRevenue;

  /// No description provided for @financeSummaryMargin.
  ///
  /// In en, this message translates to:
  /// **'Total margin'**
  String get financeSummaryMargin;

  /// No description provided for @financeSummaryOutstanding.
  ///
  /// In en, this message translates to:
  /// **'Outstanding (invoiced, unpaid)'**
  String get financeSummaryOutstanding;

  /// No description provided for @financeSummaryOwedToCreators.
  ///
  /// In en, this message translates to:
  /// **'Owed to creators'**
  String get financeSummaryOwedToCreators;

  /// No description provided for @financeFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All deals'**
  String get financeFilterAll;

  /// No description provided for @financeFilterInvoiceUnpaid.
  ///
  /// In en, this message translates to:
  /// **'Invoice sent, unpaid'**
  String get financeFilterInvoiceUnpaid;

  /// No description provided for @financeFilterInvoiceOverdue.
  ///
  /// In en, this message translates to:
  /// **'Invoice overdue'**
  String get financeFilterInvoiceOverdue;

  /// No description provided for @financeFilterPayoutDue.
  ///
  /// In en, this message translates to:
  /// **'Payout due'**
  String get financeFilterPayoutDue;

  /// No description provided for @financeFilterPayoutOverdue.
  ///
  /// In en, this message translates to:
  /// **'Payout overdue'**
  String get financeFilterPayoutOverdue;

  /// No description provided for @financeFilterSettled.
  ///
  /// In en, this message translates to:
  /// **'Fully settled'**
  String get financeFilterSettled;

  /// No description provided for @financeColumnDeal.
  ///
  /// In en, this message translates to:
  /// **'Deal'**
  String get financeColumnDeal;

  /// No description provided for @financeColumnBrandPrice.
  ///
  /// In en, this message translates to:
  /// **'Brand pays'**
  String get financeColumnBrandPrice;

  /// No description provided for @financeColumnMargin.
  ///
  /// In en, this message translates to:
  /// **'Margin'**
  String get financeColumnMargin;

  /// No description provided for @financeColumnInvoiceSent.
  ///
  /// In en, this message translates to:
  /// **'Invoice sent'**
  String get financeColumnInvoiceSent;

  /// No description provided for @financeColumnInvoicePaid.
  ///
  /// In en, this message translates to:
  /// **'Invoice paid'**
  String get financeColumnInvoicePaid;

  /// No description provided for @financeColumnPayoutDue.
  ///
  /// In en, this message translates to:
  /// **'Payout due'**
  String get financeColumnPayoutDue;

  /// No description provided for @financeColumnPayoutPaid.
  ///
  /// In en, this message translates to:
  /// **'Payout paid'**
  String get financeColumnPayoutPaid;

  /// No description provided for @financeNotSet.
  ///
  /// In en, this message translates to:
  /// **'—'**
  String get financeNotSet;

  /// No description provided for @financeEmptyState.
  ///
  /// In en, this message translates to:
  /// **'No deals match this filter.'**
  String get financeEmptyState;

  /// No description provided for @financeLoadError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the finance ledger.'**
  String get financeLoadError;

  /// No description provided for @myDaySectionTitle.
  ///
  /// In en, this message translates to:
  /// **'My Day'**
  String get myDaySectionTitle;

  /// No description provided for @myDaySectionEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing urgent right now — nice work.'**
  String get myDaySectionEmpty;

  /// No description provided for @myDaySectionLoadError.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load My Day.'**
  String get myDaySectionLoadError;

  /// No description provided for @myDayGroupOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get myDayGroupOverdue;

  /// No description provided for @myDayGroupDueSoon.
  ///
  /// In en, this message translates to:
  /// **'Due soon'**
  String get myDayGroupDueSoon;

  /// No description provided for @myDayPayoutDueTitle.
  ///
  /// In en, this message translates to:
  /// **'Payout due — {influencer}'**
  String myDayPayoutDueTitle(String influencer);

  /// No description provided for @myDayInvoiceUnpaidTitle.
  ///
  /// In en, this message translates to:
  /// **'Invoice unpaid — {influencer}'**
  String myDayInvoiceUnpaidTitle(String influencer);

  /// No description provided for @myDayDeliverableDueTitle.
  ///
  /// In en, this message translates to:
  /// **'{type} due — {influencer}'**
  String myDayDeliverableDueTitle(String type, String influencer);

  /// No description provided for @myDayOutreachReplyTitle.
  ///
  /// In en, this message translates to:
  /// **'Reply needed — {influencer}'**
  String myDayOutreachReplyTitle(String influencer);

  /// No description provided for @myDayOutreachWaitingSince.
  ///
  /// In en, this message translates to:
  /// **'Waiting since {date}'**
  String myDayOutreachWaitingSince(String date);

  /// No description provided for @myDayDeliverableDeadline.
  ///
  /// In en, this message translates to:
  /// **'Deal deadline {date}'**
  String myDayDeliverableDeadline(String date);

  /// No description provided for @myDayReportDueTitle.
  ///
  /// In en, this message translates to:
  /// **'30-day report — {influencer}'**
  String myDayReportDueTitle(String influencer);

  /// No description provided for @myDayReportDueOn.
  ///
  /// In en, this message translates to:
  /// **'Due {date}'**
  String myDayReportDueOn(String date);

  /// No description provided for @reportTitle.
  ///
  /// In en, this message translates to:
  /// **'30-day report'**
  String get reportTitle;

  /// No description provided for @reportDueOn.
  ///
  /// In en, this message translates to:
  /// **'Report due {date}'**
  String reportDueOn(String date);

  /// No description provided for @reportFetchViews.
  ///
  /// In en, this message translates to:
  /// **'Read the views now'**
  String get reportFetchViews;

  /// No description provided for @reportFetching.
  ///
  /// In en, this message translates to:
  /// **'Asking YouTube for the views…'**
  String get reportFetching;

  /// No description provided for @reportNeedsLink.
  ///
  /// In en, this message translates to:
  /// **'Add the video\'s link first: the views are read from it.'**
  String get reportNeedsLink;

  /// No description provided for @reportEarly.
  ///
  /// In en, this message translates to:
  /// **'It is due on {date}. Views read before then are not 30-day views.'**
  String reportEarly(String date);

  /// No description provided for @reportFetchFailed.
  ///
  /// In en, this message translates to:
  /// **'The views could not be read: {error}'**
  String reportFetchFailed(String error);

  /// No description provided for @reportClicksLabel.
  ///
  /// In en, this message translates to:
  /// **'Clicks on the tracking link'**
  String get reportClicksLabel;

  /// No description provided for @reportClicksHelper.
  ///
  /// In en, this message translates to:
  /// **'Read them off the link\'s own dashboard.'**
  String get reportClicksHelper;

  /// No description provided for @reportSaveClicks.
  ///
  /// In en, this message translates to:
  /// **'Save clicks'**
  String get reportSaveClicks;

  /// No description provided for @reportCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy for email'**
  String get reportCopy;

  /// No description provided for @reportCopied.
  ///
  /// In en, this message translates to:
  /// **'The report is copied.'**
  String get reportCopied;

  /// No description provided for @reportSavePage.
  ///
  /// In en, this message translates to:
  /// **'Save a page to print'**
  String get reportSavePage;

  /// No description provided for @reportPageSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved: {path}'**
  String reportPageSaved(String path);

  /// No description provided for @reportPageFailed.
  ///
  /// In en, this message translates to:
  /// **'The page could not be saved.'**
  String get reportPageFailed;

  /// No description provided for @reportRemindPitch.
  ///
  /// In en, this message translates to:
  /// **'Results are good: remind me to pitch {brand} its next creator'**
  String reportRemindPitch(String brand);

  /// No description provided for @reportPitchReminder.
  ///
  /// In en, this message translates to:
  /// **'Pitch {brand} its next creator'**
  String reportPitchReminder(String brand);

  /// No description provided for @reportReminderSet.
  ///
  /// In en, this message translates to:
  /// **'Reminder set for tomorrow.'**
  String get reportReminderSet;

  /// No description provided for @reportTextHeading.
  ///
  /// In en, this message translates to:
  /// **'{creator} × {brand}: results after 30 days'**
  String reportTextHeading(String creator, String brand);

  /// No description provided for @reportTextVideo.
  ///
  /// In en, this message translates to:
  /// **'Video: {url}'**
  String reportTextVideo(String url);

  /// No description provided for @reportTextLive.
  ///
  /// In en, this message translates to:
  /// **'Went live: {date}'**
  String reportTextLive(String date);

  /// No description provided for @reportTextViews.
  ///
  /// In en, this message translates to:
  /// **'Views on {date}: {views}'**
  String reportTextViews(String date, String views);

  /// No description provided for @reportTextPrice.
  ///
  /// In en, this message translates to:
  /// **'Price: {price}'**
  String reportTextPrice(String price);

  /// No description provided for @reportTextPriceShare.
  ///
  /// In en, this message translates to:
  /// **'Price (an even share of the deal across {count} deliverables): {price}'**
  String reportTextPriceShare(int count, String price);

  /// No description provided for @reportTextCpm.
  ///
  /// In en, this message translates to:
  /// **'CPM achieved: {cpm}'**
  String reportTextCpm(String cpm);

  /// No description provided for @reportTextClicks.
  ///
  /// In en, this message translates to:
  /// **'Clicks on the tracking link: {clicks}'**
  String reportTextClicks(String clicks);

  /// No description provided for @myDayDeliverableTypeIntegration.
  ///
  /// In en, this message translates to:
  /// **'Integration'**
  String get myDayDeliverableTypeIntegration;

  /// No description provided for @myDayDeliverableTypeDedicated.
  ///
  /// In en, this message translates to:
  /// **'Dedicated video'**
  String get myDayDeliverableTypeDedicated;

  /// No description provided for @myDayDeliverableTypeShort.
  ///
  /// In en, this message translates to:
  /// **'Short'**
  String get myDayDeliverableTypeShort;

  /// No description provided for @myDayDeliverableTypeCommunityPost.
  ///
  /// In en, this message translates to:
  /// **'Community post'**
  String get myDayDeliverableTypeCommunityPost;

  /// No description provided for @myDayDeliverableTypeOther.
  ///
  /// In en, this message translates to:
  /// **'Deliverable'**
  String get myDayDeliverableTypeOther;

  /// No description provided for @myDayReminderKindFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Follow-up'**
  String get myDayReminderKindFollowUp;

  /// No description provided for @myDayReminderKindDealDeadline.
  ///
  /// In en, this message translates to:
  /// **'Deal deadline'**
  String get myDayReminderKindDealDeadline;

  /// No description provided for @myDayReminderKindCustom.
  ///
  /// In en, this message translates to:
  /// **'Reminder'**
  String get myDayReminderKindCustom;

  /// No description provided for @outreachSlaMinutesShort.
  ///
  /// In en, this message translates to:
  /// **'{minutes}m'**
  String outreachSlaMinutesShort(int minutes);

  /// No description provided for @outreachSlaHoursShort.
  ///
  /// In en, this message translates to:
  /// **'{hours}h'**
  String outreachSlaHoursShort(int hours);

  /// No description provided for @outreachSlaDaysShort.
  ///
  /// In en, this message translates to:
  /// **'{days}d'**
  String outreachSlaDaysShort(int days);

  /// No description provided for @outreachSlaTooltipWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting on our reply'**
  String get outreachSlaTooltipWaiting;

  /// No description provided for @outreachSlaTooltipOverdue.
  ///
  /// In en, this message translates to:
  /// **'Waiting on our reply — past the 24-hour window'**
  String get outreachSlaTooltipOverdue;

  /// No description provided for @outreachClassificationInterested.
  ///
  /// In en, this message translates to:
  /// **'Interested'**
  String get outreachClassificationInterested;

  /// No description provided for @outreachClassificationAskingRate.
  ///
  /// In en, this message translates to:
  /// **'Asking rate'**
  String get outreachClassificationAskingRate;

  /// No description provided for @outreachClassificationNotNow.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get outreachClassificationNotNow;

  /// No description provided for @outreachClassificationDecline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get outreachClassificationDecline;

  /// No description provided for @outreachClassificationWrongContact.
  ///
  /// In en, this message translates to:
  /// **'Wrong contact'**
  String get outreachClassificationWrongContact;

  /// No description provided for @outreachClassificationAutoReply.
  ///
  /// In en, this message translates to:
  /// **'Auto-reply'**
  String get outreachClassificationAutoReply;

  /// No description provided for @outreachClassificationClear.
  ///
  /// In en, this message translates to:
  /// **'Clear tag'**
  String get outreachClassificationClear;

  /// No description provided for @outreachClassificationFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All conversations'**
  String get outreachClassificationFilterAll;

  /// No description provided for @outreachClassificationFilterEmpty.
  ///
  /// In en, this message translates to:
  /// **'No threads with this classification yet.'**
  String get outreachClassificationFilterEmpty;

  /// No description provided for @outreachClassifyMessage.
  ///
  /// In en, this message translates to:
  /// **'Tag this reply'**
  String get outreachClassifyMessage;

  /// No description provided for @campaignSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Campaigns'**
  String get campaignSectionTitle;

  /// No description provided for @campaignAddButton.
  ///
  /// In en, this message translates to:
  /// **'Add campaign'**
  String get campaignAddButton;

  /// No description provided for @campaignSectionEmpty.
  ///
  /// In en, this message translates to:
  /// **'No campaigns yet — group this brand\'s deals under one to plan a proposal or report around it.'**
  String get campaignSectionEmpty;

  /// No description provided for @campaignAddedToast.
  ///
  /// In en, this message translates to:
  /// **'Campaign created'**
  String get campaignAddedToast;

  /// No description provided for @campaignStartDateValue.
  ///
  /// In en, this message translates to:
  /// **'Starts {date}'**
  String campaignStartDateValue(String date);

  /// No description provided for @campaignLiveDateValue.
  ///
  /// In en, this message translates to:
  /// **'Live {date}'**
  String campaignLiveDateValue(String date);

  /// No description provided for @campaignAddDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a campaign'**
  String get campaignAddDialogTitle;

  /// No description provided for @campaignNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get campaignNameLabel;

  /// No description provided for @campaignNameRequired.
  ///
  /// In en, this message translates to:
  /// **'A name is required.'**
  String get campaignNameRequired;

  /// No description provided for @campaignNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get campaignNotesLabel;

  /// No description provided for @campaignStartDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Start date'**
  String get campaignStartDateLabel;

  /// No description provided for @campaignLiveDateLabel.
  ///
  /// In en, this message translates to:
  /// **'Live date'**
  String get campaignLiveDateLabel;

  /// No description provided for @campaignDateNotSet.
  ///
  /// In en, this message translates to:
  /// **'Not set'**
  String get campaignDateNotSet;

  /// No description provided for @campaignStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get campaignStatusActive;

  /// No description provided for @campaignStatusClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get campaignStatusClosed;

  /// No description provided for @campaignDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Campaign'**
  String get campaignDetailTitle;

  /// No description provided for @campaignDeleteTooltip.
  ///
  /// In en, this message translates to:
  /// **'Delete campaign'**
  String get campaignDeleteTooltip;

  /// No description provided for @campaignNotFound.
  ///
  /// In en, this message translates to:
  /// **'Campaign not found.'**
  String get campaignNotFound;

  /// No description provided for @campaignNotesHint.
  ///
  /// In en, this message translates to:
  /// **'Anything worth remembering about this campaign.'**
  String get campaignNotesHint;

  /// No description provided for @campaignNotesSaved.
  ///
  /// In en, this message translates to:
  /// **'Notes saved'**
  String get campaignNotesSaved;

  /// No description provided for @campaignDeleteConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this campaign?'**
  String get campaignDeleteConfirmTitle;

  /// No description provided for @campaignDeleteConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This removes the campaign and its shortlist. Deals already linked to it are not affected.'**
  String get campaignDeleteConfirmBody;

  /// No description provided for @campaignDeletedToast.
  ///
  /// In en, this message translates to:
  /// **'Campaign deleted'**
  String get campaignDeletedToast;

  /// No description provided for @campaignShortlistTitle.
  ///
  /// In en, this message translates to:
  /// **'Shortlist'**
  String get campaignShortlistTitle;

  /// No description provided for @campaignShortlistAddButton.
  ///
  /// In en, this message translates to:
  /// **'Add channel'**
  String get campaignShortlistAddButton;

  /// No description provided for @campaignDraftPitch.
  ///
  /// In en, this message translates to:
  /// **'Draft pitch to brand'**
  String get campaignDraftPitch;

  /// No description provided for @campaignPitchDrafting.
  ///
  /// In en, this message translates to:
  /// **'Drafting the pitch…'**
  String get campaignPitchDrafting;

  /// No description provided for @campaignPitchNoContact.
  ///
  /// In en, this message translates to:
  /// **'The brand has no contact email yet. Add one on the brand\'s page first.'**
  String get campaignPitchNoContact;

  /// No description provided for @campaignPitchNobodyReady.
  ///
  /// In en, this message translates to:
  /// **'Nobody on this shortlist is ready to pitch yet: each needs a media kit and an agreed rate (BRD-PRES-15).'**
  String get campaignPitchNobodyReady;

  /// No description provided for @campaignPitchLeftOutTitle.
  ///
  /// In en, this message translates to:
  /// **'Some are not ready to pitch'**
  String get campaignPitchLeftOutTitle;

  /// No description provided for @campaignPitchLeftOut.
  ///
  /// In en, this message translates to:
  /// **'These are not ready to pitch yet and will be left out: {handles}'**
  String campaignPitchLeftOut(String handles);

  /// No description provided for @campaignPitchConfirm.
  ///
  /// In en, this message translates to:
  /// **'Draft pitch'**
  String get campaignPitchConfirm;

  /// No description provided for @campaignPitchDrafted.
  ///
  /// In en, this message translates to:
  /// **'Pitch drafted. It is waiting in Outreach → Comms queue; nothing has been sent.'**
  String get campaignPitchDrafted;

  /// No description provided for @campaignShortlistSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Channels under consideration for this campaign, before any of them becomes a deal.'**
  String get campaignShortlistSubtitle;

  /// No description provided for @campaignShortlistEmpty.
  ///
  /// In en, this message translates to:
  /// **'No channels shortlisted yet.'**
  String get campaignShortlistEmpty;

  /// No description provided for @campaignShortlistAddedToast.
  ///
  /// In en, this message translates to:
  /// **'Channel added to the shortlist'**
  String get campaignShortlistAddedToast;

  /// No description provided for @campaignShortlistRemoveTooltip.
  ///
  /// In en, this message translates to:
  /// **'Remove from shortlist'**
  String get campaignShortlistRemoveTooltip;

  /// No description provided for @campaignShortlistSnapshotBrandPrice.
  ///
  /// In en, this message translates to:
  /// **'Brand paid {value}'**
  String campaignShortlistSnapshotBrandPrice(String value);

  /// No description provided for @campaignShortlistSnapshotInfluencerPayout.
  ///
  /// In en, this message translates to:
  /// **'Creator received {value}'**
  String campaignShortlistSnapshotInfluencerPayout(String value);

  /// No description provided for @campaignShortlistSnapshotMedianViews.
  ///
  /// In en, this message translates to:
  /// **'{value} median views'**
  String campaignShortlistSnapshotMedianViews(String value);

  /// No description provided for @campaignShortlistRemoveConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this channel?'**
  String get campaignShortlistRemoveConfirmTitle;

  /// No description provided for @campaignShortlistRemoveConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This only drops it from the shortlist — nothing about the channel itself changes.'**
  String get campaignShortlistRemoveConfirmBody;

  /// No description provided for @campaignShortlistRemovedToast.
  ///
  /// In en, this message translates to:
  /// **'Removed from the shortlist'**
  String get campaignShortlistRemovedToast;

  /// No description provided for @campaignShortlistAddDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a channel to the shortlist'**
  String get campaignShortlistAddDialogTitle;

  /// No description provided for @campaignShortlistChannelIdLabel.
  ///
  /// In en, this message translates to:
  /// **'Channel ID'**
  String get campaignShortlistChannelIdLabel;

  /// No description provided for @campaignShortlistChannelIdHint.
  ///
  /// In en, this message translates to:
  /// **'The channel\'s id, e.g. a YouTube channel id'**
  String get campaignShortlistChannelIdHint;

  /// No description provided for @campaignShortlistChannelIdRequired.
  ///
  /// In en, this message translates to:
  /// **'A channel id is required.'**
  String get campaignShortlistChannelIdRequired;

  /// No description provided for @campaignShortlistWhyFitLabel.
  ///
  /// In en, this message translates to:
  /// **'Why this fits (optional)'**
  String get campaignShortlistWhyFitLabel;

  /// No description provided for @campaignShortlistWhyFitHint.
  ///
  /// In en, this message translates to:
  /// **'What made this channel worth shortlisting'**
  String get campaignShortlistWhyFitHint;

  /// No description provided for @geminiBridgeStateStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get geminiBridgeStateStopped;

  /// No description provided for @geminiBridgeStateStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting…'**
  String get geminiBridgeStateStarting;

  /// No description provided for @geminiBridgeStateListening.
  ///
  /// In en, this message translates to:
  /// **'Listening on port {port} — waiting for the extension'**
  String geminiBridgeStateListening(String port);

  /// No description provided for @geminiBridgeStateConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected as {account}'**
  String geminiBridgeStateConnected(String account);

  /// No description provided for @geminiBridgeStateConnectedNoAccount.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get geminiBridgeStateConnectedNoAccount;

  /// No description provided for @geminiBridgeStateFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get geminiBridgeStateFailed;

  /// No description provided for @geminiBridgeFailure.
  ///
  /// In en, this message translates to:
  /// **'{code}: {message}'**
  String geminiBridgeFailure(String code, String message);

  /// No description provided for @geminiBridgeFailureHint.
  ///
  /// In en, this message translates to:
  /// **'Fix this in Settings → Gemini in browser.'**
  String get geminiBridgeFailureHint;

  /// No description provided for @geminiBridgeTitle.
  ///
  /// In en, this message translates to:
  /// **'Gemini in browser'**
  String get geminiBridgeTitle;

  /// No description provided for @geminiBridgeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Draft emails and generate keywords through the Gemini tab in Edge — no API key needed.'**
  String get geminiBridgeSubtitle;

  /// No description provided for @geminiBridgeNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'Not available on this platform — the bridge needs the desktop app with the Python pipeline.'**
  String get geminiBridgeNotAvailable;

  /// No description provided for @geminiBridgeModelLine.
  ///
  /// In en, this message translates to:
  /// **'Model: {model}'**
  String geminiBridgeModelLine(String model);

  /// No description provided for @geminiBridgeStart.
  ///
  /// In en, this message translates to:
  /// **'Start'**
  String get geminiBridgeStart;

  /// No description provided for @geminiBridgeStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get geminiBridgeStop;

  /// No description provided for @geminiBridgeTest.
  ///
  /// In en, this message translates to:
  /// **'Test'**
  String get geminiBridgeTest;

  /// No description provided for @geminiBridgeOpenGemini.
  ///
  /// In en, this message translates to:
  /// **'Open Gemini'**
  String get geminiBridgeOpenGemini;

  /// No description provided for @geminiBridgeRunDiagnostics.
  ///
  /// In en, this message translates to:
  /// **'Run diagnostics'**
  String get geminiBridgeRunDiagnostics;

  /// No description provided for @geminiBridgeCopyJson.
  ///
  /// In en, this message translates to:
  /// **'Copy JSON'**
  String get geminiBridgeCopyJson;

  /// No description provided for @geminiBridgeTestListening.
  ///
  /// In en, this message translates to:
  /// **'Daemon listening on port {port}'**
  String geminiBridgeTestListening(String port);

  /// No description provided for @geminiBridgeTestNotListening.
  ///
  /// In en, this message translates to:
  /// **'Daemon not listening'**
  String get geminiBridgeTestNotListening;

  /// No description provided for @geminiBridgeTestExtensionConnected.
  ///
  /// In en, this message translates to:
  /// **'Extension connected'**
  String get geminiBridgeTestExtensionConnected;

  /// No description provided for @geminiBridgeTestExtensionMissing.
  ///
  /// In en, this message translates to:
  /// **'Extension not connected — load it in Edge and check the port'**
  String get geminiBridgeTestExtensionMissing;

  /// No description provided for @geminiBridgeTestAccount.
  ///
  /// In en, this message translates to:
  /// **'Account: {account}'**
  String geminiBridgeTestAccount(String account);

  /// No description provided for @geminiBridgeTestAccountUnknown.
  ///
  /// In en, this message translates to:
  /// **'Account: unknown'**
  String get geminiBridgeTestAccountUnknown;

  /// No description provided for @geminiBridgeTestModel.
  ///
  /// In en, this message translates to:
  /// **'Model: {model}'**
  String geminiBridgeTestModel(String model);

  /// No description provided for @geminiBridgeTestModelUnknown.
  ///
  /// In en, this message translates to:
  /// **'Model: unknown'**
  String get geminiBridgeTestModelUnknown;

  /// No description provided for @geminiBridgeTestSignedOut.
  ///
  /// In en, this message translates to:
  /// **'The Gemini tab is signed out.'**
  String get geminiBridgeTestSignedOut;

  /// No description provided for @geminiBridgeTestSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Signed in'**
  String get geminiBridgeTestSignedIn;

  /// No description provided for @geminiBridgePortLabel.
  ///
  /// In en, this message translates to:
  /// **'Port'**
  String get geminiBridgePortLabel;

  /// No description provided for @geminiBridgePortInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a port between 1 and 65535.'**
  String get geminiBridgePortInvalid;

  /// No description provided for @geminiBridgeAccountMatchLabel.
  ///
  /// In en, this message translates to:
  /// **'Account must match (name or email)'**
  String get geminiBridgeAccountMatchLabel;

  /// No description provided for @geminiBridgeAccountMatchHint.
  ///
  /// In en, this message translates to:
  /// **'Blank: any signed-in account will do'**
  String get geminiBridgeAccountMatchHint;

  /// No description provided for @geminiBridgeGemHint.
  ///
  /// In en, this message translates to:
  /// **'Blank: plain chat with the skill file prepended'**
  String get geminiBridgeGemHint;

  /// No description provided for @geminiBridgeDefaultModelLabel.
  ///
  /// In en, this message translates to:
  /// **'Default model'**
  String get geminiBridgeDefaultModelLabel;

  /// No description provided for @geminiBridgeDefaultModelHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Pro — blank leaves the switcher as it is'**
  String get geminiBridgeDefaultModelHint;

  /// No description provided for @geminiBridgeSettingsSaved.
  ///
  /// In en, this message translates to:
  /// **'Gemini bridge settings saved.'**
  String get geminiBridgeSettingsSaved;

  /// No description provided for @geminiBridgeSettingsRestartHint.
  ///
  /// In en, this message translates to:
  /// **'A new port takes effect the next time the bridge starts.'**
  String get geminiBridgeSettingsRestartHint;

  /// No description provided for @geminiBridgeAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'Google account'**
  String get geminiBridgeAccountTitle;

  /// No description provided for @geminiBridgeSignedInAs.
  ///
  /// In en, this message translates to:
  /// **'Signed in as {account}'**
  String geminiBridgeSignedInAs(String account);

  /// No description provided for @geminiBridgeLastSeen.
  ///
  /// In en, this message translates to:
  /// **'Last seen signed in: {account}'**
  String geminiBridgeLastSeen(String account);

  /// No description provided for @geminiBridgeNoAccountSeen.
  ///
  /// In en, this message translates to:
  /// **'No account seen yet. Open Gemini and sign in once; it is remembered from then on.'**
  String get geminiBridgeNoAccountSeen;

  /// No description provided for @geminiBridgeUseAccount.
  ///
  /// In en, this message translates to:
  /// **'Use {email} for actions'**
  String geminiBridgeUseAccount(String email);

  /// No description provided for @geminiBridgeAccountPinned.
  ///
  /// In en, this message translates to:
  /// **'Actions use {account}.'**
  String geminiBridgeAccountPinned(String account);

  /// No description provided for @geminiBridgeBrowserTitle.
  ///
  /// In en, this message translates to:
  /// **'Browser'**
  String get geminiBridgeBrowserTitle;

  /// No description provided for @geminiBridgeBrowserLabel.
  ///
  /// In en, this message translates to:
  /// **'Open Gemini in'**
  String get geminiBridgeBrowserLabel;

  /// No description provided for @geminiBridgeBrowserFirefox.
  ///
  /// In en, this message translates to:
  /// **'Firefox (recommended)'**
  String get geminiBridgeBrowserFirefox;

  /// No description provided for @geminiBridgeBrowserEdge.
  ///
  /// In en, this message translates to:
  /// **'Microsoft Edge'**
  String get geminiBridgeBrowserEdge;

  /// No description provided for @geminiBridgeBrowserChrome.
  ///
  /// In en, this message translates to:
  /// **'Google Chrome'**
  String get geminiBridgeBrowserChrome;

  /// No description provided for @geminiBridgeBrowserSystem.
  ///
  /// In en, this message translates to:
  /// **'System default browser'**
  String get geminiBridgeBrowserSystem;

  /// No description provided for @geminiBridgeDetectBrowsers.
  ///
  /// In en, this message translates to:
  /// **'Detect browsers'**
  String get geminiBridgeDetectBrowsers;

  /// No description provided for @geminiBridgeBrowserFound.
  ///
  /// In en, this message translates to:
  /// **'{name} {version}'**
  String geminiBridgeBrowserFound(String name, String version);

  /// No description provided for @geminiBridgeBrowserNoneFound.
  ///
  /// In en, this message translates to:
  /// **'No supported browser was found on this PC.'**
  String get geminiBridgeBrowserNoneFound;

  /// No description provided for @geminiBridgeBrowserSelectedMissing.
  ///
  /// In en, this message translates to:
  /// **'The selected browser was not found on this PC.'**
  String get geminiBridgeBrowserSelectedMissing;

  /// No description provided for @geminiBridgeAddonMissing.
  ///
  /// In en, this message translates to:
  /// **'Add-on: not installed yet. It is added automatically when the Gemini window opens.'**
  String get geminiBridgeAddonMissing;

  /// No description provided for @geminiBridgeAddonTemporary.
  ///
  /// In en, this message translates to:
  /// **'Add-on: added for this browser session. It is added again automatically on every launch.'**
  String get geminiBridgeAddonTemporary;

  /// No description provided for @geminiBridgeAddonInstalled.
  ///
  /// In en, this message translates to:
  /// **'Add-on: installed.'**
  String get geminiBridgeAddonInstalled;

  /// No description provided for @geminiBridgeAddonOutdated.
  ///
  /// In en, this message translates to:
  /// **'Add-on: outdated. It is updated automatically on the next launch.'**
  String get geminiBridgeAddonOutdated;

  /// No description provided for @geminiBridgeAddonBlocked.
  ///
  /// In en, this message translates to:
  /// **'Add-on: blocked by Firefox because it is not signed.'**
  String get geminiBridgeAddonBlocked;

  /// No description provided for @geminiBridgeAddonUnknown.
  ///
  /// In en, this message translates to:
  /// **'Add-on: known once the browser runs.'**
  String get geminiBridgeAddonUnknown;

  /// No description provided for @geminiBridgeBrowserPathLabel.
  ///
  /// In en, this message translates to:
  /// **'Browser program (optional)'**
  String get geminiBridgeBrowserPathLabel;

  /// No description provided for @geminiBridgeBrowserPathHint.
  ///
  /// In en, this message translates to:
  /// **'Blank: found automatically'**
  String get geminiBridgeBrowserPathHint;

  /// No description provided for @geminiBridgeWindowLaunching.
  ///
  /// In en, this message translates to:
  /// **'Starting {browser}…'**
  String geminiBridgeWindowLaunching(String browser);

  /// No description provided for @geminiBridgeWindowInstalling.
  ///
  /// In en, this message translates to:
  /// **'Adding the Gemini add-on…'**
  String get geminiBridgeWindowInstalling;

  /// No description provided for @geminiBridgeAutoStartLabel.
  ///
  /// In en, this message translates to:
  /// **'Start the bridge when the app opens'**
  String get geminiBridgeAutoStartLabel;

  /// No description provided for @geminiBridgeAutoOpenLabel.
  ///
  /// In en, this message translates to:
  /// **'Open a Gemini window in the background when none is connected'**
  String get geminiBridgeAutoOpenLabel;

  /// No description provided for @geminiBridgeKeywordsGemLabel.
  ///
  /// In en, this message translates to:
  /// **'Keywords gem URL'**
  String get geminiBridgeKeywordsGemLabel;

  /// No description provided for @geminiBridgeExtensionFolderCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy the extension folder (load it once: extensions page, Developer mode, Load unpacked)'**
  String get geminiBridgeExtensionFolderCopy;

  /// No description provided for @geminiBridgeDiagnosticsTitle.
  ///
  /// In en, this message translates to:
  /// **'Diagnostics'**
  String get geminiBridgeDiagnosticsTitle;

  /// No description provided for @geminiBridgeDiagnosticsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Run diagnostics to see how each element on the Gemini page is found — and what to do when one is not.'**
  String get geminiBridgeDiagnosticsEmpty;

  /// No description provided for @geminiBridgeDiagnosticsRunning.
  ///
  /// In en, this message translates to:
  /// **'Asking the extension…'**
  String get geminiBridgeDiagnosticsRunning;

  /// No description provided for @geminiBridgeDiagnosticsJsonCopied.
  ///
  /// In en, this message translates to:
  /// **'Diagnostics JSON copied.'**
  String get geminiBridgeDiagnosticsJsonCopied;

  /// No description provided for @geminiBridgeDiagnosticsAllFound.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{The one element was found.} other{All {count} elements found.}}'**
  String geminiBridgeDiagnosticsAllFound(int count);

  /// No description provided for @geminiBridgeDiagnosticsMissing.
  ///
  /// In en, this message translates to:
  /// **'{missing} of {total} elements missing.'**
  String geminiBridgeDiagnosticsMissing(int missing, int total);

  /// No description provided for @geminiBridgeDiagnosticsPageChanged.
  ///
  /// In en, this message translates to:
  /// **'The page\'s components changed since the locators last worked.'**
  String get geminiBridgeDiagnosticsPageChanged;

  /// No description provided for @geminiBridgeElementFound.
  ///
  /// In en, this message translates to:
  /// **'Found'**
  String get geminiBridgeElementFound;

  /// No description provided for @geminiBridgeElementMissing.
  ///
  /// In en, this message translates to:
  /// **'Missing — none of the strategies matched'**
  String get geminiBridgeElementMissing;

  /// No description provided for @geminiBridgeElementStrategy.
  ///
  /// In en, this message translates to:
  /// **'Found by: {strategy}'**
  String geminiBridgeElementStrategy(String strategy);

  /// No description provided for @geminiBridgeElementTried.
  ///
  /// In en, this message translates to:
  /// **'Tried'**
  String get geminiBridgeElementTried;

  /// No description provided for @geminiBridgeTriedLine.
  ///
  /// In en, this message translates to:
  /// **'{strategy} — {matched} matched, {visible} visible'**
  String geminiBridgeTriedLine(String strategy, int matched, int visible);

  /// No description provided for @geminiBridgeElementLastKnown.
  ///
  /// In en, this message translates to:
  /// **'How it used to be found'**
  String get geminiBridgeElementLastKnown;

  /// No description provided for @geminiBridgeElementLastKnownNone.
  ///
  /// In en, this message translates to:
  /// **'Never found before on this machine.'**
  String get geminiBridgeElementLastKnownNone;

  /// No description provided for @geminiBridgeElementSuggestions.
  ///
  /// In en, this message translates to:
  /// **'Suggestions'**
  String get geminiBridgeElementSuggestions;

  /// No description provided for @geminiBridgeElementNoSuggestions.
  ///
  /// In en, this message translates to:
  /// **'No suggestions — the extension found nothing similar on the page.'**
  String get geminiBridgeElementNoSuggestions;

  /// No description provided for @geminiBridgeApplyFix.
  ///
  /// In en, this message translates to:
  /// **'Apply fix'**
  String get geminiBridgeApplyFix;

  /// No description provided for @geminiBridgeApplyingFix.
  ///
  /// In en, this message translates to:
  /// **'Applying…'**
  String get geminiBridgeApplyingFix;

  /// No description provided for @geminiBridgeFixApplied.
  ///
  /// In en, this message translates to:
  /// **'Fix applied to {element}; diagnostics re-run.'**
  String geminiBridgeFixApplied(String element);

  /// No description provided for @geminiKeywordsButton.
  ///
  /// In en, this message translates to:
  /// **'Generate keywords with Gemini'**
  String get geminiKeywordsButton;

  /// No description provided for @geminiKeywordsNotConnected.
  ///
  /// In en, this message translates to:
  /// **'The Gemini extension is not connected — see Settings → Gemini in browser.'**
  String get geminiKeywordsNotConnected;

  /// No description provided for @geminiKeywordsTitle.
  ///
  /// In en, this message translates to:
  /// **'Generate keywords'**
  String get geminiKeywordsTitle;

  /// No description provided for @geminiKeywordsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Long-tail YouTube search phrases from Gemini, deduped against everything already searched.'**
  String get geminiKeywordsSubtitle;

  /// No description provided for @geminiKeywordsTopicLabel.
  ///
  /// In en, this message translates to:
  /// **'Topic'**
  String get geminiKeywordsTopicLabel;

  /// No description provided for @geminiKeywordsTopicHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. AI coding tools for beginners'**
  String get geminiKeywordsTopicHint;

  /// No description provided for @geminiKeywordsTopicRequired.
  ///
  /// In en, this message translates to:
  /// **'A topic is required.'**
  String get geminiKeywordsTopicRequired;

  /// No description provided for @geminiKeywordsCountLabel.
  ///
  /// In en, this message translates to:
  /// **'How many'**
  String get geminiKeywordsCountLabel;

  /// No description provided for @geminiKeywordsLanguageLabel.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get geminiKeywordsLanguageLabel;

  /// No description provided for @geminiKeywordsLanguageHint.
  ///
  /// In en, this message translates to:
  /// **'Blank: English'**
  String get geminiKeywordsLanguageHint;

  /// No description provided for @geminiKeywordsStylesLabel.
  ///
  /// In en, this message translates to:
  /// **'Phrasing styles'**
  String get geminiKeywordsStylesLabel;

  /// No description provided for @geminiKeywordsStylesHint.
  ///
  /// In en, this message translates to:
  /// **'Comma separated, e.g. how to, best, review, vs'**
  String get geminiKeywordsStylesHint;

  /// No description provided for @geminiKeywordsExclusionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Exclude'**
  String get geminiKeywordsExclusionsLabel;

  /// No description provided for @geminiKeywordsExclusionsHint.
  ///
  /// In en, this message translates to:
  /// **'Sub-topics to leave out, comma or newline separated'**
  String get geminiKeywordsExclusionsHint;

  /// No description provided for @geminiKeywordsNotesLabel.
  ///
  /// In en, this message translates to:
  /// **'Notes for Gemini'**
  String get geminiKeywordsNotesLabel;

  /// No description provided for @geminiKeywordsAvoiding.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing to avoid yet — the list and the search history are empty.} =1{Avoiding 1 keyword already in the list or already searched.} other{Avoiding {count} keywords already in the list or already searched.}}'**
  String geminiKeywordsAvoiding(int count);

  /// No description provided for @geminiKeywordsGenerate.
  ///
  /// In en, this message translates to:
  /// **'Generate'**
  String get geminiKeywordsGenerate;

  /// No description provided for @geminiKeywordsGenerating.
  ///
  /// In en, this message translates to:
  /// **'Asking Gemini… this can take a minute.'**
  String get geminiKeywordsGenerating;

  /// No description provided for @geminiKeywordsResultCount.
  ///
  /// In en, this message translates to:
  /// **'{fresh, plural, =0{No new phrases} =1{1 new phrase} other{{fresh} new phrases}} · {known} already known or dropped as duplicates.'**
  String geminiKeywordsResultCount(int fresh, int known);

  /// No description provided for @geminiKeywordsAlreadyKnown.
  ///
  /// In en, this message translates to:
  /// **'Already in the list or already searched'**
  String get geminiKeywordsAlreadyKnown;

  /// No description provided for @geminiKeywordsSelectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all'**
  String get geminiKeywordsSelectAll;

  /// No description provided for @geminiKeywordsSelectNone.
  ///
  /// In en, this message translates to:
  /// **'Select none'**
  String get geminiKeywordsSelectNone;

  /// No description provided for @geminiKeywordsAdd.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Add to list} =1{Add 1 to list} other{Add {count} to list}}'**
  String geminiKeywordsAdd(int count);

  /// No description provided for @geminiKeywordsAdded.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Added 1 keyword to the list.} other{Added {count} keywords to the list.}}'**
  String geminiKeywordsAdded(int count);

  /// No description provided for @geminiKeywordsEmpty.
  ///
  /// In en, this message translates to:
  /// **'Gemini returned no keywords. Try a broader topic or fewer exclusions.'**
  String get geminiKeywordsEmpty;

  /// No description provided for @geminiKeywordsChatsLabel.
  ///
  /// In en, this message translates to:
  /// **'Separate chats'**
  String get geminiKeywordsChatsLabel;

  /// No description provided for @geminiKeywordsChatsHint.
  ///
  /// In en, this message translates to:
  /// **'1–8 · more chats, more variety'**
  String get geminiKeywordsChatsHint;

  /// No description provided for @geminiKeywordsProgress.
  ///
  /// In en, this message translates to:
  /// **'Chat {done} of {total} done · {keywords} keywords so far'**
  String geminiKeywordsProgress(int done, int total, int keywords);

  /// No description provided for @geminiKeywordsPartial.
  ///
  /// In en, this message translates to:
  /// **'{failed} of {total} chats failed — showing what the others found.'**
  String geminiKeywordsPartial(int failed, int total);

  /// No description provided for @geminiKeywordsChatFailed.
  ///
  /// In en, this message translates to:
  /// **'Chat {number}: {error}'**
  String geminiKeywordsChatFailed(int number, String error);

  /// No description provided for @geminiKeywordsBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get geminiKeywordsBack;

  /// No description provided for @navSkills.
  ///
  /// In en, this message translates to:
  /// **'Skills'**
  String get navSkills;

  /// No description provided for @skillsTitle.
  ///
  /// In en, this message translates to:
  /// **'Skills'**
  String get skillsTitle;

  /// No description provided for @skillsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Skills need a project folder to write to — open this on the desktop app with the pipeline set up.'**
  String get skillsUnavailable;

  /// No description provided for @skillsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No skills yet. A skill becomes a deck of cards that combine into one file for Gemini to read.'**
  String get skillsEmpty;

  /// No description provided for @skillsNewSkill.
  ///
  /// In en, this message translates to:
  /// **'New skill'**
  String get skillsNewSkill;

  /// No description provided for @skillsNameHint.
  ///
  /// In en, this message translates to:
  /// **'Skill name — also the file it exports as'**
  String get skillsNameHint;

  /// No description provided for @skillsDeleteSkill.
  ///
  /// In en, this message translates to:
  /// **'Delete skill'**
  String get skillsDeleteSkill;

  /// No description provided for @skillsDeleteSkillConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete \"{name}\" and every card in it? This does not remove the exported file already on disk.'**
  String skillsDeleteSkillConfirm(String name);

  /// No description provided for @skillsExportAll.
  ///
  /// In en, this message translates to:
  /// **'Re-export every skill'**
  String get skillsExportAll;

  /// No description provided for @skillsExportAllDone.
  ///
  /// In en, this message translates to:
  /// **'Every skill\'s file is up to date.'**
  String get skillsExportAllDone;

  /// No description provided for @skillsExportAllPartial.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 skill} other{{count} skills}} could not be exported.'**
  String skillsExportAllPartial(int count);

  /// No description provided for @skillsNeverExported.
  ///
  /// In en, this message translates to:
  /// **'Never exported'**
  String get skillsNeverExported;

  /// No description provided for @skillsLastExported.
  ///
  /// In en, this message translates to:
  /// **'Exported {date}'**
  String skillsLastExported(String date);

  /// No description provided for @skillsWordCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 word} other{{count} words}}'**
  String skillsWordCount(int count);

  /// No description provided for @skillsAddCard.
  ///
  /// In en, this message translates to:
  /// **'Add card'**
  String get skillsAddCard;

  /// No description provided for @skillsDeckEmpty.
  ///
  /// In en, this message translates to:
  /// **'No cards yet. Add one to start writing this skill.'**
  String get skillsDeckEmpty;

  /// No description provided for @skillsCardUntitled.
  ///
  /// In en, this message translates to:
  /// **'Untitled card'**
  String get skillsCardUntitled;

  /// No description provided for @skillsCardEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Empty'**
  String get skillsCardEmptyBody;

  /// No description provided for @skillsCardHeadingHint.
  ///
  /// In en, this message translates to:
  /// **'Card heading'**
  String get skillsCardHeadingHint;

  /// No description provided for @skillsCardBodyHint.
  ///
  /// In en, this message translates to:
  /// **'Write this card\'s prompt text. Type @ to reference another card — it is transcluded in full when this skill is exported.'**
  String get skillsCardBodyHint;

  /// No description provided for @skillsDeleteCard.
  ///
  /// In en, this message translates to:
  /// **'Delete card'**
  String get skillsDeleteCard;

  /// No description provided for @skillsDeleteCardConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete \"{heading}\"? Any \"@\" reference to it elsewhere will stop resolving.'**
  String skillsDeleteCardConfirm(String heading);

  /// No description provided for @skillsEditTab.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get skillsEditTab;

  /// No description provided for @skillsPreviewTab.
  ///
  /// In en, this message translates to:
  /// **'Preview'**
  String get skillsPreviewTab;

  /// No description provided for @skillsNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Name this card before closing it — an unnamed card is never exported.'**
  String get skillsNameRequired;

  /// No description provided for @skillsTeamOnlyToggle.
  ///
  /// In en, this message translates to:
  /// **'Team only — never exported to Gemini'**
  String get skillsTeamOnlyToggle;

  /// No description provided for @skillsTeamOnlyBadge.
  ///
  /// In en, this message translates to:
  /// **'Team only'**
  String get skillsTeamOnlyBadge;

  /// No description provided for @skillsCollapseAll.
  ///
  /// In en, this message translates to:
  /// **'Collapse all'**
  String get skillsCollapseAll;

  /// No description provided for @skillsExpandAll.
  ///
  /// In en, this message translates to:
  /// **'Expand all'**
  String get skillsExpandAll;

  /// No description provided for @skillsTogglePreview.
  ///
  /// In en, this message translates to:
  /// **'Show/hide preview'**
  String get skillsTogglePreview;

  /// No description provided for @skillsImport.
  ///
  /// In en, this message translates to:
  /// **'Import from a file'**
  String get skillsImport;

  /// No description provided for @skillsImportNothingToImport.
  ///
  /// In en, this message translates to:
  /// **'Every skill file in \"data/gemini skills\" is already a deck here.'**
  String get skillsImportNothingToImport;

  /// No description provided for @skillsImportDone.
  ///
  /// In en, this message translates to:
  /// **'Imported \"{name}\" as a new skill.'**
  String skillsImportDone(String name);

  /// No description provided for @skillsImportFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read that file.'**
  String get skillsImportFailed;

  /// No description provided for @skillsGemBlockTitle.
  ///
  /// In en, this message translates to:
  /// **'Gemini Gem'**
  String get skillsGemBlockTitle;

  /// No description provided for @skillsGemBlockNote.
  ///
  /// In en, this message translates to:
  /// **'Set up here and kept in this app. Never exported to the skill file, counted in its words or sent to Gemini in a prompt.'**
  String get skillsGemBlockNote;

  /// No description provided for @skillsGemNameCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Gem · name & description'**
  String get skillsGemNameCardTitle;

  /// No description provided for @skillsGemInstructionsCardTitle.
  ///
  /// In en, this message translates to:
  /// **'Gem · instructions'**
  String get skillsGemInstructionsCardTitle;

  /// No description provided for @skillsGemNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Gem name'**
  String get skillsGemNameLabel;

  /// No description provided for @skillsGemDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get skillsGemDescriptionLabel;

  /// No description provided for @skillsGemInstructionsLabel.
  ///
  /// In en, this message translates to:
  /// **'Instructions'**
  String get skillsGemInstructionsLabel;

  /// No description provided for @skillsGemInstructionsHint.
  ///
  /// In en, this message translates to:
  /// **'What this Gem should always do. Kept here, apart from the skill\'s cards.'**
  String get skillsGemInstructionsHint;

  /// No description provided for @skillsGemInstructionsWords.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{1 word} other{{count} words}}'**
  String skillsGemInstructionsWords(int count);

  /// No description provided for @skillsGemNotExportedBadge.
  ///
  /// In en, this message translates to:
  /// **'Not exported'**
  String get skillsGemNotExportedBadge;

  /// No description provided for @skillsGemNotExportedTooltip.
  ///
  /// In en, this message translates to:
  /// **'Stays in the app: never exported to the skill file, counted in its words or sent in a prompt.'**
  String get skillsGemNotExportedTooltip;

  /// No description provided for @skillsGemRoleLabel.
  ///
  /// In en, this message translates to:
  /// **'Used for: {role}'**
  String skillsGemRoleLabel(String role);

  /// No description provided for @skillsGemRoleTooltip.
  ///
  /// In en, this message translates to:
  /// **'Which Gem this skill sets up. A created Gem\'s link goes into that Gem\'s field in Settings.'**
  String get skillsGemRoleTooltip;

  /// No description provided for @skillsGemSyncUpToDate.
  ///
  /// In en, this message translates to:
  /// **'Up to date in Gemini'**
  String get skillsGemSyncUpToDate;

  /// No description provided for @skillsGemSyncPending.
  ///
  /// In en, this message translates to:
  /// **'Changes go to the Gem in Gemini automatically'**
  String get skillsGemSyncPending;

  /// No description provided for @skillsGemSyncWillCreate.
  ///
  /// In en, this message translates to:
  /// **'The Gem is created in Gemini automatically'**
  String get skillsGemSyncWillCreate;

  /// No description provided for @skillsGemSyncDefaults.
  ///
  /// In en, this message translates to:
  /// **'Edit these to create the Gem in Gemini automatically'**
  String get skillsGemSyncDefaults;

  /// No description provided for @skillsGemRoleKeywords.
  ///
  /// In en, this message translates to:
  /// **'Keywords'**
  String get skillsGemRoleKeywords;

  /// No description provided for @skillsGemAddAction.
  ///
  /// In en, this message translates to:
  /// **'Set up a Gem for this skill'**
  String get skillsGemAddAction;

  /// No description provided for @skillsGemAddDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Set up a Gem'**
  String get skillsGemAddDialogTitle;

  /// No description provided for @skillsGemAddDialogBody.
  ///
  /// In en, this message translates to:
  /// **'Which Gem does this skill configure?'**
  String get skillsGemAddDialogBody;

  /// No description provided for @myAppsTitle.
  ///
  /// In en, this message translates to:
  /// **'My apps'**
  String get myAppsTitle;

  /// No description provided for @myAppsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your other apps: open them, install them, or find them on GitHub and Google Play.'**
  String get myAppsSubtitle;

  /// No description provided for @myAppsRefresh.
  ///
  /// In en, this message translates to:
  /// **'Check again what is installed'**
  String get myAppsRefresh;

  /// No description provided for @myAppsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No apps listed yet. docs/MY_APPS.md says how to add one.'**
  String get myAppsEmpty;

  /// No description provided for @myAppsProblems.
  ///
  /// In en, this message translates to:
  /// **'Some entries in my_apps.json could not be read:'**
  String get myAppsProblems;

  /// No description provided for @myAppsOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get myAppsOpen;

  /// No description provided for @myAppsInstall.
  ///
  /// In en, this message translates to:
  /// **'Install'**
  String get myAppsInstall;

  /// No description provided for @myAppsDownloadApk.
  ///
  /// In en, this message translates to:
  /// **'Download APK'**
  String get myAppsDownloadApk;

  /// No description provided for @myAppsGooglePlay.
  ///
  /// In en, this message translates to:
  /// **'Google Play'**
  String get myAppsGooglePlay;

  /// No description provided for @myAppsGithub.
  ///
  /// In en, this message translates to:
  /// **'Open {repo} on GitHub'**
  String myAppsGithub(String repo);

  /// No description provided for @myAppsPrivateHelp.
  ///
  /// In en, this message translates to:
  /// **'Private repository: installing needs a GitHub sign-in (Accounts → GitHub) that can see it.'**
  String get myAppsPrivateHelp;

  /// No description provided for @myAppsInstalled.
  ///
  /// In en, this message translates to:
  /// **'Installed on this computer'**
  String get myAppsInstalled;

  /// No description provided for @myAppsNotInstalled.
  ///
  /// In en, this message translates to:
  /// **'Not installed on this computer'**
  String get myAppsNotInstalled;

  /// No description provided for @myAppsChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking the latest release…'**
  String get myAppsChecking;

  /// No description provided for @myAppsDownloadingStarted.
  ///
  /// In en, this message translates to:
  /// **'Downloading…'**
  String get myAppsDownloadingStarted;

  /// No description provided for @myAppsDownloading.
  ///
  /// In en, this message translates to:
  /// **'Downloading… {percent}%'**
  String myAppsDownloading(int percent);

  /// No description provided for @myAppsWaitingForInstaller.
  ///
  /// In en, this message translates to:
  /// **'The installer is open. Finish it there; Open appears here when it is done.'**
  String get myAppsWaitingForInstaller;

  /// No description provided for @myAppsInstallerStarted.
  ///
  /// In en, this message translates to:
  /// **'Installer started.'**
  String get myAppsInstallerStarted;

  /// No description provided for @myAppsOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not start {name}.'**
  String myAppsOpenFailed(String name);

  /// No description provided for @myAppsDownloadFailed.
  ///
  /// In en, this message translates to:
  /// **'The download did not finish. Try again.'**
  String get myAppsDownloadFailed;

  /// No description provided for @myAppsInstallerFailed.
  ///
  /// In en, this message translates to:
  /// **'The installer was downloaded but could not be started.'**
  String get myAppsInstallerFailed;

  /// No description provided for @myAppsNoInstaller.
  ///
  /// In en, this message translates to:
  /// **'The latest release of {name} has no Windows installer (a file ending in setup.exe). Opening the release page instead.'**
  String myAppsNoInstaller(String name);

  /// No description provided for @myAppsNoApk.
  ///
  /// In en, this message translates to:
  /// **'The latest release of {name} has no .apk file. Opening the release page instead.'**
  String myAppsNoApk(String name);

  /// No description provided for @myAppsNotVisible.
  ///
  /// In en, this message translates to:
  /// **'{repo} has no published release, or the GitHub account on this computer cannot see it. For a private repository, sign in under Accounts → GitHub with an account that has access.'**
  String myAppsNotVisible(String repo);

  /// No description provided for @myAppsTokenRejected.
  ///
  /// In en, this message translates to:
  /// **'GitHub rejected the saved sign-in. Sign in again under Accounts → GitHub.'**
  String get myAppsTokenRejected;

  /// No description provided for @myAppsUnreachable.
  ///
  /// In en, this message translates to:
  /// **'GitHub could not be reached. Check the connection and try again.'**
  String get myAppsUnreachable;

  /// No description provided for @outreachSendLater.
  ///
  /// In en, this message translates to:
  /// **'Send later'**
  String get outreachSendLater;

  /// No description provided for @outreachSendLaterInAnHour.
  ///
  /// In en, this message translates to:
  /// **'In an hour'**
  String get outreachSendLaterInAnHour;

  /// No description provided for @outreachSendLaterTomorrowMorning.
  ///
  /// In en, this message translates to:
  /// **'Tomorrow, 09:00'**
  String get outreachSendLaterTomorrowMorning;

  /// No description provided for @outreachSendLaterMondayMorning.
  ///
  /// In en, this message translates to:
  /// **'Monday, 09:00'**
  String get outreachSendLaterMondayMorning;

  /// No description provided for @outreachSendLaterZone.
  ///
  /// In en, this message translates to:
  /// **'Times are in {zone}.'**
  String outreachSendLaterZone(String zone);

  /// No description provided for @outreachSendLaterInPast.
  ///
  /// In en, this message translates to:
  /// **'That time has already passed.'**
  String get outreachSendLaterInPast;

  /// No description provided for @outreachSendLaterSchedule.
  ///
  /// In en, this message translates to:
  /// **'Schedule'**
  String get outreachSendLaterSchedule;

  /// No description provided for @outreachSendLaterHowItWorks.
  ///
  /// In en, this message translates to:
  /// **'The app sends it at that time while it is open. If it is closed then, you decide what happens when you next open it.'**
  String get outreachSendLaterHowItWorks;

  /// No description provided for @outreachSendLaterScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled for {when}.'**
  String outreachSendLaterScheduled(String when);

  /// No description provided for @outreachSendLaterSentTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled email to {handle} sent'**
  String outreachSendLaterSentTitle(String handle);

  /// No description provided for @outreachScheduledFor.
  ///
  /// In en, this message translates to:
  /// **'Scheduled for {when}'**
  String outreachScheduledFor(String when);

  /// No description provided for @outreachScheduledLate.
  ///
  /// In en, this message translates to:
  /// **'Was due {when}'**
  String outreachScheduledLate(String when);

  /// No description provided for @outreachScheduledFailed.
  ///
  /// In en, this message translates to:
  /// **'Not sent: {error}'**
  String outreachScheduledFailed(String error);

  /// No description provided for @outreachScheduledMaybeSent.
  ///
  /// In en, this message translates to:
  /// **'An earlier try stopped before Gmail answered, so it may already have gone out. Check the Sent folder in Gmail first.'**
  String get outreachScheduledMaybeSent;

  /// No description provided for @outreachScheduledSendNow.
  ///
  /// In en, this message translates to:
  /// **'Send now'**
  String get outreachScheduledSendNow;

  /// No description provided for @outreachScheduledSendAnyway.
  ///
  /// In en, this message translates to:
  /// **'Send anyway'**
  String get outreachScheduledSendAnyway;

  /// No description provided for @outreachScheduledChangeTime.
  ///
  /// In en, this message translates to:
  /// **'Change time'**
  String get outreachScheduledChangeTime;

  /// No description provided for @outreachScheduledEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get outreachScheduledEdit;

  /// No description provided for @outreachScheduledDontSend.
  ///
  /// In en, this message translates to:
  /// **'Don\'t send'**
  String get outreachScheduledDontSend;

  /// No description provided for @outreachScheduledCancelled.
  ///
  /// In en, this message translates to:
  /// **'The scheduled email will not be sent.'**
  String get outreachScheduledCancelled;

  /// No description provided for @outreachScheduledSentTo.
  ///
  /// In en, this message translates to:
  /// **'Sent to {to}.'**
  String outreachScheduledSentTo(String to);

  /// No description provided for @outreachScheduledBusy.
  ///
  /// In en, this message translates to:
  /// **'It is being sent right now.'**
  String get outreachScheduledBusy;

  /// No description provided for @outreachScheduledClearDraftFirst.
  ///
  /// In en, this message translates to:
  /// **'Send or clear the draft in the composer first.'**
  String get outreachScheduledClearDraftFirst;

  /// No description provided for @outreachScheduledBanner.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 scheduled email is waiting for a decision} other{{count} scheduled emails are waiting for a decision}}'**
  String outreachScheduledBanner(int count);

  /// No description provided for @outreachScheduledReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get outreachScheduledReview;

  /// No description provided for @outreachScheduledReviewTitle.
  ///
  /// In en, this message translates to:
  /// **'Scheduled emails waiting'**
  String get outreachScheduledReviewTitle;

  /// No description provided for @outreachScheduledReviewIntro.
  ///
  /// In en, this message translates to:
  /// **'These did not go out at their time: the app was closed, or sending failed. Nothing late is sent without you.'**
  String get outreachScheduledReviewIntro;

  /// No description provided for @outreachScheduledReviewEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing is waiting.'**
  String get outreachScheduledReviewEmpty;

  /// No description provided for @outreachScheduledChipTooltip.
  ///
  /// In en, this message translates to:
  /// **'Email scheduled for {when}'**
  String outreachScheduledChipTooltip(String when);

  /// No description provided for @influencerSearchScopeTooltip.
  ///
  /// In en, this message translates to:
  /// **'Search in: {scopes}'**
  String influencerSearchScopeTooltip(String scopes);

  /// No description provided for @influencerSearchScopeNames.
  ///
  /// In en, this message translates to:
  /// **'Names and handles'**
  String get influencerSearchScopeNames;

  /// No description provided for @influencerSearchScopeChannelDescriptions.
  ///
  /// In en, this message translates to:
  /// **'Channel descriptions'**
  String get influencerSearchScopeChannelDescriptions;

  /// No description provided for @influencerSearchScopeVideoDescriptions.
  ///
  /// In en, this message translates to:
  /// **'Video descriptions'**
  String get influencerSearchScopeVideoDescriptions;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ar', 'en'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'en':
      return AppLocalizationsEn();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
