// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'Gratovo IMA ToolBox';

  @override
  String get navDashboard => 'الرئيسية';

  @override
  String get navSearch => 'البحث';

  @override
  String get navRoster => 'السجل';

  @override
  String get navInfluencers => 'المؤثرون';

  @override
  String get navBrands => 'العلامات التجارية';

  @override
  String get navDeals => 'الصفقات';

  @override
  String get navOutreach => 'التواصل';

  @override
  String get navSettings => 'الإعدادات';

  @override
  String get navNews => 'الأخبار';

  @override
  String get newsTitle => 'أخبار المجال';

  @override
  String get newsAllSources => 'كل المصادر';

  @override
  String get newsAllNiches => 'كل المجالات';

  @override
  String get newsEmpty =>
      'لا يوجد شيء مخزّن بعد. شغّل `python tools/news.py --refresh` على جهاز التشغيل لجلب الخلاصات.';

  @override
  String get newsNoMatches => 'لا توجد أخبار من هذا المصدر بعد.';

  @override
  String get newsOpenArticle => 'اقرأ المقال';

  @override
  String get newsUndated => 'بلا تاريخ';

  @override
  String newsBySource(String value) {
    return '$value';
  }

  @override
  String get newsRefresh => 'اجلب الخلاصات الآن';

  @override
  String get newsRefreshStarted => 'جارٍ جلب الخلاصات…';

  @override
  String get newsRefreshFinished => 'تم تحديث الخلاصات.';

  @override
  String get newsRefreshFailed => 'تعذر جلب الخلاصات.';

  @override
  String get newsRefreshDesktopOnly =>
      'يجلب جهاز التشغيل الخلاصات. لا يُسمح للمتصفح بقراءتها مباشرة، ولهذا تُخزَّن الأخبار بدل تحميلها مباشرة.';

  @override
  String get newsSourcesTitle => 'الخلاصات';

  @override
  String get newsSourceFailing => 'فشل جلب هذه الخلاصة آخر مرة';

  @override
  String get newsSourceDisabled => 'لا يتم جلبها';

  @override
  String newsSourceLastFetched(String date) {
    return 'جُلبت $date';
  }

  @override
  String get newsSourceNeverFetched => 'لم تُجلب أبداً';

  @override
  String get newsAddSourceTitle => 'إضافة خلاصة';

  @override
  String get newsAddSourceUrl => 'رابط الخلاصة';

  @override
  String get newsAddSourceUrlHint => 'https://example.com/feed/';

  @override
  String get newsAddSourceUrlInvalid => 'هذا ليس رابط http(s) صالحاً.';

  @override
  String get newsAddSourceNiche => 'المجال (اختياري)';

  @override
  String get newsAddSourceTitleField => 'الاسم (اختياري)';

  @override
  String get newsAddSourceTitleHelp =>
      'إن تُرك فارغاً، تسمّي الخلاصة نفسها عند أول جلب ناجح.';

  @override
  String get newsAddSourceSubmit => 'إضافة';

  @override
  String get newsAddSourceAdded => 'تمت الإضافة. اجلب الخلاصات لسحب أخبارها.';

  @override
  String get newsAddSourceFailed => 'تعذرت إضافة الخلاصة.';

  @override
  String get newsRemoveSource => 'حذف الخلاصة';

  @override
  String get newsRemoveSourceConfirm =>
      'حذف هذه الخلاصة وكل أخبارها؟ لا يمكن استرجاع الأخبار إلا بجلبها مجدداً.';

  @override
  String get newsSourceEnable => 'اجلب هذه الخلاصة';

  @override
  String get newsSourceDisable => 'أوقف جلب هذه الخلاصة';

  @override
  String get newsSinceLastFetch => 'أخبار جديدة منذ آخر جلب';

  @override
  String get newsClearAll => 'امسح الأخبار المخزّنة';

  @override
  String get newsClearAllConfirm =>
      'حذف كل الأخبار المخزّنة؟ تبقى الخلاصات كما هي ويعيد الجلب التالي سحبها كلها. هذا موجود لاختبار شارة الأخبار الجديدة.';

  @override
  String get newsClearAllDone => 'تم مسح الأخبار المخزّنة.';

  @override
  String get newsClearAllFailed => 'تعذّر مسح الأخبار المخزّنة.';

  @override
  String get dashboardWelcomeTitle => 'أهلاً بعودتك';

  @override
  String get dashboardWelcomeUser => 'أهلاً بعودتك، ';

  @override
  String get dashboardWelcomeBody =>
      'إليك وضع مسار العمل الآن: المؤثرون الجدد، المفاوضات الجارية، متابعات التواصل القادمة، وما يعمل عليه الفريق حالياً.';

  @override
  String comingSoonTitle(String pageName) {
    return '$pageName قريباً';
  }

  @override
  String get comingSoonBody =>
      'هذه الصفحة جاهزة للتنقل إليها، لكن سيتم بناء محتواها الفعلي في مرحلة لاحقة من إعادة البناء.';

  @override
  String get desktopOnlyNotice =>
      'هذه الميزة متاحة فقط في نسخة سطح المكتب، حيث يعمل نظام البحث والمصادر.';

  @override
  String get themeModeLight => 'فاتح';

  @override
  String get themeModeDark => 'داكن';

  @override
  String get themeModeSystem => 'حسب النظام';

  @override
  String get languageEnglish => 'الإنجليزية';

  @override
  String get languageArabic => 'العربية';

  @override
  String get commonError => 'حدث خطأ ما.';

  @override
  String get commonRetry => 'إعادة المحاولة';

  @override
  String get dashboardNewFinds => 'اكتشافات جديدة';

  @override
  String get dashboardActiveNegotiations => 'مفاوضات جارية';

  @override
  String get dashboardEmailsSentToday => 'رسائل أُرسلت اليوم';

  @override
  String get dashboardDraftedToday => 'مسودات اليوم';

  @override
  String dashboardOfTarget(String count, String target) {
    return '$count من $target';
  }

  @override
  String get dashboardRosterReady => 'جاهزون للعرض على العلامات';

  @override
  String get dashboardUpcomingRemindersTitle => 'التذكيرات القادمة';

  @override
  String get dashboardNoReminders =>
      'لا توجد تذكيرات مستحقة — كل شيء تحت السيطرة.';

  @override
  String dashboardReminderDue(String date) {
    return 'الاستحقاق $date';
  }

  @override
  String dashboardNewsNewCount(int count) {
    return '$count جديدة';
  }

  @override
  String dashboardArchiveDueCount(String count) {
    return '+$count بانتظار الأرشفة';
  }

  @override
  String get dashboardNewsPeekEmpty => 'لا أخبار بعد';

  @override
  String get dashboardLogsPeekEmpty => 'لا نشاط بعد';

  @override
  String get vettingStatusNewlyFound => 'جديد';

  @override
  String get vettingStatusShortlisted => 'على القائمة المختصرة';

  @override
  String get vettingStatusRejected => 'مرفوض';

  @override
  String get dealStageProposed => 'مقترحة';

  @override
  String get dealStageNegotiating => 'قيد التفاوض';

  @override
  String get dealStageAgreed => 'تم الاتفاق';

  @override
  String get dealStageContractSent => 'تم إرسال العقد';

  @override
  String get dealStageSigned => 'تم التوقيع';

  @override
  String get dealStageLive => 'قيد التنفيذ';

  @override
  String get dealStageClosed => 'مكتملة';

  @override
  String get dealStageLost => 'خسرناها';

  @override
  String get influencerListEmpty =>
      'لا يوجد مؤثرون بعد — قم بإجراء بحث للعثور عليهم.';

  @override
  String get influencerListFilterAll => 'الكل';

  @override
  String get influencerListSortLabel => 'الترتيب حسب';

  @override
  String get influencerListSortSubscribers => 'المشتركون';

  @override
  String get influencerListSortRecentActivity => 'النشاط الأخير';

  @override
  String get influencerListSortAverageViews => 'وسيط المشاهدات (٣٠ يومًا)';

  @override
  String influencerSubscribersCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString مشترك';
  }

  @override
  String influencerFoundVia(String keywords) {
    return 'تم العثور عليه عبر: $keywords';
  }

  @override
  String get influencerNotFound => 'لم يتم العثور على المؤثر.';

  @override
  String get influencerProfileSubscribers => 'المشتركون';

  @override
  String get influencerProfileMedianViews30 => 'وسيط المشاهدات · ٣٠ يومًا';

  @override
  String get influencerProfileMedianViewsAll => 'وسيط المشاهدات · كل المخزَّن';

  @override
  String get influencerProfileCountry => 'الدولة';

  @override
  String get influencerProfileLastVideo => 'آخر فيديو';

  @override
  String get influencerProfileVettingLabel => 'حالة الفرز';

  @override
  String get influencerProfileRecentVideosTitle => 'أحدث الفيديوهات';

  @override
  String get influencerProfileRefreshVideos => 'تحديث';

  @override
  String get influencerProfileRefreshStarted => 'جارٍ تحديث أحدث الفيديوهات…';

  @override
  String get influencerProfileRefreshFailed =>
      'تعذّر تحديث فيديوهات هذه القناة.';

  @override
  String get influencerProfileNoVideos => 'لا توجد فيديوهات حديثة بعد.';

  @override
  String get influencerProfileDetailsSyncing =>
      'جارٍ مزامنة التفاصيل — عُثر على هذه القناة على جهاز زميل ولم تصل فيديوهاتها إلى هذا الجهاز بعد.';

  @override
  String get influencerDetailsSyncingShort => 'جارٍ مزامنة التفاصيل…';

  @override
  String get dashboardSearchingTitle => 'يبحث الآن';

  @override
  String dashboardSearchingLine(String name, String keyword, int count) {
    return '$name · $keyword · $count تم العثور عليها';
  }

  @override
  String dashboardSearchingBlockedLine(
      String name, String reason, int seconds) {
    return '$name · $reason — إعادة المحاولة خلال $seconds ثانية';
  }

  @override
  String get searchBackoffReasonRateLimited =>
      'تم رفض عنوان IP / محدودية المعدل';

  @override
  String get searchBackoffReasonCaptcha => 'تم الحظر بواسطة اختبار CAPTCHA';

  @override
  String get influencerProfileRelevanceCriteriaTitle =>
      'ما الذي أبحث عنه في فيديوهات هذه القناة';

  @override
  String get influencerProfileRelevanceCriteriaHint =>
      'مثال: ذكر الرعاية، تكرار النشر';

  @override
  String get influencerProfileAddCriterion => 'إضافة';

  @override
  String get influencerProfileNotesTitle => 'ملاحظات';

  @override
  String get influencerProfileNotesHint =>
      'ملاحظات للصفقات المستقبلية مع هذه القناة';

  @override
  String get influencerProfileSaveNotes => 'حفظ الملاحظات';

  @override
  String get influencerProfileNotesSaved => 'تم حفظ الملاحظات.';

  @override
  String get influencerProfileDealHistoryTitle => 'سجل الصفقات';

  @override
  String get influencerProfileNoDeals => 'لا توجد صفقات بعد مع هذا المؤثر.';

  @override
  String get influencerProfileOpenChannel => 'فتح القناة';

  @override
  String influencerProfileLastUpdated(String date) {
    return 'تحديث بيانات القناة $date';
  }

  @override
  String get influencerProfileNeverUpdated => 'لم يتم التحديث أبداً';

  @override
  String get influencerProfileVideosThisMonth => 'فيديوهات هذا الشهر';

  @override
  String get influencerProfileStageTitle => 'التقدم والوسوم';

  @override
  String get influencerProfileStageLabel => 'مرحلة المسار';

  @override
  String get influencerProfileChannelTagsLabel => 'وسوم القناة';

  @override
  String get influencerProfileAddTagHint => 'مثال: تقنية، لياقة';

  @override
  String get influencerProfileSaveFailed => 'تعذر حفظ التغيير.';

  @override
  String get influencerProfilePullMonths => 'عدد الأشهر';

  @override
  String get influencerProfilePullMore => 'اسحب المزيد';

  @override
  String get influencerProfilePullStarted =>
      'بدأ السحب — تابع التقدم من صفحة البحث.';

  @override
  String get influencerProfilePullAlreadyRunning =>
      'هناك عملية سحب قيد التنفيذ بالفعل — انتظر حتى تنتهي ثم أعد المحاولة.';

  @override
  String get influencerProfilePullSearchRunning =>
      'هناك بحث قيد التنفيذ — انتظر حتى ينتهي ثم أعد المحاولة.';

  @override
  String get influencerProfilePullFailed => 'تعذر بدء السحب.';

  @override
  String get influencerProfileCrmTitle => 'قيمة الفيديو الواحد';

  @override
  String get influencerProfileCrmBasis => 'الأساس';

  @override
  String influencerProfileCrmIncluded(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString فيديو مضمّن';
  }

  @override
  String influencerProfileCrmUnusable(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString بلا عدد مشاهدات ولا يمكن استخدامها';
  }

  @override
  String get influencerProfileCrmSelectAll => 'تحديد الكل';

  @override
  String get influencerProfileCrmSelectNone => 'إلغاء التحديد';

  @override
  String get influencerProfileCrmMedian => 'وسيط المشاهدات';

  @override
  String get influencerProfileCrmAverage => 'متوسط المشاهدات';

  @override
  String get influencerProfileCrmRange => 'المدى';

  @override
  String get influencerProfileCrmUploadRate => 'فيديوهات / شهر';

  @override
  String get influencerProfileCrmSkewWarning =>
      'المتوسط أعلى بكثير من الوسيط — فيديو أو اثنان يرفعانه. اعتمد على الوسيط.';

  @override
  String get influencerProfileCrmPrice => 'السعر';

  @override
  String get influencerProfileCrmCpm => 'التكلفة لكل ألف';

  @override
  String get cpmNicheLabel => 'المجال (نطاق التكلفة لكل ألف)';

  @override
  String cpmNicheLine(String niche, String low, String high, String lowPrice,
      String highPrice) {
    return '$niche: \$$low-$high لكل ألف مشاهدة، أي \$$lowPrice-$highPrice لهذه القناة';
  }

  @override
  String get cpmSliderHelp =>
      'حرّك المؤشر لتجربة تكلفة لكل ألف ضمن النطاق؛ والسعر يتبعها.';

  @override
  String get cpmNicheTech => 'التقنية';

  @override
  String get cpmNicheFinance => 'المال';

  @override
  String get cpmNicheFitness => 'اللياقة';

  @override
  String get cpmNicheEntertainment => 'الترفيه';

  @override
  String get cpmNicheGaming => 'الألعاب';

  @override
  String get cpmNicheBeauty => 'الجمال';

  @override
  String get cpmNicheTravel => 'السفر';

  @override
  String get cpmNicheEducation => 'التعليم';

  @override
  String get cpmNicheFood => 'الطعام';

  @override
  String get cpmNicheLuxury => 'الفخامة';

  @override
  String get brandNew => 'علامة تجارية جديدة';

  @override
  String get brandEdit => 'تعديل العلامة التجارية';

  @override
  String get brandFormName => 'اسم العلامة التجارية';

  @override
  String get brandFormNameRequired => 'تحتاج العلامة التجارية إلى اسم.';

  @override
  String get brandFormWebsite => 'الموقع الإلكتروني';

  @override
  String get brandFormCategory => 'ماذا تبيع';

  @override
  String get brandFormCountry => 'الدولة (حرفان)';

  @override
  String get brandFormCountryInvalid => 'حرفان، مثل US.';

  @override
  String get brandFormBudget => 'الميزانية';

  @override
  String get brandFormCurrency => 'العملة';

  @override
  String get brandFormContacts => 'جهات الاتصال';

  @override
  String get brandFormContactName => 'الاسم';

  @override
  String get brandFormContactEmail => 'البريد الإلكتروني';

  @override
  String get brandFormContactRole => 'الدور';

  @override
  String get brandFormContactPrimary => 'راسل هذا أولًا';

  @override
  String get brandFormAddContact => 'أضف جهة اتصال';

  @override
  String get brandFormRemoveContact => 'إزالة';

  @override
  String get brandFormEmailInvalid => 'ليس عنوان بريد إلكتروني.';

  @override
  String get brandFormBrief => 'ملخص الحملة';

  @override
  String get brandSaved => 'حُفظت العلامة التجارية.';

  @override
  String brandBoycottCountry(String country) {
    return 'دولة مقاطَعة ($country): لا عرض ولا صانع محتوى لهذه العلامة التجارية.';
  }

  @override
  String brandBoycottBrand(String brand) {
    return 'على قائمة المقاطعة ($brand): لا عرض ولا صانع محتوى لهذه العلامة التجارية.';
  }

  @override
  String get brandSourceSeen => 'وُجدت ترعى صنّاع محتوى';

  @override
  String get brandSourceLabel => 'كيف وجدناها';

  @override
  String get seenBrandsTitle => 'علامات تجارية شوهدت ترعى';

  @override
  String get seenBrandsSubtitle =>
      'علامات تجارية وُجدت في سطور الرعاية في مقاطع صنّاع المحتوى. نقرة واحدة تنشئ سجلًا لها.';

  @override
  String seenBrandsSummary(int brands, int channels) {
    String _temp0 = intl.Intl.pluralLogic(
      brands,
      locale: localeName,
      other: '$brands علامة',
      one: 'علامة واحدة',
    );
    String _temp1 = intl.Intl.pluralLogic(
      channels,
      locale: localeName,
      other: '$channels قناة',
      one: 'قناة واحدة',
    );
    return '$_temp0 عبر $_temp1';
  }

  @override
  String get seenBrandsEmpty => 'لم تُوجد رعايات في المقاطع المخزّنة بعد.';

  @override
  String seenBrandsChannels(int count, String handles) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count قنوات',
      one: 'قناة واحدة',
    );
    return '$_temp0: $handles';
  }

  @override
  String seenBrandsLatest(String date) {
    return 'أحدث مقطع بينها: $date';
  }

  @override
  String get seenBrandsSaved => 'محفوظة';

  @override
  String get seenBrandsCreate => 'أنشئ علامة تجارية';

  @override
  String seenBrandsShowAll(int count) {
    return 'اعرض الكل ($count)';
  }

  @override
  String get seenBrandsShowFewer => 'اعرض أقل';

  @override
  String get dealStart => 'ابدأ صفقة';

  @override
  String dealStartTitle(String handle) {
    return 'ابدأ صفقة مع $handle';
  }

  @override
  String get dealStarted => 'بدأت الصفقة.';

  @override
  String get dealFormBrand => 'العلامة التجارية';

  @override
  String get dealFormBrandRequired => 'اختر علامة تجارية.';

  @override
  String get dealFormBrandPrice => 'تدفع العلامة التجارية';

  @override
  String get dealFormPayout => 'يحصل صانع المحتوى على';

  @override
  String get dealFormCurrency => 'العملة';

  @override
  String get dealFormDeliverables => 'المخرجات';

  @override
  String get dealFormDeadline => 'الموعد النهائي';

  @override
  String get dealFormPickDate => 'اختر تاريخًا';

  @override
  String get dealFormPaymentTerms => 'شروط الدفع';

  @override
  String get dealFormPaymentTermsHint =>
      'تُحدَّد لكل صفقة، مثلًا 50% مقدمًا و50% عند النشر';

  @override
  String get dealFormTrackingLink => 'رابط التتبع';

  @override
  String get dealFormNumberRequired => 'أدخل مبلغًا.';

  @override
  String get dealEditTerms => 'تعديل الشروط';

  @override
  String get dealTermsSaved => 'حُفظت الشروط.';

  @override
  String dealPaymentTermsLine(String terms) {
    return 'شروط الدفع: $terms';
  }

  @override
  String get dealPaymentTermsNone => 'لم تُحدَّد شروط الدفع بعد';

  @override
  String dealTrackingLinkLine(String link) {
    return 'رابط التتبع: $link';
  }

  @override
  String get dealContractsTitle => 'العقود';

  @override
  String get dealContractCreator => 'عقد صانع المحتوى';

  @override
  String get dealContractBrand => 'عقد العلامة التجارية';

  @override
  String get dealContractOrderNote =>
      'عقد العلامة التجارية هو القالب. يوقّع صانع المحتوى أولًا، ثم العلامة التجارية.';

  @override
  String get contractStatusNone => 'لم يبدأ';

  @override
  String get contractStatusDraft => 'مسودة';

  @override
  String get contractStatusSent => 'أُرسل';

  @override
  String get contractStatusSigned => 'موقَّع';

  @override
  String dealContractSignedOn(String date) {
    return 'وُقّع في $date';
  }

  @override
  String get dealContractUpdate => 'تحديث';

  @override
  String get dealContractUrl => 'رابط العقد';

  @override
  String get dealContractStatus => 'الحالة';

  @override
  String get dealContractBrandWaits =>
      'توقّع العلامة التجارية بعد صانع المحتوى.';

  @override
  String get dealContractSaved => 'حُفظ العقد.';

  @override
  String get navComms => 'قائمة المراسلات';

  @override
  String commsToday(int sent, int target) {
    return '$sent من $target اليوم';
  }

  @override
  String commsMailboxLeft(int left) {
    return 'متبقٍّ في صندوق البريد اليوم: $left';
  }

  @override
  String get commsSectionReplies => 'ردود جديدة';

  @override
  String get commsSectionFollowUps => 'متابعات مستحقة';

  @override
  String get commsSectionDecisions => 'قرارات';

  @override
  String get commsSectionNewOutreach => 'تواصل جديد';

  @override
  String get commsSectionEmpty => 'لا شيء هنا الآن.';

  @override
  String get commsDraft => 'صِغ';

  @override
  String get commsDrafting => 'تجري الصياغة مع Gemini. يستغرق ذلك بضع دقائق.';

  @override
  String commsDraftFailed(String error) {
    return 'لم تعد المسودة: $error';
  }

  @override
  String commsFollowUpNumber(int number) {
    return 'المتابعة $number من 3';
  }

  @override
  String get commsKindFirst => 'رسالة أولى';

  @override
  String get commsKindReply => 'رد';

  @override
  String get commsKindFollowUp => 'متابعة';

  @override
  String get commsKindDecision => 'قرار';

  @override
  String get commsNeedsYou => 'يحتاجك';

  @override
  String get commsBlocked => 'غير قابل للإرسال';

  @override
  String get commsLessons => 'الدروس المستخدمة';

  @override
  String get commsSubject => 'الموضوع';

  @override
  String get commsBody => 'الرسالة';

  @override
  String get commsSend => 'أرسل';

  @override
  String get commsEdit => 'عدّل';

  @override
  String get commsDoneEditing => 'تم';

  @override
  String get commsRedo => 'أعد';

  @override
  String get commsSkip => 'تخطَّ';

  @override
  String get commsSent => 'أُرسلت.';

  @override
  String commsTo(String address) {
    return 'إلى: $address';
  }

  @override
  String get commsRecipientUnconfirmed =>
      'وُجد هذا العنوان على قناتهم ولم يؤكده أحد. تحقّق منه، أو أضف العنوان الصحيح إلى جهات اتصالهم، قبل الإرسال.';

  @override
  String get commsSkipped => 'تم التخطي.';

  @override
  String get commsNoRecipient =>
      'لا يوجد بريد إلكتروني لهم بعد. أضف واحدًا في جهات اتصالهم أولًا.';

  @override
  String commsSendError(String error) {
    return 'لم تُرسَل: $error';
  }

  @override
  String commsSentNotRecorded(String error) {
    return 'أُرسلت، لكن تعذّرت إضافتها إلى المحادثة: $error. لن تُعرض للإرسال مرة أخرى؛ أضفها إلى المحادثة يدويًا.';
  }

  @override
  String get commsCheckFailed => 'لم يجتز النص الفحوص. لم يُرسل شيء.';

  @override
  String get commsGatesTitle => 'أكّد قبل الإرسال';

  @override
  String get commsGatesBody => 'تحتاج هذه الرسالة موافقة شخص على:';

  @override
  String get commsConfirmSend => 'أكّد وأرسل';

  @override
  String get commsNothingToSend =>
      'يقول المحرك إنه لا شيء يحتاج إلى إرسال الآن.';

  @override
  String get commsSteerTitle => 'وجّه وأعد';

  @override
  String get commsSteerHelp =>
      'تصحيحات اختيارية لما قرأه المحرك. اترك ما هو صحيح كما هو.';

  @override
  String get commsSteerAsRead => 'كما قُرئ';

  @override
  String get commsSteerNote => 'أي شيء آخر يجب أن يعرفه المحرك';

  @override
  String get commsSteerMore => 'المزيد';

  @override
  String get commsSteerCash => 'اسمح بعرض مالي مباشر لهذه الحالة فقط';

  @override
  String get commsSteerCashHelp =>
      'اختيار الوكالة HC-10: مُطفأ افتراضيًا؛ يمكن لشخص تشغيله لحالة واحدة.';

  @override
  String get steerReader => 'من يقرأ';

  @override
  String steerReaderOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'creator': 'صانع المحتوى',
        'manager': 'مدير صانع المحتوى / وكالته',
        'brand': 'علامة تجارية',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerStage => 'ما هذه الرسالة';

  @override
  String steerStageOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'first': 'رسالة أولى',
        'fu1': 'متابعة 1',
        'fu2': 'متابعة 2',
        'closing': 'آخر متابعة (إغلاق)',
        'reply': 'رد على ردهم',
        'reengage': 'إعادة إحياء تواصل قديم',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerChannel => 'القناة';

  @override
  String steerChannelOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'email': 'بريد إلكتروني',
        'dm': 'رسالة إنستغرام',
        'linkedin': 'رسالة لينكدإن',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerHave => 'ما لدي';

  @override
  String steerHaveOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'nothing': 'لا شيء بعد',
        'roster': 'صنّاع محتوى في قائمتي',
        'brand': 'علامة تجارية جاهزة',
        'deal': 'صفقة بميزانية',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerInmind => 'علامات في البال';

  @override
  String steerInmindOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'none': 'لا شيء',
        'yes': 'نعم، علامات تناسبهم',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerState => 'رعاتهم';

  @override
  String steerStateOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'unknown': 'غير معروف',
        'unsponsored': 'لا رعاة مؤخرًا',
        'some': 'بعض الرعاة',
        'full': 'كل مقطع برعاية',
        'own': 'يبيعون منتجهم',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerPitch => 'ما أعرضه';

  @override
  String steerPitchOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'one': 'صانع محتوى واحد',
        'several': 'عدة صنّاع محتوى',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerProof => 'صفقات منجزة / دراسات حالة';

  @override
  String steerProofOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'none': 'لا شيء بعد',
        'some': 'لدي بعضها',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBtype => 'نوع العلامة التجارية';

  @override
  String steerBtypeOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'active': 'تدير حملات مؤثرين بالفعل',
        'never': 'لم تجرّب تسويق المؤثرين',
        'b2b': 'B2B / SaaS / برمجيات',
        'apps': 'تطبيقات / ألعاب',
        'ecom': 'تجارة إلكترونية / DTC',
        'affiliate': 'تسويق بالعمولة / هدايا فقط',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBsize => 'حجم العلامة التجارية';

  @override
  String steerBsizeOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'small': 'صغيرة (50 موظفًا أو أقل)',
        'big': 'كبيرة',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerCreply => 'ردهم';

  @override
  String steerCreplyOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'interested': 'مهتم',
        'which': 'أي علامة؟ ما التفاصيل؟',
        'kit': 'أرسل ملف الوسائط / الإحصاءات',
        'who': 'من أنتم؟ أرسلوا موقعكم',
        'budget': 'ما الميزانية؟',
        'affiliate': 'عمولة فقط / يريد مبلغًا ثابتًا',
        'gifting': 'أرسلوا المنتج (هدية)',
        'manager': 'مديري يتولى هذا',
        'notint': 'غير مهتم',
        'silent': 'ردّ ثم صمت',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerBreply => 'ردهم';

  @override
  String steerBreplyOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'creators': 'أرسلوا صنّاع محتوى / من لديكم؟',
        'budget': 'تذكر ميزانيتها أو أسعارها',
        'cases': 'تطلب دراسات حالة',
        'notnow': 'ليس الآن / ربما الشهر القادم',
        'ignored': 'تجاهلت سؤال السعر',
        'kit': 'تطلب ملف وسائط',
        'affiliate': 'نعمل بالعمولة / الهدايا فقط',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get steerEnglish => 'مستوى إنجليزيتهم';

  @override
  String steerEnglishOption(String option) {
    String _temp0 = intl.Intl.selectLogic(
      option,
      {
        'native': 'لغة أم / بطلاقة',
        'nonnative': 'ليست لغتهم الأم',
        'other': '$option',
      },
    );
    return '$_temp0';
  }

  @override
  String get influencerProfileCrmCpmExplain =>
      'التكلفة لكل 1000 مشاهدة، من الوسيط. غيّر أي من الحقلين.';

  @override
  String get influencerProfileCrmCut => 'نسبتي %';

  @override
  String get influencerProfileCrmSplitYours => 'أرباحي';

  @override
  String get influencerProfileCrmSplitTheirs => 'أرباحه';

  @override
  String influencerProfileCrmSplitOf(String price, String percent) {
    return 'من $price بنسبة $percent%';
  }

  @override
  String get influencerProfileCrmSplitHint =>
      'أدخل السعر ونسبتك بالأسفل لمعرفة نصيب كل طرف.';

  @override
  String get influencerProfileCrmEmpty =>
      'لا توجد فيديوهات قابلة للاستخدام. كل الفيديوهات المخزّنة بلا عدد مشاهدات.';

  @override
  String get influencerProfileCrmNoViewCount => 'بلا عدد مشاهدات';

  @override
  String get influencerProfileProvidedTitle => 'بيانات أرسلها المؤثر';

  @override
  String get influencerProfileProvidedEmpty =>
      'لا يوجد شيء مسجل. أضف ما أرسله كأزواج اسم/قيمة.';

  @override
  String get influencerProfileProvidedKey => 'الحقل';

  @override
  String get influencerProfileProvidedValue => 'القيمة';

  @override
  String get influencerProfileProvidedAdd => 'إضافة حقل';

  @override
  String get influencerProfileProvidedUnverified =>
      'أفاد بها المؤثر، ولم نقسها بأنفسنا.';

  @override
  String get influencerProfileEmailsTitle => 'سجل الرسائل';

  @override
  String get influencerProfileEmailsSource =>
      'للاطلاع فقط. تتم الإدارة من صفحة الرسائل.';

  @override
  String get influencerProfileEmailsOpen => 'فتح في الرسائل';

  @override
  String get influencerProfileNoEmails => 'لا توجد رسائل مسجلة مع هذا المؤثر.';

  @override
  String get influencerProfileEmailOutbound => 'مرسلة';

  @override
  String get influencerProfileEmailInbound => 'واردة';

  @override
  String influencerProfileEmailEventSent(String date) {
    return 'أُرسلت رسالة في $date';
  }

  @override
  String influencerProfileEmailEventFollowUp(String date) {
    return 'أُرسلت رسالة متابعة في $date';
  }

  @override
  String influencerProfileEmailEventReply(String date) {
    return 'ورد رد في $date';
  }

  @override
  String get influencerListSearchHint => 'ابحث بالاسم أو المعرّف';

  @override
  String get influencerListViewAsList => 'عرض قائمة';

  @override
  String get influencerListViewAsCards => 'عرض بطاقات';

  @override
  String get influencerListFilters => 'الفلاتر';

  @override
  String get influencerListClearFilters => 'مسح الفلاتر';

  @override
  String get influencerListNoMatches => 'لا توجد قنوات مطابقة لهذه الفلاتر.';

  @override
  String get influencerListLoadingMore => 'جارٍ تحميل المزيد…';

  @override
  String get influencerListEndOfList => 'هذا كل ما لدينا.';

  @override
  String influencerListShowingCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString ظاهر';
  }

  @override
  String get influencerFilterCountry => 'الدولة';

  @override
  String get influencerFilterChannelTag => 'وسم القناة';

  @override
  String get influencerFilterInclude => 'تضمين';

  @override
  String get influencerFilterExclude => 'استبعاد';

  @override
  String get influencerFilterStage => 'المرحلة';

  @override
  String get influencerFilterAny => 'الكل';

  @override
  String get influencerFilterMinSubscribers => 'أقل عدد مشتركين';

  @override
  String get influencerFilterMaxSubscribers => 'أكبر عدد مشتركين';

  @override
  String get influencerFilterMedianViews => 'متوسط المشاهدات هذا الشهر';

  @override
  String get influencerFilterDaysSinceDeal => 'أيام منذ آخر صفقة';

  @override
  String get influencerFilterMin => 'الأدنى';

  @override
  String get influencerFilterMax => 'الأقصى';

  @override
  String get influencerFilterDealsOnlyNote =>
      'يطابق هذا القنوات التي أبرمت صفقة فقط.';

  @override
  String get influencerListSortVideosThisMonth => 'فيديوهات هذا الشهر';

  @override
  String get influencerListSortDaysSinceDeal => 'المدة منذ آخر صفقة';

  @override
  String get influencerListSortDiscovered => 'الأحدث اكتشافاً';

  @override
  String influencerVideosThisMonth(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString فيديو هذا الشهر';
  }

  @override
  String influencerAverageViewsShort(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString متوسط المشاهدات';
  }

  @override
  String get influencerNoUploadsThisMonth => 'لا رفع هذا الشهر';

  @override
  String get influencerCountryUnknown => 'الدولة غير معروفة';

  @override
  String influencerTagContactAttempts(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString محاولات';
  }

  @override
  String influencerTagDaysSinceDeal(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString يوم منذ الصفقة';
  }

  @override
  String get influencerTagNeverContacted => 'لم يتم التواصل';

  @override
  String get pipelineStageNew => 'جديد';

  @override
  String get pipelineStageContacted => 'تم التواصل';

  @override
  String get pipelineStageInterested => 'مهتم';

  @override
  String get pipelineStageRoster => 'ضمن القائمة';

  @override
  String get pipelineStageNegotiating => 'قيد التفاوض';

  @override
  String get pipelineStageContract => 'عقد';

  @override
  String get pipelineStageAwaitingDelivery => 'بانتظار التسليم';

  @override
  String get pipelineStagePaid => 'مدفوع';

  @override
  String get pipelineStageLost => 'خسرناه';

  @override
  String get influencerAddTitle => 'إضافة قناة';

  @override
  String get influencerAddIntro =>
      'للقنوات التي وجدتها يدوياً ولم يظهرها البحث.';

  @override
  String get influencerAddHandle => 'المعرّف';

  @override
  String get influencerAddHandleHint => '@channelname';

  @override
  String get influencerAddHandleRequired => 'المعرّف مطلوب.';

  @override
  String get influencerAddChannelId => 'معرف قناة يوتيوب (اختياري)';

  @override
  String get influencerAddChannelIdHelp =>
      'يبدأ بـ UC. بدونه لن تندمج هذه الإضافة مع نفس القناة عندما يجدها البحث لاحقاً.';

  @override
  String get influencerAddName => 'اسم القناة (اختياري)';

  @override
  String get influencerAddUrl => 'رابط القناة (اختياري)';

  @override
  String get influencerAddSubscribers => 'عدد المشتركين (اختياري)';

  @override
  String get influencerAddCountry => 'الدولة (اختياري)';

  @override
  String get influencerAddNotes => 'ملاحظات (اختياري)';

  @override
  String get influencerAddSubmit => 'إضافة القناة';

  @override
  String get influencerAddSucceeded => 'تمت إضافة القناة.';

  @override
  String get influencerAddFailed => 'تعذرت إضافة القناة.';

  @override
  String get searchKeywordsLabel => 'الكلمات المفتاحية';

  @override
  String get searchKeywordsHint => 'كلمة مفتاحية واحدة في كل سطر';

  @override
  String searchKeywordsCount(String count) {
    return '$count كلمة مفتاحية';
  }

  @override
  String searchKeywordsProgressCount(String done, String total) {
    return '$done/$total كلمة مفتاحية';
  }

  @override
  String get searchKeywordsReopenTooltip => 'إعادة تشغيل كلمة منتهية';

  @override
  String searchKeywordsDoneCount(String count) {
    return '$count منتهية';
  }

  @override
  String get searchKeywordsReopenAll => 'إعادة الكل';

  @override
  String get searchKeywordsReopenTitle => 'إعادة تشغيل كلمة منتهية';

  @override
  String get searchKeywordsReopenHeader => 'منتهية — اختر واحدة لإعادة تشغيلها';

  @override
  String get searchKeywordsStartAtTooltip => 'البدء من كلمة مفتاحية محددة';

  @override
  String get searchKeywordsStartAtTitle => 'البدء من الكلمة المفتاحية رقم';

  @override
  String get searchKeywordsStartAtHint =>
      'يتخطى كل ما قبلها لهذا التشغيل فقط — لا يغيّر الكلمات المفتاحية المعلّمة كمنتهية.';

  @override
  String searchKeywordsStartAtLabel(String max) {
    return 'رقم الكلمة المفتاحية (1–$max)';
  }

  @override
  String get searchKeywordsStartAtAction => 'ابدأ من هنا';

  @override
  String get searchProgressStarting => 'جارٍ بدء العملية…';

  @override
  String get searchWarmupRunning =>
      'جارٍ جلب أحدث بيانات الفريق — البحث الذي يبدأ الآن ينتظر ثوانٍ قليلة.';

  @override
  String get searchWarmupReady => 'بيانات الفريق محدّثة.';

  @override
  String searchWarmupReadyAge(int minutes) {
    return 'تم تحديث بيانات الفريق قبل $minutes دقيقة.';
  }

  @override
  String get searchWarmupStale =>
      'تُحدَّث بيانات الفريق في الخلفية قبل أن تبحث.';

  @override
  String get searchWarmupFailed =>
      'تعذّر تحديث بيانات الفريق — سيجلبها البحث بنفسه.';

  @override
  String get searchWarmupRefresh => 'تحديث الآن';

  @override
  String searchProgressOnKeyword(int index, int total, String keyword) {
    return 'الكلمة $index من $total — $keyword';
  }

  @override
  String searchProgressCompleted(int channelsFound) {
    return 'اكتمل التشغيل — تم العثور على $channelsFound قناة';
  }

  @override
  String searchProgressStopped(int done) {
    return 'تم الإيقاف بعد $done كلمة مفتاحية — كل ما تم العثور عليه محفوظ';
  }

  @override
  String get searchProgressFailed =>
      'انتهى التشغيل بشكل غير متوقع. راجع السجل بالأسفل.';

  @override
  String searchProgressChannels(String count) {
    return '$count قناة';
  }

  @override
  String searchProgressVideos(String count) {
    return '$count فيديو';
  }

  @override
  String searchBackoffWaiting(String seconds) {
    return 'الانتظار $seconds ثانية قبل إعادة المحاولة...';
  }

  @override
  String get searchTryAgainNow => 'إعادة المحاولة الآن';

  @override
  String get searchRouteDirectOnly =>
      'لا يوجد AWS ولا بروكسي: كل الطلبات تخرج من هذا الجهاز';

  @override
  String searchRouteAwsInUse(String count) {
    return 'AWS قيد الاستخدام · $count طلب';
  }

  @override
  String get searchRouteAwsIdle => 'AWS جاهز · لم يُستخدم بعد';

  @override
  String searchRouteProxiesInUse(String count) {
    return 'البروكسيات قيد الاستخدام · $count طلب';
  }

  @override
  String get searchRouteProxiesIdle => 'البروكسيات جاهزة · لم تُستخدم بعد';

  @override
  String searchRouteThisMachine(String count) {
    return 'هذا الجهاز · $count طلب';
  }

  @override
  String searchRouteParallel(int workers) {
    return '$workers كلمات في الوقت نفسه · السرعة العادية';
  }

  @override
  String get searchRouteOneAtATimeFast =>
      'كلمة واحدة في كل مرة · السرعة العالية';

  @override
  String get searchRouteOneAtATimeNormal =>
      'كلمة واحدة في كل مرة · السرعة العادية';

  @override
  String searchRouteLast(String label) {
    return 'آخر طلب عبر $label';
  }

  @override
  String searchAlsoRunning(String keywords) {
    return 'قيد التشغيل أيضًا: $keywords';
  }

  @override
  String get searchStopButton => 'إيقاف البحث';

  @override
  String get searchStopRequested =>
      'جارٍ الإيقاف — سينهي التشغيل خطوته الحالية أولاً.';

  @override
  String get searchResumeButton => 'استئناف البحث';

  @override
  String get searchStartFromTop => 'البدء من الأول';

  @override
  String get searchAllKeywordsDone =>
      'كل الكلمات المفتاحية في القائمة منتهية بالفعل. ابدأ من الأول لتشغيلها مجدداً.';

  @override
  String searchResumeNotice(int done, int total, String nextKeyword) {
    return 'تم إنجاز $done من $total — سيستأنف البدء من «$nextKeyword».';
  }

  @override
  String get searchSettingsTitle => 'إعدادات البحث';

  @override
  String get searchSortByLabel => 'الترتيب حسب';

  @override
  String get searchSortByRelevance => 'الصلة';

  @override
  String get searchSortByUploadDate => 'تاريخ الرفع';

  @override
  String get searchSortByViewCount => 'عدد المشاهدات';

  @override
  String get searchSortByRating => 'التقييم';

  @override
  String get searchResultsTypeLabel => 'نوع النتائج';

  @override
  String get searchResultsTypeVideo => 'فيديوهات';

  @override
  String get searchResultsTypeChannel => 'قنوات';

  @override
  String get searchCountryLabel => 'الدول';

  @override
  String get searchCountryHint => 'مثال: US، EG — اتركه فارغاً لأي دولة';

  @override
  String get searchCountryPickTitle => 'الدول المستهدفة';

  @override
  String get searchCountryClearAll => 'مسح الكل';

  @override
  String get searchCountryEnglishMarkets => 'الأسواق الإنجليزية';

  @override
  String get searchHandleLimitLabel => 'الحد الأقصى للقنوات';

  @override
  String get searchOverrideHint =>
      'اتركه فارغاً لاستخدام القيمة الافتراضية المشتركة';

  @override
  String get searchStartButton => 'بدء البحث';

  @override
  String get searchNoKeywordsError => 'أضف كلمة مفتاحية واحدة على الأقل أولاً.';

  @override
  String get searchStartedByThisDevice => 'هذا الجهاز';

  @override
  String get searchStarted => 'بدأ البحث — يعمل الآن على هذا الجهاز.';

  @override
  String searchStartFailed(String error) {
    return 'تعذّر بدء البحث: $error';
  }

  @override
  String get searchUploadButtonLabel => 'إرسال الكلمات المفتاحية';

  @override
  String get searchUploadDialogTitle =>
      'إرسال الكلمات المفتاحية إلى أحد الزملاء';

  @override
  String searchUploadDialogTitleTo(String name) {
    return 'إرسال الكلمات المفتاحية إلى $name';
  }

  @override
  String get searchUploadKeywordsHint => 'كلمة مفتاحية واحدة في كل سطر';

  @override
  String get searchUploadRecipientSectionTitle => 'إرسال إلى';

  @override
  String get searchUploadOnlineLabel => 'متصل';

  @override
  String get searchUploadOfflineLabel => 'غير متصل';

  @override
  String get searchUploadSendButton => 'إرسال';

  @override
  String get searchUploadNoTeammates => 'لا يوجد زملاء آخرون بعد.';

  @override
  String get searchUploadNoRecipientError =>
      'اختر الشخص الذي تريد إرسال هذه الكلمات المفتاحية إليه.';

  @override
  String searchUploadSent(String name, int count) {
    return 'تم إرسال $count كلمة مفتاحية إلى $name.';
  }

  @override
  String searchUploadSendFailed(String error) {
    return 'تعذّر الإرسال: $error';
  }

  @override
  String get searchProgressTitle => 'سير العملية';

  @override
  String get progressMaximizeTooltip => 'تكبير التقدم';

  @override
  String get progressRestoreTooltip => 'استعادة';

  @override
  String get searchProgressEmpty => 'لم يتم إجراء أي بحث بعد.';

  @override
  String get backfillProgressTitle => 'سحب الفيديوهات الأقدم';

  @override
  String backfillProgressRunning(String handle) {
    return 'جارٍ سحب رفعات أقدم لـ @$handle';
  }

  @override
  String backfillProgressCompleted(int count, String handle) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تمت إضافة $count فيديو جديد',
      one: 'تمت إضافة فيديو واحد جديد',
      zero: 'لم يُعثر على فيديوهات جديدة',
    );
    return '$_temp0 لـ @$handle';
  }

  @override
  String backfillProgressFailed(String handle) {
    return 'انتهت عملية السحب لـ @$handle بشكل غير متوقع. راجع السجل أدناه.';
  }

  @override
  String get reenrichProgressTitle => 'خرجت من الأرشيف';

  @override
  String reenrichProgressRunning(String handle) {
    return 'جارٍ إثراء $handle…';
  }

  @override
  String reenrichProgressCompleted(String handle) {
    return 'تم إثراء $handle — عادت إلى قائمة المؤثرين';
  }

  @override
  String reenrichProgressFailed(String handle) {
    return 'انتهى إثراء $handle بشكل غير متوقع. راجع السجل أدناه.';
  }

  @override
  String get navBadgeRunning => 'هناك عملية قيد التنفيذ في الخلفية';

  @override
  String get navBadgeSuccess => 'انتهت — افتح صفحة البحث لرؤية النتيجة';

  @override
  String get navBadgeError => 'حدث خطأ ما — افتح صفحة البحث لمعرفة التفاصيل';

  @override
  String get commonAdd => 'إضافة';

  @override
  String get commonCopy => 'نسخ';

  @override
  String get commonSave => 'حفظ';

  @override
  String get commonCancel => 'إلغاء';

  @override
  String get commonDelete => 'حذف';

  @override
  String get commonCreate => 'إنشاء';

  @override
  String get brandListEmpty => 'لا توجد علامات تجارية بعد.';

  @override
  String get brandNotFound => 'لم يتم العثور على العلامة التجارية.';

  @override
  String get brandProfileContactTitle => 'جهة الاتصال';

  @override
  String get brandProfileContactPhone => 'الهاتف';

  @override
  String get brandProfileWebsite => 'الموقع الإلكتروني';

  @override
  String get brandProfileBudget => 'الميزانية';

  @override
  String get brandProfileCampaignBrief => 'ملخص الحملة';

  @override
  String get brandProfilePreferredCriteriaTitle => 'معايير المؤثرين المفضلة';

  @override
  String get brandProfileNotesHint =>
      'ملاحظات للصفقات المستقبلية مع هذه العلامة التجارية';

  @override
  String get brandProfileDealHistoryEmpty =>
      'لا توجد صفقات بعد مع هذه العلامة التجارية.';

  @override
  String get dealListEmpty => 'لا توجد صفقات بعد.';

  @override
  String get dealNotFound => 'لم يتم العثور على الصفقة.';

  @override
  String get dealDetailStageLabel => 'المرحلة';

  @override
  String get dealDetailPricingTitle => 'التسعير';

  @override
  String get dealDetailBrandPays => 'تدفعه العلامة التجارية';

  @override
  String get dealDetailInfluencerReceives => 'يستلمه المؤثر';

  @override
  String get dealDetailMargin => 'هامش الوكالة';

  @override
  String get dealDetailDeliverablesTitle => 'المخرجات';

  @override
  String get dealDetailDeadlineLabel => 'الموعد النهائي';

  @override
  String get dealDetailNoDeadline => 'لا يوجد موعد نهائي محدد';

  @override
  String get dealDetailContractTitle => 'العقد';

  @override
  String get dealDetailCopyContractLink => 'نسخ الرابط';

  @override
  String get dealDetailWorkingDaysLabel => 'أيام العمل';

  @override
  String get dealDetailPartiesTitle => 'الأطراف';

  @override
  String get dealDetailBrandLabel => 'العلامة التجارية';

  @override
  String get dealDetailInfluencerLabel => 'المؤثر';

  @override
  String get dealDetailNotesHint => 'ملاحظات حول هذه الجولة من الصفقة تحديداً';

  @override
  String dealDetailCreatedAt(String date) {
    return 'أُنشئت $date';
  }

  @override
  String dealDetailUpdatedAt(String date) {
    return 'آخر تحديث $date';
  }

  @override
  String get outreachTemplatesTitle => 'مكتبة القوالب';

  @override
  String get outreachAddTemplate => 'قالب جديد';

  @override
  String get outreachEditTemplateTitle => 'تعديل القالب';

  @override
  String get outreachNewTemplateTitle => 'قالب جديد';

  @override
  String get outreachTemplateNameLabel => 'الاسم';

  @override
  String get outreachTemplateSubjectLabel => 'الموضوع';

  @override
  String get outreachTemplateBodyLabel => 'النص';

  @override
  String get outreachTemplateKindEmail => 'بريد';

  @override
  String get outreachTemplateKindDm => 'رسالة مباشرة';

  @override
  String get outreachTemplateTokenHint =>
      'تُملأ العناصر النائبة بين قوسين مجعدين مزدوجين من بيانات المؤثر: handle، name، lastVideoTitle، lastVideoDate، subscriberCount، country';

  @override
  String get outreachThreadsTitle => 'المحادثات';

  @override
  String get outreachThreadListEmpty => 'لا توجد محادثات تواصل بعد.';

  @override
  String get outreachSelectThreadHint => 'اختر محادثة لعرض سجلها وصياغة رسالة.';

  @override
  String get outreachStatusNotContactedYet => 'لم يتواصل';

  @override
  String get outreachStatusAwaitingReply => 'بانتظار الرد';

  @override
  String get outreachStatusReplied => 'تم الرد';

  @override
  String get outreachStatusNeedsFollowUp => 'يحتاج متابعة';

  @override
  String get outreachMessagesTitle => 'الرسائل';

  @override
  String get outreachNoMessages => 'لا توجد رسائل بعد.';

  @override
  String get outreachComposeTitle => 'صياغة رسالة';

  @override
  String outreachComposeWordCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count كلمة',
      many: '$count كلمة',
      few: '$count كلمات',
      two: 'كلمتان',
      one: 'كلمة واحدة',
      zero: '0 كلمة',
    );
    return '$_temp0';
  }

  @override
  String get outreachSelectTemplateLabel => 'القالب';

  @override
  String get outreachNoTemplateOption => 'بدون قالب — الكتابة من الصفر';

  @override
  String get outreachAiProviderLabel => 'مزوّد الذكاء الاصطناعي';

  @override
  String get outreachGenerateDraft => 'إنشاء مسودة';

  @override
  String get outreachDraftGenerated => 'تم إنشاء المسودة.';

  @override
  String get outreachSubjectLabel => 'الموضوع';

  @override
  String get outreachBodyLabel => 'النص';

  @override
  String get outreachRecordSent => 'تسجيل كمُرسلة';

  @override
  String get outreachMessageRecorded => 'تم تسجيل الرسالة.';

  @override
  String get outreachMarkReplied => 'تمييز كتم الرد';

  @override
  String get outreachThreadMarkedReplied => 'تم التمييز كتم الرد.';

  @override
  String get outreachWritingRulesTitle => 'قواعدي في الكتابة';

  @override
  String get outreachWritingRulesHint =>
      'مثال: اذكر دائماً أننا وكالة بوتيك، اجعلها أقل من 120 كلمة';

  @override
  String get outreachBackToList => 'العودة إلى المحادثات';

  @override
  String outreachDraftGenerationFailed(String error) {
    return 'تعذّر إنشاء المسودة: $error';
  }

  @override
  String get settingsGeneralTitle => 'عام';

  @override
  String get settingsLanguageLabel => 'اللغة';

  @override
  String get settingsLanguageEnglish => 'الإنجليزية';

  @override
  String get settingsLanguageArabic => 'العربية';

  @override
  String get settingsThemeLabel => 'المظهر';

  @override
  String get settingsThemeSystem => 'حسب النظام';

  @override
  String get settingsThemeLight => 'فاتح';

  @override
  String get settingsThemeDark => 'داكن';

  @override
  String get settingsTimeZoneLabel => 'المنطقة الزمنية للعرض';

  @override
  String get settingsTimeZoneSubtitle =>
      'تُعرض جميع التواريخ والأوقات في التطبيق بهذه المنطقة الزمنية. تبقى البيانات المخزّنة دائماً بتوقيت UTC، لذا فتغيير هذا الإعداد آمن.';

  @override
  String settingsTimeZoneSystemDefault(String zone) {
    return 'افتراضي الجهاز ($zone)';
  }

  @override
  String get settingsTimeZoneChange => 'تغيير المنطقة الزمنية';

  @override
  String settingsTimeZoneChangeButton(String zone) {
    return '$zone - تغيير المنطقة الزمنية';
  }

  @override
  String get settingsTimeZoneUseDevice => 'استخدام افتراضي الجهاز';

  @override
  String get settingsTimeZoneSearchHint => 'ابحث عن منطقة — مثل القاهرة';

  @override
  String get settingsTimeZoneNoMatches => 'لا توجد مناطق زمنية مطابقة.';

  @override
  String get settingsStartupTitle => 'settingsStartupTitle';

  @override
  String get settingsStartupNoSupport => 'settingsStartupNoSupport';

  @override
  String get settingsLaunchAtStartupLabel => 'settingsLaunchAtStartupLabel';

  @override
  String get settingsLaunchAtStartupOn => 'settingsLaunchAtStartupOn';

  @override
  String get settingsLaunchAtStartupOff => 'settingsLaunchAtStartupOff';

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
  String get settingsAiProvidersTitle => 'مزوّدو الذكاء الاصطناعي';

  @override
  String get settingsAiProvidersSubtitle =>
      'سجّل مفتاح API الخاص بك لصياغة رسائل التواصل باستخدام نموذج ذكاء اصطناعي حقيقي. خيار التعبئة بالقالب يبقى متاحاً دائماً ولا يحتاج إلى مفتاح.';

  @override
  String get settingsAiProvidersEmpty =>
      'لا يوجد مزوّدو ذكاء اصطناعي مسجّلون بعد — ستعتمد المسودات على التعبئة بالقالب فقط.';

  @override
  String settingsAiProviderSubtitle(String model, String maskedKey) {
    return '$model · المفتاح $maskedKey';
  }

  @override
  String get settingsAddAiProvider => 'إضافة مزوّد';

  @override
  String get settingsNewAiProviderTitle => 'مزوّد ذكاء اصطناعي جديد';

  @override
  String get settingsEditAiProviderTitle => 'تعديل مزوّد الذكاء الاصطناعي';

  @override
  String get settingsAiProviderNameLabel => 'الاسم';

  @override
  String get settingsAiProviderKeyLabel => 'مفتاح API';

  @override
  String get settingsAiProviderModelLabel => 'النموذج';

  @override
  String get settingsAiProviderKeyHint =>
      'يُخزَّن مشفّراً على هذا الجهاز فقط — لا تتم مزامنته أو مشاركته مع الفريق.';

  @override
  String get settingsTeamSyncTitle => 'مزامنة الفريق';

  @override
  String get settingsTeamSyncSubtitle =>
      'اتصل بقاعدة PocketBase المشتركة للفريق لمزامنة العلامات التجارية والصفقات والتواصل عبر أجهزة الجميع. اترك الرابط فارغاً للاستمرار في العمل محلياً على هذا الجهاز فقط.';

  @override
  String get settingsTeamSyncUrlLabel => 'رابط PocketBase';

  @override
  String get settingsTeamSyncEmailLabel => 'البريد الإلكتروني للمشرف الأعلى';

  @override
  String get settingsTeamSyncPasswordLabel => 'كلمة مرور المشرف الأعلى';

  @override
  String get settingsTeamSyncHint =>
      'يسجّل الفريق بأكمله الدخول بنفس البيانات — فهي ليست حساباً شخصياً، لذا يمكن لأي شخص إدخالها هنا من أي جهاز.';

  @override
  String get settingsTeamSyncTestConnection => 'اختبار الاتصال';

  @override
  String get settingsTeamSyncTestSuccess => 'تم الاتصال بنجاح.';

  @override
  String settingsTeamSyncTestFailure(String error) {
    return 'فشل الاتصال: $error';
  }

  @override
  String get settingsTeamSyncEnterUrlFirst => 'أدخل رابط PocketBase أولاً.';

  @override
  String get settingsTeamSyncSaved => 'تم حفظ إعدادات مزامنة الفريق.';

  @override
  String get settingsTeamSyncStatusNotConfigured => 'محلي فقط';

  @override
  String get settingsTeamSyncStatusChecking => 'جارٍ التحقق…';

  @override
  String get settingsTeamSyncStatusConnected => 'متصل';

  @override
  String get settingsTeamSyncStatusFailed => 'غير متصل';

  @override
  String get settingsPythonEnvironmentTitle => 'بيئة بايثون';

  @override
  String get settingsPythonEnvironmentSubtitle =>
      'كيفية تشغيل هذا الجهاز لمسار البحث المحلي — إعداد خاص بكل جهاز، لا يُشارك مع الفريق.';

  @override
  String get settingsPythonExecutableLabel => 'برنامج بايثون التنفيذي';

  @override
  String get settingsProjectRootOverrideLabel => 'تجاوز مجلد المشروع';

  @override
  String get settingsProjectRootOverrideHint =>
      'اتركه فارغاً لاستخدام مجلد التطبيق نفسه';

  @override
  String get settingsPythonEnvironmentSaved => 'تم حفظ إعدادات بيئة بايثون.';

  @override
  String get settingsSearchTuningTitle => 'ضبط البحث المتقدم';

  @override
  String get settingsSearchTuningSubtitle =>
      'إعدادات التوقيت والوكيل والحدود التي يستخدمها أداة الجمع';

  @override
  String get settingsSearchTuningSaved => 'تم حفظ إعدادات ضبط البحث.';

  @override
  String get settingsSearchTuningDesktopOnly =>
      'ضبط البحث ينطبق فقط على جهاز سطح المكتب الذي يشغّل أداة الجمع.';

  @override
  String get settingsThresholdsTitle => 'الحدود';

  @override
  String get settingsMinimumSubscribersLabel => 'الحد الأدنى للمشتركين';

  @override
  String get settingsHandlesLimitLabel => 'عدد القنوات لكل عملية بحث';

  @override
  String get settingsRecentVideosMonthsLabel =>
      'نطاق الفيديوهات الحديثة (بالأشهر)';

  @override
  String get settingsPacingTitle => 'التوقيت';

  @override
  String get settingsPacingHint =>
      'يُختار كل تأخير عشوائياً بين حده الأدنى والأقصى مع كل طلب.';

  @override
  String get settingsPacingNormalTab => 'عادي';

  @override
  String get settingsPacingFastTab => 'سريع (تدوير IP)';

  @override
  String get settingsPacingFastLockedHint =>
      'يُطبَّق فقط عند تفعيل تدوير البروكسي أو بوابة AWS -- عندها يخرج كل طلب بعنوان IP مختلف، فيمكن تسريع التوقيت كثيراً دون إرهاق عنوان واحد. يمكن تعديله الآن بأمان، لكن الأداة لن تستخدمه حتى يُفعَّل التدوير.';

  @override
  String get settingsHumanScrollDelayLabel => 'تأخير التمرير البشري';

  @override
  String get settingsJitterDelayLabel => 'تأخير التذبذب';

  @override
  String get settingsRecentVideosDelayLabel => 'تأخير جلب الفيديوهات الحديثة';

  @override
  String get settingsFastSubCountDelayLabel =>
      'تأخير الفحص السريع لعدد المشتركين';

  @override
  String get settingsFoundChannelsDelayLabel => 'تأخير القنوات المكتشفة';

  @override
  String get settingsIpCooldownLabel => 'مدة تهدئة عنوان IP';

  @override
  String settingsIpCooldownChanceLabel(String percent) {
    return 'احتمال تهدئة عنوان IP: $percent%';
  }

  @override
  String get settingsProxyTitle => 'الوكيل (Proxy)';

  @override
  String get settingsProxyHostLabel => 'المضيف';

  @override
  String get settingsProxyPortLabel => 'المنفذ';

  @override
  String get settingsProxyUsernameLabel => 'اسم المستخدم';

  @override
  String get settingsProxyPasswordLabel => 'كلمة المرور';

  @override
  String get settingsProxyEnableRotationLabel => 'تفعيل تدوير الوكلاء';

  @override
  String get settingsProxyIncludeDirectLabel => 'تضمين هذا الجهاز (بدون وكيل)';

  @override
  String get settingsProxyIncludeDirectHint =>
      'يسمح بأن تخرج بعض الطلبات من اتصال هذا الجهاز مباشرة، وليس فقط عبر الوكلاء أدناه.';

  @override
  String get settingsProxyLabelField => 'التسمية';

  @override
  String get settingsProxyEnabledLabel => 'مُفعّل';

  @override
  String get settingsProxyListEmpty => 'لم تتم إضافة أي وكيل بعد.';

  @override
  String get settingsAddProxy => 'إضافة وكيل';

  @override
  String get settingsNewProxyTitle => 'وكيل جديد';

  @override
  String get settingsEditProxyTitle => 'تعديل الوكيل';

  @override
  String get settingsAwsGatewayTitle => 'تدوير عناوين IP عبر AWS Gateway';

  @override
  String get settingsAwsGatewayHint =>
      'يمرر الطلبات عبر نقاط AWS API Gateway في مناطق مختلفة بدلاً من قائمة الوكلاء. يُنشأ ويُحذف بشكل منفصل عبر tools/aws_gateway_setup.py.';

  @override
  String get settingsAwsGatewayEmpty =>
      'لم يتم نشر أي بوابة بعد. شغّل \"python tools/aws_gateway_setup.py deploy\" على الجهاز الذي يقوم بعمليات البحث.';

  @override
  String get settingsAwsGatewayEnabledToast => 'تم تفعيل تدوير AWS Gateway.';

  @override
  String get settingsAwsGatewayDisabledToast => 'تم إيقاف تدوير AWS Gateway.';

  @override
  String get settingsParallelTitle => 'البحث المتوازي';

  @override
  String get settingsParallelHint =>
      'يعالج عدة كلمات في الوقت نفسه، كلمة لكل بوابة AWS أو بروكسي (ولا يستخدم أبدًا نفس البوابة لكلمتين)، بالسرعة العادية. متوقف افتراضيًا.';

  @override
  String get settingsParallelMaxWorkersLabel =>
      'أقصى عدد من الكلمات في الوقت نفسه';

  @override
  String settingsParallelNeedsTwo(int count) {
    return 'يحتاج إلى بوابتي AWS أو بروكسيين على الأقل. مع $count يبقى البحث كلمة واحدة في كل مرة.';
  }

  @override
  String settingsParallelActive(int workers) {
    return 'سيعالج البحث التالي $workers كلمات في الوقت نفسه بالسرعة العادية.';
  }

  @override
  String get settingsAwsAccountsTitle => 'حسابات AWS';

  @override
  String get settingsAwsAccountsSubtitle =>
      'مفتاح AWS IAM الخاص بكل عضو في الفريق لأداة نشر البوابة، مع سجل التعديلات.';

  @override
  String get settingsAwsAccountsNoTeammates =>
      'لا يوجد زملاء بعد — بمجرد تسجيل دخول أحدهم، يظهر له تبويب هنا.';

  @override
  String settingsAwsAccountsOthersLocked(String name) {
    return 'يمكن لـ $name وحده عرض أو تعديل بيانات اعتماد AWS الخاصة به.';
  }

  @override
  String get settingsAwsAccountsNotSignedIn =>
      'سجّل الدخول لإدارة بيانات اعتماد AWS الخاصة بك.';

  @override
  String get settingsAwsAccountsLoadFailed =>
      'تعذّر تحميل بيانات اعتماد AWS الخاصة بك.';

  @override
  String get settingsAwsAccountsAccessKeyLabel => 'معرّف مفتاح الوصول';

  @override
  String get settingsAwsAccountsSecretKeyLabel => 'مفتاح الوصول السري';

  @override
  String get settingsAwsAccountsShowSecret => 'إظهار';

  @override
  String get settingsAwsAccountsHideSecret => 'إخفاء';

  @override
  String get settingsAwsAccountsRegionsLabel => 'المنطقة (المناطق) الافتراضية';

  @override
  String get settingsAwsAccountsRegionsHint =>
      'مفصولة بفواصل، مثال: us-east-1, eu-west-1';

  @override
  String get settingsAwsAccountsSaveButton => 'حفظ';

  @override
  String get settingsAwsAccountsSavedToast => 'تم حفظ بيانات اعتماد AWS.';

  @override
  String settingsAwsAccountsSaveFailedToast(String error) {
    return 'تعذّر الحفظ: $error';
  }

  @override
  String get settingsAwsAccountsNotWiredNote =>
      'هذا يسجّل مفتاحك للفريق فقط. لا يزال tools/aws_gateway_setup.py يقرأ ملف data/.env الخاص به على أي جهاز يشغّله، بمعزل عمّا هو محفوظ هنا — ربط الاثنين ببعضهما خطوة تالية مخطط لها.';

  @override
  String get settingsAwsAccountsSetupTitle => 'كيفية إعداد هذا';

  @override
  String get settingsAwsAccountsSetupStep1 =>
      '١. سجّل الدخول إلى وحدة تحكم AWS (console.aws.amazon.com)، أو أنشئ حسابًا مجانيًا إذا لم يكن لديك واحد.';

  @override
  String get settingsAwsAccountsSetupStep2 =>
      '٢. افتح IAM ← Users ← Create user. أعطِه اسمًا مثل gratovo-gateway-deployer — لا يحتاج إلى صلاحية دخول إلى وحدة التحكم، فقط الوصول البرمجي.';

  @override
  String get settingsAwsAccountsSetupStep3 =>
      '٣. أرفق سياسة صلاحيات: سياسة AWS المُدارة \"AmazonAPIGatewayAdministrator\" هي الخيار الأبسط. لنطاق أضيق، تكفي سياسة مخصصة تسمح فقط بإجراءات apigateway:* — وهذه لا تُنشئ أو تحذف سوى واجهات HTTP APIs والتكاملات والمسارات والمراحل.';

  @override
  String get settingsAwsAccountsSetupStep4 =>
      '٤. افتح المستخدم الجديد ← تبويب Security credentials ← Create access key ← اختر \"Application running outside AWS\". يظهر مفتاح الوصول السري مرة واحدة فقط، فانسخ القيمتين فورًا.';

  @override
  String get settingsAwsAccountsSetupStep5 =>
      '٥. الصق معرّف مفتاح الوصول والمفتاح السري أدناه، أضف المنطقة (المناطق) التي تخطط للنشر إليها (مثل us-east-1, eu-west-1)، ثم اضغط حفظ.';

  @override
  String get settingsAwsAccountsSetupStep6 =>
      '٦. لنشر البوابات فعليًا، شغّل \"python tools/aws_gateway_setup.py deploy --regions <مناطقك>\" على الجهاز الذي يشغّل عمليات البحث، بنفس زوج المفاتيح في AWS_IAM_ACCESS_KEY_ID / AWS_IAM_SECRET_ACCESS_KEY داخل ملفه data/.env.local.';

  @override
  String get settingsAwsAccountsHistoryTitle => 'السجل';

  @override
  String get settingsAwsAccountsHistoryEmpty => 'لا توجد نسخ محفوظة بعد.';

  @override
  String get settingsAwsAccountsHistoryRestore => 'استعادة';

  @override
  String get settingsAwsAccountsHistoryRestoredToast =>
      'تم تحميلها في الحقول أدناه — اضغط حفظ للإبقاء عليها.';

  @override
  String get settingsAwsAccountsHistoryEntryBlank => 'تمت إزالتها';

  @override
  String settingsAwsAccountsHistoryEntryKey(String last4) {
    return 'مفتاح ينتهي بـ $last4';
  }

  @override
  String get settingsAwsAccountsRetry => 'إعادة المحاولة';

  @override
  String get settingsAwsAccountsRotationOn => 'تدوير IP مفعّل';

  @override
  String get settingsAwsAccountsRotationOff => 'تدوير IP متوقف';

  @override
  String get searchKeywordsExpand => 'توسيع لكامل الارتفاع';

  @override
  String get searchKeywordsCollapse => 'تصغير';

  @override
  String get searchInputsReadOnlyHint =>
      'للقراءة فقط — لا يمكن تعديل الكلمات المفتاحية وإعدادات البحث إلا على جهاز سطح المكتب.';

  @override
  String get searchCountryAny => 'الكل';

  @override
  String searchMaxVideosValue(String count) {
    return 'حد أقصى $count';
  }

  @override
  String get searchMaxVideosLabel => 'الحد الأقصى للفيديوهات/بحث';

  @override
  String get searchMaxVideosTooltip =>
      'عدد نتائج بحث يوتيوب التي يجلبها هذا التشغيل لكل كلمة مفتاحية قبل الانتقال — فيديوهات عندما يكون نوع النتائج \"فيديو\"، وقنوات عندما يكون \"قناة\".\n\nهذا حدّ أقصى لعدد النتائج الخام، وليس عدد القنوات. كثير من الفيديوهات تأتي من نفس القناة، والنتائج لقنوات موجودة لديك بالفعل تُحتسب أيضًا، لذا فإن رقمًا أكبر يجد قنوات جديدة أقل نسبيًا. يستمر البحث في التصفح حتى يصل إلى هذا العدد من النتائج أو تنتهي نتائج يوتيوب، أيهما أقرب.\n\nاتركه فارغًا لاستخدام الإعداد المشترك للفريق.';

  @override
  String get searchInstalledAppRequired =>
      'يشغّل البحث أداة الاستخراج على جهازك، وهو ما لا يمكن لمتصفح الويب فعله. افتح تطبيق سطح المكتب لبدء التشغيل — أما بقية هذه الصفحة فتعمل هنا.';

  @override
  String get settingsFontScaleLabel => 'حجم الخط';

  @override
  String settingsFontScaleLabelWithPercent(String percent) {
    return 'حجم الخط - $percent%';
  }

  @override
  String get settingsFontScaleReset => 'إعادة إلى 100%';

  @override
  String get commonUnknown => 'غير معروف';

  @override
  String get emailsAccessLevelTitle => 'مستوى صلاحيتك';

  @override
  String get emailsAccessLevelFull =>
      'صلاحية كاملة. ترى كل رسالة بالكامل، بما فيها الأسماء والعلامات والأسعار.';

  @override
  String get emailsAccessLevelBasic =>
      'صلاحية أساسية. ترى أن الرسائل حدثت ومتى، لكن الأسماء والقنوات والعلامات والأسعار والعناوين تُزال قبل أن تغادر الخادم.';

  @override
  String get emailsAccessDeniedTitle => 'لا صلاحية لبيانات الرسائل';

  @override
  String get emailsAccessDeniedBody =>
      'لم تُمنح هذه الحسابات صلاحية بيانات الرسائل. يجب أن يرفع المشرف مستوى صلاحيتك — الرفض يأتي من قاعدة البيانات وليس إخفاءً من التطبيق.';

  @override
  String get emailsRedactedNote =>
      'علامات ••• مقصودة. أُزيلت تلك الحقول على الخادم حسب مستوى صلاحيتك، ولم تُفقد.';

  @override
  String get emailsRedactedFieldTooltip => 'مخفي حسب مستوى صلاحيتك';

  @override
  String get emailsActionUnavailable => 'غير متاح حسب مستوى صلاحيتك';

  @override
  String get authSignInSubtitle => 'سجّل الدخول بالحساب الذي حصلت عليه.';

  @override
  String get authEmailLabel => 'البريد الإلكتروني';

  @override
  String get authEmailInvalid => 'أدخل بريدًا إلكترونيًا صحيحًا.';

  @override
  String get authPasswordLabel => 'كلمة المرور';

  @override
  String get authPasswordRequired => 'أدخل كلمة المرور.';

  @override
  String get authSignInButton => 'تسجيل الدخول';

  @override
  String get authSignOutButton => 'تسجيل الخروج';

  @override
  String get authNoSelfSignupNotice =>
      'يتم إنشاء الحسابات بواسطة المسؤول — لا يوجد تسجيل ذاتي هنا.';

  @override
  String get authAdvancedToggle => 'خيارات متقدمة — عنوان الخادم';

  @override
  String authServerUnreachable(String error) {
    return 'تعذّر الوصول إلى الخادم. تحقّق من العنوان في الخيارات المتقدمة ثم أعد تشغيل التطبيق.\n$error';
  }

  @override
  String get authErrorInvalidCredentials =>
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.';

  @override
  String get authErrorEmailNotConfirmed =>
      'لم يتم تأكيد هذا الحساب بعد. اطلب من المسؤول تأكيده.';

  @override
  String get authErrorOffline =>
      'لا يوجد اتصال. تحقّق من الإنترنت وحاول مرة أخرى.';

  @override
  String get authErrorNotConfigured =>
      'لم يتم ضبط أي خادم. افتح الخيارات المتقدمة وأدخل العنوان.';

  @override
  String authErrorUnknown(String detail) {
    return 'تعذّر تسجيل الدخول: $detail';
  }

  @override
  String get authAccessPendingTitle => 'في انتظار الصلاحية';

  @override
  String authAccessPendingBody(String email) {
    return 'تم تسجيل دخولك باسم $email، لكن لم تُمنح صلاحية بعد. اطلب من المسؤول منحك صلاحية ثم تحقّق مرة أخرى.';
  }

  @override
  String get authAccessPendingRecheck => 'تحقّق مرة أخرى';

  @override
  String get settingsAboutTitle => 'حول التطبيق';

  @override
  String settingsAboutVersion(String version, String build) {
    return 'الإصدار $version (بناء $build)';
  }

  @override
  String get settingsAboutCopyVersion => 'نسخ';

  @override
  String get settingsAboutVersionCopied => 'تم نسخ رقم الإصدار.';

  @override
  String settingsUpdateAvailable(String version) {
    return 'الإصدار $version جاهز للتثبيت.';
  }

  @override
  String settingsUpdateDownloading(String version) {
    return 'جارٍ تنزيل الإصدار $version…';
  }

  @override
  String get settingsUpdateInstalling => 'جارٍ إعادة التشغيل للتثبيت…';

  @override
  String get settingsUpdateInstall => 'تحديث';

  @override
  String get settingsUpdateUpToDate => 'مُحدّث';

  @override
  String get settingsUpdateCheckNow => 'التحقق من التحديثات';

  @override
  String get settingsUpdateConfirmTitle => 'إنهاء المزامنة أولاً؟';

  @override
  String get settingsUpdateConfirmBody =>
      'لا تزال التغييرات على هذا الجهاز قيد الرفع. التثبيت الآن يعيد تشغيل التطبيق قبل انتهائها.';

  @override
  String settingsUpdateConfirmSideBySide(String version) {
    return 'يُثبّت الإصدار $version في مجلد خاص به. يبقى إصدارك الحالي كما هو حتى تحذفه.';
  }

  @override
  String get settingsUpdateConfirmWait => 'انتظار';

  @override
  String settingsUpdateConfirmCountdown(String seconds) {
    return 'تثبيت على أي حال ($seconds)';
  }

  @override
  String get settingsUpdateConfirmInstall => 'تثبيت على أي حال';

  @override
  String get settingsUpdateConfirmPaused =>
      'حرّك الماوس أو اضغط مفتاحاً للمتابعة.';

  @override
  String get settingsAttentionUpdate => 'تحديث جاهز';

  @override
  String get settingsAttentionRejected => 'تمّ رفض الدخول';

  @override
  String get settingsAttentionExpiring => 'قريب من الانتهاء';

  @override
  String get settingsGithubTitle => 'GitHub (تحديثات التطبيق)';

  @override
  String get settingsGithubBody =>
      'تأتي التحديثات من مستودع خاص. سجّل الدخول بحساب GitHub الذي يملك صلاحية الوصول إليه.';

  @override
  String get settingsGithubSignIn => 'تسجيل الدخول بـ GitHub';

  @override
  String get settingsGithubSignOut => 'تسجيل الخروج';

  @override
  String get settingsGithubRecheck => 'فحص الصلاحية';

  @override
  String settingsGithubSignedInAs(String login) {
    return 'مسجّل باسم $login';
  }

  @override
  String settingsGithubCodeInstruction(String url) {
    return 'افتح $url وأدخل هذا الرمز:';
  }

  @override
  String get settingsGithubCodeCopied => 'تمّ نسخ الرمز.';

  @override
  String get settingsGithubAccessGranted => 'هذا الحساب يرى الإصدارات.';

  @override
  String settingsGithubAccessDenied(String login) {
    return 'هذا الحساب لا يرى الإصدارات. أضف $login إلى المستودع على GitHub ثم أعد الفحص.';
  }

  @override
  String get settingsGithubTokenRejected =>
      'رفض GitHub تسجيل الدخول المحفوظ. سجّل الدخول مرة أخرى.';

  @override
  String get settingsGithubAccessUnknown =>
      'تعذّر الوصول إلى GitHub لفحص الصلاحية.';

  @override
  String get settingsGithubNotConfigured =>
      'هذه النسخة لا تحمل معرّف GitHub، لذا التسجيل غير متاح.';

  @override
  String get settingsGithubDenied => 'تمّ رفض تسجيل الدخول في المتصفّح.';

  @override
  String get settingsGithubExpired =>
      'انتهت صلاحية الرمز قبل إدخاله. حاول مجدداً.';

  @override
  String get settingsGithubUnreachable => 'تعذّر الوصول إلى GitHub.';

  @override
  String get settingsGithubStorageFailed =>
      'سجّل GitHub دخولك، لكن تعذّر حفظ الرمز على هذا الجهاز. حاول مرة أخرى.';

  @override
  String get settingsGithubSharedToken =>
      'تستخدم التحديثات رمز وصول مشتركاً مدمجاً في التطبيق.';

  @override
  String get settingsGithubSharedTokenOk =>
      'الرمز المدمج يستطيع قراءة الإصدارات.';

  @override
  String get settingsGithubSharedRejected =>
      'تمّ رفض الرمز المدمج — منتهٍ أو مُلغى. الجميع على هذا الإصدار متأثر، ويلزم بناء جديد. يمكنك تسجيل الدخول بحسابك للمتابعة.';

  @override
  String get settingsGithubNoToken =>
      'لا تملك هذه النسخة وسيلة للوصول إلى الإصدارات، لذا لن تجد أي تحديث.';

  @override
  String get settingsGithubSignInOptional => 'سجّل الدخول بحسابك (اختياري)';

  @override
  String get settingsAccountTitle => 'حساب Supabase';

  @override
  String get settingsAccountSignedOut => 'لم يتم تسجيل الدخول.';

  @override
  String settingsAccountProfileError(String error) {
    return 'تعذّر تحميل ملفك الشخصي: $error';
  }

  @override
  String get settingsAccountColorLabel => 'لونك';

  @override
  String get settingsAccountColorHelp =>
      'يرى زملاؤك هذا اللون حول ما تقوم بتعديله.';

  @override
  String get settingsAccountColorButton => 'غيّر لونك';

  @override
  String get settingsAccountColorOthersLabel => 'حسابات أخرى، للمرجعية';

  @override
  String get settingsAccountStatusConnected => 'متصل';

  @override
  String get settingsAccountStatusSignedOut => 'غير مسجّل';

  @override
  String get settingsAccountStatusUnreachable => 'غير متاح';

  @override
  String get settingsServerAdvancedTitle => 'خيارات متقدمة — عنوان الخادم';

  @override
  String get settingsServerAdvancedHelp =>
      'لا تغيّر هذه القيم إلا عند الانتقال إلى مشروع Supabase آخر. كلتاهما ليست سرية؛ أما المفتاح السري (service_role) فلا يُخزَّن في التطبيق إطلاقًا.';

  @override
  String get settingsServerUrlLabel => 'عنوان المشروع';

  @override
  String get settingsServerAnonKeyLabel => 'المفتاح العام (anon)';

  @override
  String get settingsServerAnonKeyHelp =>
      'المفتاح العام — تخزينه هنا آمن. لا تلصق مفتاح service_role أبدًا.';

  @override
  String get settingsSyncTitle => 'مزامنة الفريق';

  @override
  String get settingsSyncDisabled =>
      'لا توجد قاعدة بيانات محلية على هذا الجهاز، لذا لا يمكن حفظ شيء أو مزامنته. يعرض التطبيق بيانات تجريبية.';

  @override
  String get settingsSyncPreparing =>
      'لم تتم المزامنة مع الفريق بعد. كل ما يُعرض هو ما يحتفظ به هذا الجهاز؛ تعديلاتك محفوظة هنا وتُرفع بعد أول مزامنة.';

  @override
  String get settingsSyncActive =>
      'متزامن مع الفريق. تُحفظ التعديلات هنا أولًا وتُرفع في الخلفية؛ وتصل تغييرات الزملاء والفهرس المشترك مع كل دورة.';

  @override
  String get settingsSyncOffline =>
      'غير متصل. تُحفظ تعديلاتك هنا وتُرفع عند عودة الاتصال.';

  @override
  String get settingsSyncBusy => 'جارٍ المزامنة مع الخادم…';

  @override
  String get settingsSyncConnecting => 'جارٍ الاتصال بالخادم…';

  @override
  String get settingsSyncUploading => 'جارٍ إرسال تغييراتك إلى الخادم…';

  @override
  String get settingsSyncDownloading => 'جارٍ تنزيل التغييرات من الخادم…';

  @override
  String settingsSyncDetailTable(String table, String rows) {
    return 'جارٍ تحديث $table — $rows صفًا';
  }

  @override
  String settingsSyncProgress(int done, int total) {
    return '$done من $total جداول';
  }

  @override
  String settingsSyncDetailUpload(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'جارٍ إرسال $count تغييرات محلية',
      one: 'جارٍ إرسال تغيير محلي واحد',
    );
    return '$_temp0';
  }

  @override
  String settingsSyncLastSynced(String when) {
    return 'آخر مزامنة في $when';
  }

  @override
  String get settingsSyncDeferred =>
      'موقف مؤقتًا أثناء تشغيل بحث، ليبقى الاتصال للبحث. تعديلاتك ما زالت تُرفع.';

  @override
  String settingsSyncError(String detail) {
    return 'مشكلة في المزامنة: $detail';
  }

  @override
  String settingsSyncLocalFault(String detail) {
    return 'توقّفت قاعدة البيانات على هذا الجهاز عن الاستجابة. لم يُفقد ما حُفظ سابقًا، لكن لا يمكن حفظ شيء جديد حتى تعود للعمل — تحقّق من القرص. $detail';
  }

  @override
  String get settingsSyncLogButton => 'تفاصيل المزامنة';

  @override
  String get settingsSyncLogTitle => 'ما الذي كانت المزامنة تفعله';

  @override
  String get settingsSyncLogIntro =>
      'كل طلب أرسله هذا الجهاز إلى الخادم منذ تشغيل التطبيق، والأحدث في الأسفل. انسخ هذا في تقرير المشكلة — فهو يوضّح الجدول الذي كان يُنزَّل، والزمن الذي استغرقته كل صفحة، وما ردّ به الخادم.';

  @override
  String get settingsSyncLogEmpty =>
      'لا يوجد شيء مسجَّل بعد. أول مزامنة ستكتب هنا.';

  @override
  String settingsSyncLogFile(String path) {
    return 'السجل الكامل، عبر عمليات إعادة التشغيل، محفوظ في:\n$path';
  }

  @override
  String get settingsSyncLogCopy => 'نسخ';

  @override
  String get settingsSyncLogCopied => 'تم نسخ سجل المزامنة.';

  @override
  String settingsSyncLogCounts(int passes, int failed) {
    String _temp0 = intl.Intl.pluralLogic(
      passes,
      locale: localeName,
      other: '$passes جولة حتى الآن',
      few: '$passes جولات حتى الآن',
      two: 'جولتان حتى الآن',
      one: 'جولة واحدة حتى الآن',
      zero: 'لا توجد جولات بعد',
    );
    String _temp1 = intl.Intl.pluralLogic(
      failed,
      locale: localeName,
      other: '$failed بها مشاكل',
      few: '$failed بها مشاكل',
      two: 'اثنتان بهما مشاكل',
      one: 'واحدة بها مشاكل',
      zero: 'ولا واحدة بها مشاكل',
    );
    return '$_temp0، $_temp1.';
  }

  @override
  String get syncNowTooltip => 'مزامنة البيانات مع الخادم';

  @override
  String get syncNowInProgress => 'جارٍ المزامنة…';

  @override
  String get syncNowDone => 'البيانات محدَّثة';

  @override
  String get syncNowLocalPushFailed =>
      'تمت المزامنة، لكن تعذّر رفع نتائج البحث الموجودة على هذا الجهاز.';

  @override
  String get syncNowLocalPullFailed =>
      'تمت مزامنة تعديلاتك، لكن تعذّر تنزيل أحدث بيانات البحث.';

  @override
  String get syncNowPipelineBusy =>
      'تمت مزامنة تعديلاتك. نتائج البحث يشاركها البحث نفسه أثناء تشغيله.';

  @override
  String syncNowError(String detail) {
    return 'تعذّر الوصول إلى الخادم: $detail';
  }

  @override
  String settingsSyncLastManual(String when, String detail) {
    return 'آخر مزامنة يدوية في $when: $detail';
  }

  @override
  String get settingsServerResetDefaults => 'استعادة الإعدادات الافتراضية';

  @override
  String get settingsServerSavedRestart =>
      'تم الحفظ. أعد تشغيل التطبيق ليصبح ساريًا.';

  @override
  String get settingsServerClearSaved => 'مسح القيم المحفوظة';

  @override
  String get settingsServerResetDone =>
      'تمت العودة إلى القيم الافتراضية لهذا الإصدار.';

  @override
  String get settingsServerCleared => 'تم مسح القيم المحفوظة.';

  @override
  String settingsServerActionFailed(String error) {
    return 'تعذّر تغيير عنوان الخادم: $error';
  }

  @override
  String get settingsServerStatusRestart =>
      'أعد تشغيل التطبيق لاستخدام هذه القيم.';

  @override
  String get settingsServerStatusUnsaved => 'تغييرات غير محفوظة.';

  @override
  String get settingsServerStatusCustom => 'يستخدم هذا الجهاز قيمًا خاصة به.';

  @override
  String get settingsServerStatusDefaults =>
      'يستخدم القيم الافتراضية لهذا الإصدار.';

  @override
  String get settingsServerShippedTitle => 'القيم المرفقة بهذا الإصدار';

  @override
  String get settingsServerShippedNone =>
      'صدر هذا الإصدار بدون عنوان خادم. أدخل عنوانًا أعلاه.';

  @override
  String get accessLevelFull => 'صلاحية كاملة';

  @override
  String get accessLevelFullExplanation =>
      'يمكنك رؤية كل شيء، بما في ذلك محتوى الرسائل والأسعار والعلامات التجارية وعناوين التواصل.';

  @override
  String get accessLevelBasic => 'صلاحية أساسية';

  @override
  String get accessLevelBasicExplanation =>
      'يمكنك معرفة أن هناك رسائل وصفقات وحالتها وتوقيتها. أما أسماء المؤثرين والقنوات والعلامات التجارية والأسعار وعناوين البريد فيحذفها الخادم قبل وصولها إليك.';

  @override
  String get accessLevelUnauthorized => 'لا توجد صلاحية بعد';

  @override
  String get accessLevelUnauthorizedExplanation =>
      'لم تُمنح حسابك صلاحية. اطلب من المسؤول منحك واحدة.';

  @override
  String get navLogs => 'السجل';

  @override
  String get logsSearchHint => 'ابحث في الأشخاص أو السجلات أو الحقول';

  @override
  String get logsFilterActor => 'الشخص';

  @override
  String get logsFilterAction => 'الإجراء';

  @override
  String get logsFilterEntity => 'نوع السجل';

  @override
  String get logsFilterAllPeople => 'الجميع';

  @override
  String get logsFilterAllActions => 'كل الإجراءات';

  @override
  String get logsFilterAllEntities => 'كل السجلات';

  @override
  String get logsRangeToday => 'اليوم';

  @override
  String get logsRange7Days => 'آخر ٧ أيام';

  @override
  String get logsRange30Days => 'آخر ٣٠ يوماً';

  @override
  String get logsClearFilters => 'مسح عوامل التصفية';

  @override
  String get logsEmpty =>
      'لم يُسجَّل أي إجراء بعد. تظهر الإجراءات هنا فور حدوثها.';

  @override
  String get logsNoMatches => 'لا توجد إجراءات تطابق هذه المرشحات.';

  @override
  String get logsEndOfList => 'هذه نهاية السجل.';

  @override
  String logsShowingCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString إدخالاً حتى الآن';
  }

  @override
  String logsNewCount(int count) {
    return '$count جديد';
  }

  @override
  String get logsLoadingMore => 'جارٍ تحميل المزيد…';

  @override
  String get logsDeletedAccount => 'حساب محذوف';

  @override
  String get logsDeletedAccountTooltip => 'أُزيل هذا الحساب، وما قام به محفوظ.';

  @override
  String logsActorRole(String role) {
    return 'بصلاحية $role';
  }

  @override
  String logsValueChange(String from, String to) {
    return '$from ← $to';
  }

  @override
  String logsNotesLengthChange(int before, int after) {
    final intl.NumberFormat beforeNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String beforeString = beforeNumberFormat.format(before);
    final intl.NumberFormat afterNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String afterString = afterNumberFormat.format(after);

    return '$beforeString ← $afterString حرفاً';
  }

  @override
  String get logsContentNotRecorded => 'لا يُسجَّل المحتوى عمداً.';

  @override
  String get logsOpenRecord => 'فتح';

  @override
  String get logsActionCreated => 'إنشاء';

  @override
  String get logsActionUpdated => 'تعديل';

  @override
  String get logsActionDeleted => 'حذف';

  @override
  String get logsActionTagsChanged => 'تغيير الوسوم';

  @override
  String get logsActionStageChanged => 'تغيير المرحلة';

  @override
  String get logsActionVettingChanged => 'تغيير حالة الفرز';

  @override
  String get logsActionNotesChanged => 'تعديل الملاحظات';

  @override
  String get logsActionContactsChanged => 'تغيير وسائل التواصل';

  @override
  String get logsActionContactAttempt => 'محاولة تواصل';

  @override
  String get logsActionEmailSent => 'إرسال بريد';

  @override
  String get logsActionSearchStarted => 'بدء بحث';

  @override
  String get logsActionVideosPulled => 'سحب فيديوهات';

  @override
  String get logsActionUnknown => 'أخرى';

  @override
  String get logsEntityChannel => 'قناة';

  @override
  String get logsEntityDeal => 'صفقة';

  @override
  String get logsEntityBrand => 'علامة تجارية';

  @override
  String get logsEntityThread => 'محادثة بريد';

  @override
  String get logsEntityRun => 'جولة بحث';

  @override
  String get logsEntitySettings => 'الإعدادات';

  @override
  String get logsEntityOther => 'أخرى';

  @override
  String get logsActivityTitle => 'النشاط';

  @override
  String get logsActivityEmpty => 'لا يوجد نشاط مسجل لهذه القناة بعد.';

  @override
  String get logsActivitySeeAll => 'عرض السجل كاملاً';

  @override
  String get notificationsTitle => 'الإشعارات';

  @override
  String get notificationsBellTooltip => 'الإشعارات';

  @override
  String get notificationsEmpty =>
      'لا يوجد شيء بعد. ستظهر هنا الإشعارات التي تراها.';

  @override
  String get notificationsClearAll => 'مسح الكل';

  @override
  String notificationsUnreadCount(int count) {
    return '$count جديد';
  }

  @override
  String get commonExpand => 'توسيع';

  @override
  String get commonCollapse => 'طي';

  @override
  String get commonCopied => 'تم النسخ';

  @override
  String get commonDay => 'اليوم';

  @override
  String get commonMonth => 'الشهر';

  @override
  String get commonYear => 'السنة';

  @override
  String get commonHour => 'الساعة';

  @override
  String get commonMinute => 'الدقيقة';

  @override
  String get commonSpinHint =>
      'مرّر عجلة الفأرة أو استخدم أسهم لوحة المفاتيح فوق أي خانة لتغييرها.';

  @override
  String get influencerProfileNoDescription => 'لا يوجد وصف لهذه القناة.';

  @override
  String get influencerProfileShowFullDescription => 'عرض الوصف كاملاً';

  @override
  String get influencerProfileShowLessDescription => 'عرض أقل';

  @override
  String get influencerProfileViewProfilePicture => 'عرض صورة القناة';

  @override
  String get influencerProfileViewBanner => 'عرض صورة الغلاف';

  @override
  String get influencerProfileImageZoomHint =>
      'مرّر أو قرّب للتكبير · اسحب للتحريك';

  @override
  String get influencerProfileImageResetZoom => 'إعادة ضبط التكبير';

  @override
  String get influencerProfileImageClose => 'إغلاق';

  @override
  String get influencerProfileContactsTitle => 'طرق التواصل';

  @override
  String get influencerProfileNoContacts => 'لم تُسجَّل أي وسيلة تواصل بعد.';

  @override
  String get influencerProfileAddContact => 'إضافة وسيلة تواصل';

  @override
  String get influencerProfileContactValueHint => 'عنوان أو رقم أو معرّف';

  @override
  String get influencerProfileContactLabelHint => 'لمن؟ (اختياري)';

  @override
  String get influencerProfileContactPrimary => 'الأساسية';

  @override
  String get influencerProfileContactMakePrimary =>
      'اجعلها وسيلة التواصل الأساسية';

  @override
  String get influencerProfileContactRemove => 'إزالة وسيلة التواصل';

  @override
  String get influencerProfileContactCopy => 'نسخ';

  @override
  String get influencerProfileContactsSaved => 'تم حفظ وسائل التواصل';

  @override
  String get contactMethodEmail => 'بريد إلكتروني';

  @override
  String get contactMethodWhatsapp => 'واتساب';

  @override
  String get contactMethodPhone => 'هاتف';

  @override
  String get contactMethodInstagram => 'إنستغرام';

  @override
  String get contactMethodTelegram => 'تيليغرام';

  @override
  String get contactMethodTwitter => 'إكس / تويتر';

  @override
  String get contactMethodDiscord => 'ديسكورد';

  @override
  String get contactMethodOther => 'أخرى';

  @override
  String influencerProfileCrmBasisCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'بناءً على $countString فيديو مخزّن';
  }

  @override
  String get influencerProfileCrmBasisWindow =>
      'يخزّن البحث ما يقارب آخر شهر من الفيديوهات. اسحب المزيد لتوسيع ما يُحسب عليه هذا الرقم.';

  @override
  String influencerProfileCrmSpanDays(int days) {
    final intl.NumberFormat daysNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String daysString = daysNumberFormat.format(days);

    return 'تغطي $daysString يوماً';
  }

  @override
  String get influencerProfileVideosAsList => 'عرض قائمة';

  @override
  String get influencerProfileVideosAsCards => 'عرض بطاقات';

  @override
  String get influencerProfileVideoNoDescription => 'لا يوجد وصف مخزّن.';

  @override
  String influencerProfileVideoCount(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return '$countString مخزّن';
  }

  @override
  String get influencerListHideImages => 'إيقاف الصور في هذه الصفحة';

  @override
  String get influencerListShowImages => 'إعادة تشغيل الصور';

  @override
  String get influencerListShowLatestVideo => 'عرض أحدث فيديو على كل بطاقة';

  @override
  String get influencerListHideLatestVideo => 'إخفاء أحدث فيديو';

  @override
  String get influencerListNoLatestVideo => 'لا فيديوهات مخزّنة';

  @override
  String get influencerListOpenChannel => 'فتح هذه القناة';

  @override
  String get influencerListRightClickHint =>
      'انقر بالزر الأيمن على قناة لتغيير حالتها أو وسومها.';

  @override
  String get influencerListScrollToBottom => 'التمرير إلى الأسفل';

  @override
  String get influencerListPinPosition => 'تثبيت هذا الموضع';

  @override
  String get influencerListReturnToPin => 'العودة إلى الموضع المثبت';

  @override
  String get influencerContextMenuStatus => 'الحالة';

  @override
  String get influencerContextMenuChannelTag => 'وسم القناة';

  @override
  String get influencerQuickTagPresetTooltip => 'قالب الوسم السريع';

  @override
  String get influencerQuickTagPresetDialogTitle => 'قالب الوسم السريع';

  @override
  String get influencerQuickTagPresetDialogDescription =>
      'اختر الوسوم لإضافتها بالنقر بالزر الأيمن مع Ctrl، أو إزالتها بالنقر بالزر الأيمن مع Alt، على قناة.';

  @override
  String get influencerQuickTagPresetEmpty =>
      'لا يوجد قالب وسم سريع محدد. اختر واحدًا من أيقونة الفرشاة أولًا.';

  @override
  String get channelTagUndecided => 'غير محدد';

  @override
  String get channelTagQualified => 'مؤهّل';

  @override
  String get channelTagHaramStuff => 'محتوى حرام';

  @override
  String get channelTagIrrelevant => 'غير ذي صلة';

  @override
  String get channelTagInactive => 'غير نشط';

  @override
  String get settingsImagesTitle => 'الصور المحفوظة';

  @override
  String get settingsAutoDownloadImagesLabel => 'حفظ الصور على هذا الجهاز';

  @override
  String get settingsAutoDownloadImagesOn =>
      'تُحفظ صور القنوات والأغلفة والمصغّرات بعد تحميلها مرة واحدة، فلا يجلب هذا الجهاز الصورة نفسها مرتين.';

  @override
  String get settingsAutoDownloadImagesOff =>
      'تُجلب الصور عند عرضها ولا يُكتب شيء على القرص. أما الصورة المحفوظة مسبقاً فتُستخدم قبل الشبكة في الحالتين.';

  @override
  String get settingsImagesNoStorage =>
      'لا يملك هذا الإصدار نظام ملفات للحفظ، لذا تُجلب كل صورة عند عرضها.';

  @override
  String settingsImageCacheSize(String size) {
    return 'المحفوظ: $size';
  }

  @override
  String get settingsImageCacheEmpty => 'لا شيء محفوظ بعد.';

  @override
  String settingsClearImageCache(String size) {
    return 'حذف الصور المحفوظة';
  }

  @override
  String settingsImageCacheCleared(String size) {
    return 'تم حذف $size من الصور المحفوظة.';
  }

  @override
  String get logsRangeAny => 'أي وقت';

  @override
  String get outreachNewMessage => 'رسالة جديدة';

  @override
  String get outreachPickInfluencerTitle => 'من تريد مراسلته؟';

  @override
  String get outreachPickInfluencerHint => 'ابحث عن القنوات بالاسم أو المعرّف';

  @override
  String get outreachPickInfluencerEmpty => 'لا توجد قنوات مطابقة.';

  @override
  String outreachNotifyReplyTitle(String who) {
    return 'ردّ $who';
  }

  @override
  String get outreachNotifyReplyAnonymousTitle => 'ردّ أحد صنّاع المحتوى';

  @override
  String get outreachNotifyFollowUpFailedTitle => 'تعذّر إرسال رسالة المتابعة';

  @override
  String get archiveBulkCleanStop => 'إيقاف';

  @override
  String get outreachComposeOpening => 'جارٍ فتح المحادثة…';

  @override
  String get outreachReminderDueToday => 'مستحق اليوم';

  @override
  String outreachReminderDueInDays(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'مستحق خلال $countString يوم';
  }

  @override
  String outreachReminderOverdueByDays(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    return 'متأخر بمقدار $countString يوم';
  }

  @override
  String get outreachLogReply => 'تسجيل رد';

  @override
  String get outreachShowProfile => 'إظهار الملف';

  @override
  String get outreachHideProfile => 'إخفاء الملف';

  @override
  String get outreachOpenFullProfile => 'فتح الملف الكامل';

  @override
  String get outreachComposeMethodLabel => 'طريقة التواصل';

  @override
  String outreachComposeSendVia(String method) {
    return 'الإرسال عبر $method';
  }

  @override
  String get outreachComposeToLabel => 'إلى';

  @override
  String get outreachComposeMessageLabel => 'الرسالة';

  @override
  String get outreachComposeNoContactYet =>
      'لا توجد وسيلة تواصل لهذه القناة. أضف واحدة لبدء المحادثة.';

  @override
  String outreachComposeAddContactFor(String method) {
    return 'أضف وسيلة تواصل عبر $method';
  }

  @override
  String get outreachComposeNothingToSend => 'اكتب رسالة قبل تمييزها كمُرسلة.';

  @override
  String get outreachOpenMailApp => 'فتح تطبيق البريد';

  @override
  String get outreachMailAppRefused =>
      'تعذّر فتح تطبيق بريد — تم نسخ الرسالة إلى الحافظة بدلاً من ذلك.';

  @override
  String get outreachBodyTooLongForMail =>
      'المسودة طويلة، لذا فُتح تطبيق البريد بالموضوع فقط — والنص في الحافظة للصقه.';

  @override
  String get outreachCopyBody => 'نسخ النص';

  @override
  String get outreachCopyMessage => 'نسخ الرسالة';

  @override
  String outreachCopyContactValue(String method) {
    return 'نسخ $method';
  }

  @override
  String get outreachOpenContactLink => 'فتح الرابط';

  @override
  String get outreachMarkSent => 'تمييز كمُرسلة';

  @override
  String outreachMessageSentVia(String method) {
    return 'تم التسجيل كمُرسلة عبر $method.';
  }

  @override
  String get outreachAddContactValueHint => 'العنوان أو الرقم أو المعرّف';

  @override
  String get outreachAddContactAdd => 'أضف واستخدم';

  @override
  String get outreachRecentUploadsTitle => 'أحدث الفيديوهات — مرجع للتوقيت';

  @override
  String get commonDateUnknown => 'تاريخ غير معروف';

  @override
  String get outreachScheduleFollowUp => 'جدولة متابعة';

  @override
  String outreachFollowUpDefaultTitle(String handle) {
    return 'متابعة مع $handle';
  }

  @override
  String get outreachFollowUpReminderLabel => 'ملاحظة التذكير';

  @override
  String get outreachFollowUpWhenLabel => 'متى';

  @override
  String get outreachFollowUpTomorrow => 'غداً';

  @override
  String get outreachFollowUpIn3Days => 'خلال 3 أيام';

  @override
  String get outreachFollowUpInAWeek => 'خلال أسبوع';

  @override
  String get outreachFollowUpCustom => 'مخصص…';

  @override
  String get outreachFollowUpPickDateTime => 'اختر التاريخ والوقت';

  @override
  String outreachFollowUpScheduled(String date) {
    return 'تم ضبط المتابعة في $date.';
  }

  @override
  String get outreachFollowUpSavedNoNotif =>
      'تم حفظ المتابعة — ستظهر في لوحة المعلومات.';

  @override
  String get outreachFollowUpMarkedDone => 'تم إنهاء المتابعة.';

  @override
  String get outreachFollowUpsSectionTitle => 'المتابعات المجدولة';

  @override
  String get outreachFollowUpClear => 'تمييز كمنتهية';

  @override
  String outreachFollowUpNumbered(int number, int total) {
    return 'المتابعة $number من $total';
  }

  @override
  String outreachFollowUpLeft(String duration) {
    return 'متبقٍّ $duration';
  }

  @override
  String outreachFollowUpOverdue(String duration) {
    return 'متأخرة $duration';
  }

  @override
  String outreachDurationDaysHours(int days, int hours) {
    return '$days ي $hours س';
  }

  @override
  String outreachDurationHoursMinutes(int hours, int minutes) {
    return '$hours س $minutes د';
  }

  @override
  String outreachDurationMinutes(int minutes) {
    return '$minutes د';
  }

  @override
  String get outreachFollowUpsEmpty => 'لا توجد متابعة مجدولة.';

  @override
  String get outreachFollowUpsSequenceDone =>
      'أُرسلت ثلاث متابعات دون رد. انتظر من أسبوعين إلى شهرين، ثم ابدأ محادثة جديدة بزاوية جديدة.';

  @override
  String get outreachFollowUpsApproval =>
      'تُكتب كل متابعة ويُوافَق عليها عند حلول موعدها. لا يُرسَل شيء تلقائيًا.';

  @override
  String get outreachNoFollowUps => 'لا توجد متابعات مجدولة.';

  @override
  String get outreachLogReplyTitle => 'تسجيل رد';

  @override
  String get outreachLogReplyBodyLabel => 'ما قالوه';

  @override
  String get outreachLogReplyMethodLabel => 'وصل عبر';

  @override
  String get outreachLogReplyReceivedLabel => 'تاريخ الاستلام';

  @override
  String get outreachReplyLogged => 'تم تسجيل الرد.';

  @override
  String get influencerProfileContactAction => 'تواصل';

  @override
  String get influencerProfileOpenConversation => 'فتح المحادثة';

  @override
  String get navArchive => 'الأرشيف';

  @override
  String get archiveTitle => 'الأرشيف';

  @override
  String get archiveExplanation =>
      'القنوات الموسومة بمحتوى محرّم أو غير ذات صلة يتم اختصارها إلى سجل قصير بعد ٧ أيام من وسمها، ويُحذف كل ما عداه: الفيديوهات والملاحظات وجهات الاتصال والوصف. لا يُحفظ سوى ما تراه هنا.';

  @override
  String archiveHoldingCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count قناة مؤرشفة',
      many: '$count قناة مؤرشفة',
      few: '$count قنوات مؤرشفة',
      two: 'قناتان مؤرشفتان',
      one: 'قناة واحدة مؤرشفة',
      zero: 'لا يوجد شيء في الأرشيف',
    );
    return '$_temp0';
  }

  @override
  String get archiveSearchHint => 'ابحث بالمعرّف';

  @override
  String get archiveFilterLabel => 'السبب';

  @override
  String get archiveFilterAllLabels => 'كل الأسباب';

  @override
  String get archiveSortLabel => 'ترتيب حسب';

  @override
  String get archiveSortArchivedAt => 'تاريخ الأرشفة';

  @override
  String get archiveSortHandle => 'المعرّف';

  @override
  String get archiveSortSubscribers => 'المشتركون';

  @override
  String get archiveSortVideos => 'عدد الفيديوهات';

  @override
  String get archiveSortAverageViews => 'متوسط المشاهدات';

  @override
  String get archiveEmpty => 'لم يتم أرشفة أي شيء بعد.';

  @override
  String get archiveEmptyHint =>
      'تصل القناة إلى هنا بعد ٧ أيام من وسمها بمحتوى محرّم أو غير ذات صلة.';

  @override
  String get archiveNoMatches => 'لا توجد قناة مؤرشفة تطابق هذا الفلتر.';

  @override
  String get archiveColumnSubscribers => 'المشتركون';

  @override
  String get archiveColumnAvgViews => 'وسيط المشاهدات';

  @override
  String get archiveColumnVideos => 'عدد الفيديوهات';

  @override
  String archiveArchivedOn(String date) {
    return 'أُرشفت في $date';
  }

  @override
  String archiveFoundOn(String date) {
    return 'اكتُشفت في $date';
  }

  @override
  String get archiveNoAverage => 'لم تُسجَّل أي مشاهدات';

  @override
  String get archiveMedianNotFetched =>
      'رُفضت بناءً على عدد المشتركين أثناء البحث، قبل جلب أي فيديو — لم يكن هناك وسيط لتسجيله';

  @override
  String get archiveMedianLifetime =>
      'الوسيط لكل الفيديوهات المخزّنة. لم يُنشر شيء في الـ 30 يومًا السابقة لآخر قراءة للقناة، فلا شيء لحساب متوسط الـ 30 يومًا عليه';

  @override
  String get archiveMedianWindow30 =>
      'وسيط المشاهدات في الـ 30 يومًا السابقة لآخر قراءة للقناة — نفس الرقم المعروض في قائمة المؤثرين';

  @override
  String get archiveVideosNotCounted =>
      'لم يُحسب — لم يُجلب أي فيديو لهذه القناة قبل أرشفتها';

  @override
  String get archiveVideosNone => 'قُرئت فيديوهات القناة ولم يوجد أي منها';

  @override
  String get archiveOpenOnYoutube => 'فتح في يوتيوب';

  @override
  String get archiveLoadMore => 'تحميل المزيد';

  @override
  String get archiveLoadFailed => 'تعذّر تحميل الأرشيف.';

  @override
  String get archiveRestoreNote =>
      'استخدم ✕ في الصف لتحرير قناة: تُدرَج في قائمة الإثراء وتعود إلى قائمة المؤثرين كاكتشاف جديد. لا يعود أي شيء مما حُذف.';

  @override
  String get archiveChangeReasonTooltip => 'تغيير السبب';

  @override
  String archiveReasonChanged(String reason) {
    return 'تم تغيير السبب إلى $reason';
  }

  @override
  String get archiveReasonChangeFailed => 'تعذّر تغيير السبب.';

  @override
  String get archiveFreeTooltip => 'تحرير هذه القناة وإعادة إثرائها';

  @override
  String get archiveFreeUnavailable =>
      'تحرير قناة يعيد إثراءها، وهذا يتطلّب تطبيق سطح المكتب المثبّت.';

  @override
  String archiveFreeConfirmTitle(String handle) {
    return 'تحرير $handle من الأرشيف؟';
  }

  @override
  String get archiveFreeConfirmBody =>
      'يُحذف السجل وتُدرَج القناة في قائمة الإثراء. تعود إلى قائمة المؤثرين كاكتشاف جديد غير مُقيَّم — بلا وسوم وبلا عدّاد. لا يعود أي شيء حُذف عند أرشفتها.';

  @override
  String get archiveFreeConfirmAction => 'تحرير وإثراء';

  @override
  String archiveFreeStarted(String handle) {
    return 'تم تحرير $handle — يجري الإثراء الآن. راجع صفحة البحث لمتابعة التقدّم.';
  }

  @override
  String get archiveFreeBusy =>
      'خط المعالجة مشغول حاليًا. أعد المحاولة بعد انتهاء التشغيل الحالي.';

  @override
  String get archiveFreeFailed => 'تعذّر تحرير القناة.';

  @override
  String influencerArchivesIn(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'تُؤرشف خلال $days يوم',
      many: 'تُؤرشف خلال $days يومًا',
      few: 'تُؤرشف خلال $days أيام',
      two: 'تُؤرشف بعد يومين',
      one: 'تُؤرشف غدًا',
      zero: 'تُؤرشف اليوم',
    );
    return '$_temp0';
  }

  @override
  String get influencerArchivePendingTitle => 'مجدولة للأرشفة';

  @override
  String influencerArchivePendingBody(String label, String date) {
    return 'هذه القناة موسومة بـ $label. في $date ستُختصر إلى معرّفها وأرقامها وذلك الوسم، وسيُحذف كل ما عداه — كل فيديو وملاحظة وجهة اتصال. أزل الوسم للاحتفاظ بها.';
  }

  @override
  String get influencerArchiveNow => 'أرشفة الآن';

  @override
  String get influencerArchiveNowConfirmTitle => 'أرشفة هذه القناة الآن؟';

  @override
  String get influencerArchiveNowConfirmBody =>
      'ستُختصر إلى معرّفها وعدد مشتركيها ومتوسط مشاهداتها وعدد فيديوهاتها ووسمها الآن. ستُحذف فيديوهاتها وملاحظاتها وجهات اتصالها ولا يمكن استرجاعها.';

  @override
  String get influencerArchiveNowConfirm => 'أرشفها';

  @override
  String get influencerArchiveScheduled => 'جارٍ الأرشفة الآن.';

  @override
  String get influencerArchiveKeep => 'الاحتفاظ بهذه القناة';

  @override
  String get influencerArchiveKept => 'تم إلغاء الأرشفة.';

  @override
  String get commonRefresh => 'تحديث';

  @override
  String get commonSortAscending => 'تصاعدي';

  @override
  String get commonSortDescending => 'تنازلي';

  @override
  String get navConflicts => 'التعارضات';

  @override
  String get conflictDetectedSnack =>
      'قام شخص آخر بالتعديل قبلك. نسختك محفوظة في صفحة التعارضات.';

  @override
  String get conflictChannelGone => 'لم تعد هذه القناة موجودة.';

  @override
  String get conflictsTitle => 'التعارضات';

  @override
  String get conflictsExplanation =>
      'لا يصل التعديل إلى هنا إلا إذا كُتب استنادًا إلى قيمة سبق أن غيّرها شخص آخر — بحيث لا تتضمن أي من النسختين الأخرى. أما التعديل فوق عمل زميل محفوظ فلا يظهر هنا أبدًا.';

  @override
  String get conflictsNone => 'لا توجد تعارضات.';

  @override
  String get conflictsNoneHint =>
      'التعديلات التي تبني على بعضها تُطبَّق تلقائيًا؛ ما يحتاج قرارًا هو المتباعد فعلًا.';

  @override
  String get conflictsOpenSection => 'بانتظار قرار';

  @override
  String get conflictsResolvedSection => 'تمت تسويتها مؤخرًا';

  @override
  String conflictsOpenCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تعارض',
      many: '$count تعارضًا',
      few: '$count تعارضات',
      two: 'تعارضان',
      one: 'تعارض واحد',
      zero: 'لا تعارضات',
    );
    return '$_temp0';
  }

  @override
  String conflictsShellBanner(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تعديل بانتظار قرار',
      many: '$count تعديلًا بانتظار قرار',
      few: '$count تعديلات بانتظار قرار',
      two: 'تعديلان بانتظار قرار',
      one: 'تعديل بانتظار قرار',
    );
    return '$_temp0';
  }

  @override
  String get conflictFieldNotes => 'الملاحظات';

  @override
  String get conflictFieldTags => 'وسوم القناة';

  @override
  String get conflictFieldStage => 'مرحلة المسار';

  @override
  String get conflictFieldVetting => 'حالة الفرز';

  @override
  String get conflictFieldCriteria => 'معايير الصلة';

  @override
  String get conflictFieldProvided => 'البيانات المقدَّمة';

  @override
  String get conflictFieldContacts => 'جهات الاتصال';

  @override
  String conflictOnChannel(String field, String channel) {
    return '$field في $channel';
  }

  @override
  String conflictMineBy(String name) {
    return 'كتب $name';
  }

  @override
  String conflictTheirsBy(String name) {
    return 'كتب $name';
  }

  @override
  String get conflictTheirsUnknown => 'كتب شخص آخر';

  @override
  String get conflictBaseWas => 'انطلق الاثنان من';

  @override
  String get conflictKeepMine => 'اعتماد هذه';

  @override
  String get conflictKeepTheirs => 'اعتماد هذه';

  @override
  String get conflictMerge => 'كتابة نص آخر';

  @override
  String get conflictMergeTitle => 'دمج النسختين';

  @override
  String get conflictMergeHint =>
      'النسختان أعلاه. عدّل هذا النص ليصبح ما يجب أن يقوله الحقل.';

  @override
  String get conflictMergeSave => 'حفظ هذا';

  @override
  String conflictResolvedBy(String name) {
    return 'سوّاها $name';
  }

  @override
  String conflictResolutionMine(String name) {
    return 'اعتمد نسخة $name';
  }

  @override
  String conflictResolutionTheirs(String name) {
    return 'اعتمد نسخة $name';
  }

  @override
  String get conflictResolutionMerged => 'دمج النسختين';

  @override
  String get conflictResolveFailed => 'تعذّرت تسوية هذا التعارض.';

  @override
  String get conflictAlreadyResolved => 'سوّاها شخص آخر بالفعل.';

  @override
  String get conflictOpenChannel => 'فتح القناة';

  @override
  String conflictProfileBannerTitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count تعديل على هذه القناة يحتاج قرارًا',
      many: '$count تعديلًا على هذه القناة يحتاج قرارًا',
      few: '$count تعديلات على هذه القناة تحتاج قرارًا',
      two: 'تعديلان على هذه القناة يحتاجان قرارًا',
      one: 'تعديل على هذه القناة يحتاج قرارًا',
    );
    return '$_temp0';
  }

  @override
  String get conflictProfileBannerAction => 'مراجعة';

  @override
  String conflictDetectedAt(String date) {
    return 'رُصد في $date';
  }

  @override
  String get conflictEmptyValue => '(فارغ)';

  @override
  String get archiveBulkCleanAction => 'تنظيف جماعي';

  @override
  String get archiveBulkCleanTitle => 'تنظيف جماعي حسب الحجم';

  @override
  String get archiveBulkCleanBody =>
      'يضع وسم الرفض على كل قناة يقع حجمها داخل النطاقات أدناه، دفعة واحدة. لا يُحذف شيء اليوم: القناة الموسومة تُؤرشف بعد ٧ أيام، وإزالة الوسم قبل ذلك تُبقيها.';

  @override
  String get archiveBulkCleanSubsSection => 'نطاق المشتركين المراد رفضه';

  @override
  String get archiveBulkCleanAvgSection => 'نطاق متوسط المشاهدات المراد رفضه';

  @override
  String get archiveBulkCleanRangeTip =>
      'نطاق رفض — عكس نطاق الإبقاء في صفحة البحث. تُوسم القناة التي تقع داخل كل نطاق تملؤه؛ وما خارجه يُترك.';

  @override
  String get archiveBulkCleanMinLabel => 'من (مشترك)';

  @override
  String get archiveBulkCleanMaxLabel => 'إلى (مشترك)';

  @override
  String get archiveBulkCleanAvgMinLabel => 'من (متوسط المشاهدات)';

  @override
  String get archiveBulkCleanAvgMaxLabel => 'إلى (متوسط المشاهدات)';

  @override
  String get archiveBulkCleanBoundsHint =>
      'اترك أحد الطرفين فارغًا لجعله مفتوحًا. لا تُرفض القناة إلا إذا كانت داخل كل نطاق تملؤه.';

  @override
  String get archiveBulkCleanNeedsBound =>
      'حدّد طرفًا واحدًا على الأقل في أحد النطاقين.';

  @override
  String get archiveBulkCleanLabelLabel => 'وسمها بـ';

  @override
  String get archiveBulkCleanImmediate => 'احذف الآن، وتخطَّ الـ٧ أيام';

  @override
  String get archiveBulkCleanImmediateHint =>
      'حذف دائم ومتسلسل: كل فيديو وملاحظة وجهة اتصال على هذه القنوات تذهب معها. مهلة الـ٧ أيام هي الشيء الوحيد الذي يفصل بين نطاق مكتوب خطأً وفقدانها كلها.';

  @override
  String get archiveBulkCleanPreview => 'افحص النطاق';

  @override
  String get archiveBulkCleanRecheck => 'أعد الفحص';

  @override
  String archiveBulkCleanDeleting(int done, int total) {
    return 'جارٍ حذف $done من $total…';
  }

  @override
  String archiveBulkCleanMatched(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count قناة مطابقة',
      many: '$count قناة مطابقة',
      few: '$count قنوات مطابقة',
      two: 'قناتان مطابقتان',
      one: 'قناة واحدة مطابقة',
      zero: 'لا توجد قناة داخل هذا النطاق',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanSkippedTagged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'و$count أخرى موسومة بالفعل وفي انتظار الأرشفة.',
      many: 'و$count أخرى موسومة بالفعل وفي انتظار الأرشفة.',
      few: 'و$count أخرى موسومة بالفعل وفي انتظار الأرشفة.',
      two: 'واثنتان أخريان موسومتان بالفعل وفي انتظار الأرشفة.',
      one: 'وواحدة أخرى موسومة بالفعل وفي انتظار الأرشفة.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanSkippedProtected(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'وتُركت $count لوجود صفقات أو سجلات تواصل معها.',
      many: 'وتُركت $count لوجود صفقات أو سجلات تواصل معها.',
      few: 'وتُركت $count لوجود صفقات أو سجلات تواصل معها.',
      two: 'وتُركت اثنتان لوجود صفقات أو سجلات تواصل معهما.',
      one: 'وتُركت واحدة لوجود صفقة أو سجل تواصل معها.',
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
          'و$count قناة ينقصها رقم تحتاجه هذه النطاقات، فهي خارج كل النطاقات.',
      many:
          'و$count قناة ينقصها رقم تحتاجه هذه النطاقات، فهي خارج كل النطاقات.',
      few:
          'و$count قنوات ينقصها رقم تحتاجه هذه النطاقات، فهي خارج كل النطاقات.',
      two: 'وقناتان ينقصهما رقم تحتاجه هذه النطاقات، فهما خارج كل النطاقات.',
      one: 'وقناة واحدة ينقصها رقم تحتاجه هذه النطاقات، فهي خارج كل النطاقات.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanConfirmTag(int count) {
    return 'وسم $count';
  }

  @override
  String archiveBulkCleanConfirmDelete(int count) {
    return 'احذف $count الآن';
  }

  @override
  String archiveBulkCleanTagged(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'وُسمت $count قناة. تُؤرشف بعد ٧ أيام.',
      many: 'وُسمت $count قناة. تُؤرشف بعد ٧ أيام.',
      few: 'وُسمت $count قنوات. تُؤرشف بعد ٧ أيام.',
      two: 'وُسمت قناتان. تُؤرشفان بعد ٧ أيام.',
      one: 'وُسمت قناة واحدة. تُؤرشف بعد ٧ أيام.',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanArchived(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أُرشفت $count قناة.',
      many: 'أُرشفت $count قناة.',
      few: 'أُرشفت $count قنوات.',
      two: 'أُرشفت قناتان.',
      one: 'أُرشفت قناة واحدة.',
    );
    return '$_temp0';
  }

  @override
  String get archiveBulkCleanFailed => 'تعذّر تنفيذ التنظيف الجماعي.';

  @override
  String get archiveBulkCleanUnavailable =>
      'التنظيف الجماعي يتطلب صلاحية كاملة.';

  @override
  String get archiveBulkCleanModeLive => 'مباشر';

  @override
  String get archiveBulkCleanModeScheduled => 'مجدولة للأرشفة';

  @override
  String get archiveBulkCleanDueTitle =>
      'تصرّف في القنوات التي يُعدّ لها العدّ التنازلي بالفعل';

  @override
  String get archiveBulkCleanDueBody =>
      'يعمل على القنوات الموسومة بالفعل والتي يُعدّ لها العدّ التنازلي نحو الأرشفة. ضيّق النطاق بما أدناه، أو اتركه فارغًا للوصول إلى كل قناة مستحقة الآن.';

  @override
  String archiveBulkCleanDueMatched(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count قناة مستحقة الآن',
      many: '$count قناة مستحقة الآن',
      few: '$count قنوات مستحقة الآن',
      two: 'قناتان مستحقتان الآن',
      one: 'قناة واحدة مستحقة الآن',
      zero: 'لا توجد قناة مستحقة داخل هذا النطاق',
    );
    return '$_temp0';
  }

  @override
  String archiveBulkCleanConfirmArchiveNow(int count) {
    return 'أرشف $count الآن';
  }

  @override
  String archiveBulkCleanConfirmUndo(int count) {
    return 'تراجع عن أرشفة $count';
  }

  @override
  String get archiveBulkCleanArchiveNowHint =>
      'يتخطى ما تبقى من الـ٧ أيام ويحذف الآن. حذف دائم ومتسلسل: كل فيديو وملاحظة وجهة اتصال على هذه القنوات تذهب معها.';

  @override
  String get archiveBulkCleanUndoHint =>
      'يزيل كل وسم عن هذه القنوات، تمامًا كإزالتها يدويًا. يُلغي العدّ التنازلي — لا يُحذف شيء.';

  @override
  String archiveBulkCleanUndone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أُزيل وسم $count قناة. أُلغي العدّ التنازلي.',
      many: 'أُزيل وسم $count قناة. أُلغي العدّ التنازلي.',
      few: 'أُزيل وسم $count قنوات. أُلغي العدّ التنازلي.',
      two: 'أُزيل وسم قناتين. أُلغي العدّ التنازلي.',
      one: 'أُزيل وسم قناة واحدة. أُلغي العدّ التنازلي.',
    );
    return '$_temp0';
  }

  @override
  String get searchAutoCleanTitle => 'تنظيف النتائج تلقائيًا';

  @override
  String get searchAutoCleanBody =>
      'نطاقان للإبقاء — نطاق مشتركين ونطاق متوسط مشاهدات. القناة التي تقع داخل الاثنين تُجمع بشكل طبيعي، والتي تقع خارج أيٍّ منهما يُتعامل معها: لنطاق المشتركين أثناء التشغيل نفسه قبل أن تكلّف فيديوهاتها شيئًا؛ وللنطاقين معًا في كنسٍ لما عثر عليه التشغيل بعد انتهائه.';

  @override
  String get searchAutoCleanEnable => 'طبّق هذا على كل تشغيل';

  @override
  String get searchAutoCleanEnableHint =>
      'يعمل وحده دون خطوة تأكيد. خيارا «أدنى/أعلى» يحدّدان معناه — اتركه مطفأً ما لم تكن تلك خيارات ستتّخذها دون قراءة عدد أولًا.';

  @override
  String get searchAutoCleanOff => 'مطفأ — لا يُمس شيء بعد التشغيل';

  @override
  String get searchAutoCleanNoBounds => 'مُفعّل، لكن بلا نطاق — لن يُنظّف شيء';

  @override
  String get searchAutoCleanSubsSectionTitle => 'نطاق المشتركين المراد إبقاؤه';

  @override
  String get searchAutoCleanAvgSectionTitle =>
      'نطاق وسيط المشاهدات المراد إبقاؤه';

  @override
  String get searchAutoCleanKeepBandTip =>
      'نطاق إبقاء. القناة التي يقع رقمها داخله تُجمع بشكل طبيعي؛ والتي تقع خارجه — من أي طرف — هي ما تتصرّف فيه هذه القاعدة.';

  @override
  String get searchAutoCleanActionSweepNote =>
      'الأرشفة أثناء التشغيل — تُوسم القناة مرفوضة وتُزامَن للأعلى قبل جلب فيديوهاتها، ويسمها الكنس بعد التشغيل أيضًا.';

  @override
  String get searchAutoCleanActionDelayNote =>
      'الإبقاء وجلب الفيديوهات لاحقًا — تبقى القناة ولا تُؤرشف؛ تُتخطّى فيديوهاتها الآن وتُقرأ لاحقًا من قائمة الانتظار.';

  @override
  String get searchAutoCleanActionOffNote =>
      'المعاملة كأنها ضمن النطاق — لا شيء خاص؛ تُجمع تمامًا كقناة داخل النطاق.';

  @override
  String get searchAutoCleanAvgNote =>
      'نفس نطاق الإبقاء أعلاه، لكن متوسط مشاهدات القناة لا يُعرف حتى تُقرأ فيديوهاتها — لذا فالتي تقع خارج هذا النطاق يتولّاها دائمًا الكنس بعد التشغيل، ولا تُؤجَّل أبدًا.';

  @override
  String get searchAutoCleanHousePreset =>
      'استخدم قاعدة الوكالة: نحو 50 ألف مشاهدة، بلا حد للحجم';

  @override
  String get searchAutoCleanKeepAvgMinLabel => 'أبقِ من (وسيط المشاهدات)';

  @override
  String get searchAutoCleanKeepAvgMaxLabel => 'أبقِ حتى (وسيط المشاهدات)';

  @override
  String searchAutoCleanKeepSummary(String range) {
    return 'يُبقي $range';
  }

  @override
  String searchAutoCleanRejectsSummary(String ranges) {
    return 'يرفض القنوات الجديدة $ranges';
  }

  @override
  String searchAutoCleanGateBelow(String action) {
    return 'أدنى ← $action';
  }

  @override
  String searchAutoCleanGateAbove(String action) {
    return 'أعلى ← $action';
  }

  @override
  String searchAutoCleanAlsoRejects(String ranges) {
    return 'ويرفض أيضًا $ranges';
  }

  @override
  String get searchAutoCleanActionSweep => 'مؤرشف';

  @override
  String get searchAutoCleanActionDelay => 'الفيديوهات مؤجّلة';

  @override
  String get searchAutoCleanActionOff => 'يُترك ضمن النطاق';

  @override
  String get searchAutoCleanBelowMinLabel => 'دون النطاق';

  @override
  String get searchAutoCleanAboveMaxLabel => 'فوق النطاق';

  @override
  String get searchAutoCleanKeepMinLabel => 'أبقِ من (مشتركين)';

  @override
  String get searchAutoCleanKeepMaxLabel => 'أبقِ حتى (مشتركين)';

  @override
  String get searchAutoCleanActionSweepOption => 'أرشفها أثناء التشغيل';

  @override
  String get searchAutoCleanActionDelayOption =>
      'أبقِها واجلب فيديوهاتها لاحقًا';

  @override
  String get searchAutoCleanActionOffOption => 'عاملها كأنها ضمن النطاق';

  @override
  String get searchAutoCleanAnd => ' و';

  @override
  String get searchAutoCleanSubscribersWord => 'مشترك';

  @override
  String get searchAutoCleanAvgViewsWord => 'وسيط مشاهدات';

  @override
  String searchAutoCleanUnder(String what, int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'أقل من $valueString $what';
  }

  @override
  String searchAutoCleanOver(String what, int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'أكثر من $valueString $what';
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
      'اترك أحد طرفَي النطاق فارغًا لجعله مفتوحًا. وبلا أي نطاق محدَّد، لا يُنظَّف شيء.';

  @override
  String get searchAutoCleanNeedsBound =>
      'حدّد طرفًا واحدًا على الأقل لأحد النطاقين، وإلا لن يُنظّف شيء.';

  @override
  String get searchAutoCleanScopeNote =>
      'القنوات التي عثر عليها هذا التشغيل فقط. أمّا قناة عُثر عليها في تشغيل سابق، أو رآها أحد بالفعل، فلا تُمس أبدًا.';

  @override
  String get searchAutoCleanGraceNote =>
      'وسم فقط. تُؤرشف القنوات الموسومة بعد ٧ أيام، وإزالة الوسم قبل ذلك تُبقيها. لا يُحذف شيء تلقائيًا.';

  @override
  String searchAutoCleanRan(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'التشغيل الأخير: وُسمت $count قناة، تُؤرشف بعد ٧ أيام',
      many: 'التشغيل الأخير: وُسمت $count قناة، تُؤرشف بعد ٧ أيام',
      few: 'التشغيل الأخير: وُسمت $count قنوات، تُؤرشف بعد ٧ أيام',
      two: 'التشغيل الأخير: وُسمت قناتان، تُؤرشفان بعد ٧ أيام',
      one: 'التشغيل الأخير: وُسمت قناة واحدة، تُؤرشف بعد ٧ أيام',
      zero: 'التشغيل الأخير: لا شيء يطابق النطاقات',
    );
    return '$_temp0';
  }

  @override
  String searchAutoCleanSkippedUnknown(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count أخرى تُرِكت دون تغيير: لم يُسجّل لها متوسط مشاهدات، فهي خارج كل النطاقات.',
      one:
          'واحدة أخرى تُرِكت دون تغيير: لم يُسجّل لها متوسط مشاهدات، فهي خارج كل النطاقات.',
      zero: '',
    );
    return '$_temp0';
  }

  @override
  String get searchAutoCleanFailed =>
      'تعذّر تنفيذ التنظيف التلقائي. أما البحث نفسه فانتهى بشكل طبيعي.';

  @override
  String get searchAutoCleanMinVideosLabel =>
      'الحد الأدنى للفيديوهات (آخر ٣٠ يومًا)';

  @override
  String get searchAutoCleanMinVideosHint =>
      'ارفض القناة التي نشرت أقل من هذا العدد من الفيديوهات في آخر ٣٠ يومًا. اتركه فارغًا لتجاهل مدى نشاط القناة.';

  @override
  String searchAutoCleanFewerVideos(int value) {
    final intl.NumberFormat valueNumberFormat = intl.NumberFormat.compact(
      locale: localeName,
    );
    final String valueString = valueNumberFormat.format(value);

    return 'أقل من $valueString فيديو في ٣٠ يومًا';
  }

  @override
  String get dashboardAnalyticsTitle => 'تحليلات القنوات';

  @override
  String get dashboardAnalyticsBody =>
      'كل ما وجدته المنظومة، وما بداخله. الفلاتر تضيّق ما يُعرض ويُحسب هنا فقط — لا تغيّر شيئًا ولا تؤرشف شيئًا. الحد الأدنى/الأقصى شاملان: تظهر القناة عندما تقع عند كل حدٍّ تضبطه أو داخله. وكل رقم بالأسفل يتبع الفلتر.';

  @override
  String get dashboardAnalyticsFailed => 'تعذّر تحميل التحليلات.';

  @override
  String get dashboardAnalyticsNoChannels => 'لا توجد قناة تطابق هذا الفلتر.';

  @override
  String get dashboardAnalyticsFilterCountry => 'الدولة';

  @override
  String get dashboardAnalyticsFilterStage => 'مرحلة المسار';

  @override
  String get dashboardAnalyticsFilterVetting => 'الفرز';

  @override
  String get dashboardAnalyticsFilterTag => 'الوسم';

  @override
  String get dashboardAnalyticsFilterAny => 'الكل';

  @override
  String get dashboardAnalyticsFilterMinSubs => 'أقل عدد مشتركين';

  @override
  String get dashboardAnalyticsFilterMaxSubs => 'أكبر عدد مشتركين';

  @override
  String get dashboardAnalyticsFilterMinAvgViews =>
      'أقل متوسط مشاهدات (٣٠ يومًا)';

  @override
  String get dashboardAnalyticsFilterMaxAvgViews =>
      'أكبر متوسط مشاهدات (٣٠ يومًا)';

  @override
  String get dashboardAnalyticsFilterMinVideos =>
      'أقل عدد فيديوهات نُشرت الشهر الماضي';

  @override
  String get dashboardAnalyticsClearFilters => 'مسح الفلاتر';

  @override
  String get dashboardAnalyticsLegendLive => 'نشطة';

  @override
  String get dashboardAnalyticsLegendArchiveDue => 'بانتظار الأرشفة';

  @override
  String get dashboardAnalyticsLegendArchived => 'مؤرشفة';

  @override
  String dashboardAnalyticsArchivedCount(String count) {
    return '+$count مؤرشفة';
  }

  @override
  String dashboardAnalyticsArchivedValue(String value) {
    return '+$value مؤرشفة';
  }

  @override
  String get dashboardAnalyticsArchivedViewsNote =>
      'متوسط مشاهدات القنوات المؤرشفة رقم تراكمي لكامل عمر القناة، وليس لآخر ٣٠ يومًا.';

  @override
  String dashboardAnalyticsArchiveDueCount(String count) {
    return '-$count بانتظار الأرشفة';
  }

  @override
  String dashboardAnalyticsArchiveDueValue(String value) {
    return '-$value بانتظار الأرشفة';
  }

  @override
  String get dashboardAnalyticsStatChannels => 'القنوات';

  @override
  String get dashboardAnalyticsStatMedianSubs => 'وسيط المشتركين';

  @override
  String get dashboardAnalyticsStatMeanSubs => 'متوسط المشتركين';

  @override
  String get dashboardAnalyticsStatTotalSubs => 'إجمالي الوصول';

  @override
  String get dashboardAnalyticsStatFound => 'قنوات مكتشَفة هذا الشهر';

  @override
  String get dashboardAnalyticsStatUploads => 'مقاطع هذا الشهر';

  @override
  String get dashboardAnalyticsStatAvgViews => 'وسيط المشاهدات (٣٠ يومًا)';

  @override
  String get dashboardAnalyticsStatWithDeal => 'لها صفقة سابقة';

  @override
  String dashboardAnalyticsSubsCoverage(int known, int total) {
    return '$known من $total لها عدد مشتركين مسجَّل';
  }

  @override
  String get dashboardAnalyticsMeanVsMedian =>
      'أعداد المشتركين ملتوية التوزيع: قناة كبيرة واحدة ترفع المتوسط، فالوسيط هو ما يصف الصف الاعتيادي.';

  @override
  String get dashboardAnalyticsChartTiers => 'توزيع المشتركين';

  @override
  String get dashboardAnalyticsChartCountries => 'الدول';

  @override
  String get dashboardAnalyticsChartStages => 'مرحلة المسار';

  @override
  String get dashboardAnalyticsChartVetting => 'الفرز';

  @override
  String get dashboardAnalyticsChartTags => 'الوسوم';

  @override
  String get dashboardAnalyticsChartDiscovered => 'المكتشَفة شهريًا';

  @override
  String get dashboardAnalyticsChartViewTiers => 'توزيع متوسط المشاهدات';

  @override
  String get dashboardAnalyticsToggleIndependent => 'تبديل المقياس المستقل';

  @override
  String dashboardAnalyticsViewsNote(int known, int total) {
    return '$known من $total لها متوسط مشاهدات مقاس لآخر ٣٠ يومًا؛ والباقي يُحسب صفرًا ضمن شريحة أقل من ١٠ آلاف. الشرائح نفسها المستخدمة في مخطط المشتركين أعلاه.';
  }

  @override
  String dashboardAnalyticsCountriesNote(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أعلى ١٢ دولة بعدد القنوات. $count قناة بلا دولة مسجَّلة.',
      many: 'أعلى ١٢ دولة بعدد القنوات. $count قناة بلا دولة مسجَّلة.',
      few: 'أعلى ١٢ دولة بعدد القنوات. $count قنوات بلا دولة مسجَّلة.',
      two: 'أعلى ١٢ دولة بعدد القنوات. قناتان بلا دولة مسجَّلة.',
      one: 'أعلى ١٢ دولة بعدد القنوات. قناة واحدة بلا دولة مسجَّلة.',
      zero: 'أعلى ١٢ دولة بعدد القنوات.',
    );
    return '$_temp0';
  }

  @override
  String get dashboardAnalyticsTagsNote =>
      'القناة التي تحمل وسمين تُحسب في كليهما، لذا يزيد المجموع عن العدد الكلي.';

  @override
  String get dashboardAnalyticsUntagged => 'بلا وسم';

  @override
  String get dashboardAnalyticsNothingHere => 'لا شيء لعرضه بعد.';

  @override
  String get navEmailLibrary => 'مكتبة نقد الرسائل';

  @override
  String get emailLibraryTitle => 'مكتبة نقد الرسائل';

  @override
  String get emailLibraryTabInfluencers => 'صُنّاع المحتوى';

  @override
  String get emailLibraryTabBrands => 'العلامات التجارية';

  @override
  String get emailLibraryNewRecord => 'سجل رسالة جديد';

  @override
  String get emailLibraryNewRecordTitle => 'سجل رسالة جديد';

  @override
  String get emailLibraryEditRecordTitle => 'سجل الرسالة';

  @override
  String get emailLibraryManageTags => 'إدارة الوسوم';

  @override
  String get emailLibrarySearchHint => 'ابحث في الموضوع والنص والسياق والنقد';

  @override
  String get emailLibrarySourceAll => 'الكل';

  @override
  String get emailLibrarySourceVideo => 'من الفيديوهات';

  @override
  String get emailLibrarySourceTestDraft => 'مسودات الاختبار';

  @override
  String get emailLibrarySourceAppDraft => 'مسوداتي';

  @override
  String get emailLibrarySourceMine => 'أمثلتي';

  @override
  String get emailLibraryBadgeTestDraft => 'مسودة اختبار';

  @override
  String get emailLibraryBadgeAppDraft => 'مسودتي';

  @override
  String get emailLibraryBadgeMine => 'مثالي';

  @override
  String get emailLibraryVerdictGood => 'جيدة';

  @override
  String get emailLibraryVerdictBad => 'سيئة';

  @override
  String get emailLibraryUnrated => 'غير مقيّمة';

  @override
  String get emailLibraryFieldVerdict => 'التقييم';

  @override
  String get emailLibraryVerdictWhyBad => 'لماذا هي سيئة؟';

  @override
  String get emailLibraryVerdictWhyGood => 'ما الذي يجعلها جيدة؟ (اختياري)';

  @override
  String get emailLibraryVerdictWhyHint =>
      'المسودات الجيدة تصبح حالات يجب أن تجتازها إصدارات المهارة اللاحقة. أما السيئة فتُكتب من جديد مع سببك، للتأكد من زوال الخطأ.';

  @override
  String get emailLibraryVerdictWhyRequired =>
      'اذكر الخطأ، كي تعرف الجولة التالية عمّا تبحث.';

  @override
  String emailLibraryBenchImported(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تم استيراد $count مسودات اختبار',
      one: 'تم استيراد مسودة اختبار واحدة',
    );
    return '$_temp0 من آخر جولة اختبار.';
  }

  @override
  String get emailLibraryMyExample => 'مثالي';

  @override
  String get emailLibraryMyExampleHint =>
      'إحدى رسائلك التي نجحت. يقرؤها مصنع المهارات كمثال، ولا ينسخ صياغتها أبدًا.';

  @override
  String emailLibraryKnobs(String knobs) {
    return 'مكتوبة لـ: $knobs';
  }

  @override
  String get emailLibraryClearFilters => 'مسح عوامل التصفية';

  @override
  String get emailLibrarySortLastEdited => 'آخر تعديل';

  @override
  String get emailLibrarySortLastCreated => 'آخر إنشاء';

  @override
  String get emailLibrarySortVideoDate => 'تاريخ الفيديو';

  @override
  String get emailLibraryEmpty =>
      'لا يوجد شيء بعد. أضف أول رسالة وما قاله الخبير عنها.';

  @override
  String get emailLibraryNoMatches => 'لا توجد سجلات مطابقة لهذه التصفية.';

  @override
  String get emailLibraryLoadFailed => 'تعذّرت قراءة المكتبة المحلية.';

  @override
  String get emailLibraryUnavailable =>
      'لا توجد مكتبة رسائل محلية على هذا الجهاز.';

  @override
  String get emailLibraryUnavailableDetail =>
      'المكتبة ملف واحد اسمه data/database/email_library.db بجوار قاعدة بيانات خط المعالجة، وهي متاحة في تطبيق سطح المكتب المثبَّت فقط. إن كنت على سطح المكتب وما زلت ترى هذه الرسالة، فراجع الإعدادات ← ضبط البحث ← جذر المشروع.';

  @override
  String get emailLibraryFieldVideoDate => 'تاريخ الفيديو';

  @override
  String get emailLibraryNoDate => 'بلا تاريخ';

  @override
  String get emailLibraryVideoDateDay => 'اليوم';

  @override
  String get emailLibraryVideoDateMonth => 'الشهر';

  @override
  String get emailLibraryVideoDateYear => 'السنة';

  @override
  String get emailLibraryFieldVideoUrl => 'رابط الفيديو';

  @override
  String get emailLibraryVideoUrlHint => 'رابط الفيديو التدريبي';

  @override
  String get emailLibraryFieldTimecode => 'التوقيت داخل الفيديو';

  @override
  String get emailLibraryTimecodeHint => '1:05:30';

  @override
  String get emailLibraryTimecodeInvalid =>
      'استخدم h:mm:ss أو m:ss أو ثوانٍ فقط.';

  @override
  String get emailLibraryTimecodeHours => 'الساعات';

  @override
  String get emailLibraryTimecodeMinutes => 'الدقائق';

  @override
  String get emailLibraryTimecodeSeconds => 'الثواني';

  @override
  String get emailLibraryTimecodeScrollHint =>
      'مرّر عجلة الفأرة أو استخدم أسهم لوحة المفاتيح فوق أي خانة لتغييرها.';

  @override
  String get emailLibraryOpenAtTimecode => 'افتح الفيديو عند هذه اللحظة';

  @override
  String get emailLibraryOpenVideo => 'افتح الفيديو المصدر';

  @override
  String get emailLibraryOpenFailed => 'تعذّر فتح هذا الرابط.';

  @override
  String get emailLibraryFieldStage => 'المرحلة';

  @override
  String get emailLibraryFieldNiche => 'المجالات';

  @override
  String get emailLibraryNicheSearchHint => 'ابحث في المجالات';

  @override
  String get emailLibraryNoNicheTags =>
      'لا توجد وسوم بعد. استخدم + لإضافة واحد.';

  @override
  String get emailLibraryFieldContext => 'السياق';

  @override
  String get emailLibraryContextHint => 'لمن كُتبت الرسالة، وما الذي سبقها';

  @override
  String get emailLibraryFieldSubject => 'الموضوع';

  @override
  String get emailLibraryFieldBody => 'نص الرسالة';

  @override
  String get emailLibraryBodyHint => 'الصق الرسالة كما كُتبت تمامًا';

  @override
  String get emailLibraryFieldCritique => 'نقد الخبير';

  @override
  String get emailLibraryCritiqueHint => 'ما قاله الخبير عنها، ولماذا';

  @override
  String get emailLibraryAddTag => 'إضافة وسم';

  @override
  String get emailLibraryAddStageTag => 'وسم مرحلة جديد';

  @override
  String get emailLibraryAddNicheTag => 'وسم مجال جديد';

  @override
  String get emailLibraryTagLabel => 'الاسم';

  @override
  String get emailLibraryTagLabelHelp =>
      'إن كان الوسم موجودًا بهذا الاسم فسيُعاد استخدامه.';

  @override
  String get emailLibraryQuotedToContext => 'أُضيف إلى حقل السياق.';

  @override
  String get emailLibraryAddKeyword => 'إضافة كلمة مفتاحية';

  @override
  String emailLibraryAddKeywordNamed(String keyword) {
    return 'إضافة \"@$keyword\"';
  }

  @override
  String get emailLibraryAddPlaceholderTag => 'كلمة مفتاحية جديدة';

  @override
  String get emailLibraryPlaceholderHelp =>
      'كلمة واحدة. تتحوّل المسافات إلى شرطات سفلية حتى يمكن كتابتها مجددًا بصيغة @word.';

  @override
  String get emailLibrarySaveAndAnother => 'حفظ وإضافة آخر';

  @override
  String get emailLibrarySaved => 'تم الحفظ.';

  @override
  String get emailLibrarySaveFailed => 'تعذّر الحفظ في المكتبة المحلية.';

  @override
  String get emailLibraryNothingToSave => 'لم تُكتب أي بيانات بعد.';

  @override
  String get emailLibraryDiscardTitle => 'تجاهل هذا السجل؟';

  @override
  String get emailLibraryDiscardBody => 'ما كُتب هنا لم يُحفظ.';

  @override
  String get emailLibraryDiscard => 'تجاهل';

  @override
  String get emailLibraryDeleteTitle => 'حذف هذا السجل؟';

  @override
  String get emailLibraryDeleteBody =>
      'ستُحذف الرسالة ونقدها من المكتبة المحلية، ولا يمكن التراجع عن ذلك.';

  @override
  String get emailLibraryNoSubject => 'بلا موضوع';

  @override
  String get emailLibraryRenameTag => 'إعادة تسمية';

  @override
  String emailLibraryTagUsage(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'مستخدم في $count سجل',
      many: 'مستخدم في $count سجلًا',
      few: 'مستخدم في $count سجلات',
      two: 'مستخدم في سجلين',
      one: 'مستخدم في سجل واحد',
      zero: 'غير مستخدم في أي سجل',
    );
    return '$_temp0';
  }

  @override
  String emailLibraryDeleteTagTitle(String label) {
    return 'حذف \"$label\"؟';
  }

  @override
  String emailLibraryDeleteTagBody(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'سيُحذف كذلك من $count سجل.',
      many: 'سيُحذف كذلك من $count سجلًا.',
      few: 'سيُحذف كذلك من $count سجلات.',
      two: 'سيُحذف كذلك من سجلين.',
      one: 'سيُحذف كذلك من سجل واحد.',
      zero: 'لا توجد سجلات تستخدم هذا الوسم.',
    );
    return '$_temp0';
  }

  @override
  String get logsActionReplyReceived => 'وصل رد';

  @override
  String get outreachSendWithGmail => 'أرسل عبر Gmail';

  @override
  String get outreachSendingWithGmail => 'جارٍ الإرسال…';

  @override
  String outreachGmailSentAs(String account) {
    return 'تم الإرسال من $account.';
  }

  @override
  String outreachGmailSentWithFollowUps(String account, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count رسائل متابعة في الانتظار',
      one: 'رسالة متابعة واحدة في الانتظار',
    );
    return 'تم الإرسال من $account. $_temp0 — تُلغى فور وصول ردهم.';
  }

  @override
  String outreachGmailSendFailed(String reason) {
    return 'تعذر الإرسال: $reason';
  }

  @override
  String outreachGmailNotEmail(String method) {
    return 'صندوق البريد يرسل رسائل بريد فقط. استخدم النسخ والفتح مع $method.';
  }

  @override
  String get outreachGmailNotConnected =>
      'لا يوجد صندوق بريد متصل على هذا الجهاز.';

  @override
  String get outreachGmailConnectAction => 'اربط صندوقًا';

  @override
  String get outreachGmailReconnectAction => 'أعد الربط';

  @override
  String get outreachGmailSendUnavailableHint =>
      'اربط صندوق بريد من الإعدادات للإرسال من داخل التطبيق. وحتى ذلك، لا يزال فتح برنامج البريد متاحًا.';

  @override
  String get outreachFollowUpBodyLabel => 'رسالة المتابعة';

  @override
  String get outreachCheckReplies => 'ابحث عن الردود';

  @override
  String get outreachCheckingReplies => 'جارٍ فحص صندوق البريد…';

  @override
  String get outreachNoNewReplies => 'لا توجد ردود جديدة.';

  @override
  String outreachRepliesApplied(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ردود جديدة',
      one: 'رد جديد واحد',
    );
    return 'تم تسجيل $_temp0.';
  }

  @override
  String outreachRepliesAppliedWithCancels(int replies, int cancelled) {
    String _temp0 = intl.Intl.pluralLogic(
      replies,
      locale: localeName,
      other: '$replies ردود جديدة',
      one: 'رد جديد واحد',
    );
    String _temp1 = intl.Intl.pluralLogic(
      cancelled,
      locale: localeName,
      other: '$cancelled رسائل متابعة',
      one: 'رسالة متابعة واحدة',
    );
    return 'تم تسجيل $_temp0، وإلغاء $_temp1.';
  }

  @override
  String outreachFollowUpsSentNote(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'خرجت $count رسائل متابعة',
      one: 'خرجت رسالة متابعة واحدة',
    );
    return '$_temp0.';
  }

  @override
  String outreachMarkedInterested(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'انتقلت $count قنوات إلى “مهتم”',
      one: 'انتقلت قناة واحدة إلى “مهتم”',
    );
    return '$_temp0.';
  }

  @override
  String outreachSweepFailed(String reason) {
    return 'تعذر فحص صندوق البريد: $reason';
  }

  @override
  String outreachQueuedFollowUps(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count متابعات في الانتظار',
      one: 'متابعة واحدة في الانتظار',
      zero: 'لا توجد متابعات في الانتظار',
    );
    return '$_temp0';
  }

  @override
  String get outreachCancelFollowUps => 'ألغِ المتابعات المنتظرة';

  @override
  String outreachFollowUpsCancelled(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'تم إلغاء $count متابعات',
      one: 'تم إلغاء متابعة واحدة',
      zero: 'لم يكن هناك شيء في الانتظار',
    );
    return '$_temp0.';
  }

  @override
  String get settingsMailboxTitle => 'صندوق بريد التواصل';

  @override
  String get settingsMailboxSubtitle =>
      'حساب Gmail الذي تُرسل منه رسائل التواصل، والمتابعات المنتظرة خلفها. يُضبط لكل جهاز — من يُشغّل المعالجة هو من يرسل البريد.';

  @override
  String settingsMailboxConnectedAs(String account) {
    return 'متصل باسم $account';
  }

  @override
  String get settingsMailboxNotConnected => 'لا يوجد صندوق بريد متصل';

  @override
  String settingsMailboxLabelledAs(String label) {
    return 'توضع على الرسائل المُرسلة علامة “$label”';
  }

  @override
  String get settingsMailboxConnectHint =>
      'اربط حساب Gmail الذي تُرسل منه رسائل التواصل. ستُفتح نافذة متصفح لتسجيل الدخول بذلك العنوان.';

  @override
  String get settingsMailboxSignIn => 'تسجيل الدخول';

  @override
  String get settingsMailboxAddAnother => 'إضافة صندوق بريد آخر';

  @override
  String get settingsMailboxConnecting => 'في انتظار المتصفح…';

  @override
  String get settingsMailboxConnectingHint =>
      'أكمل تسجيل الدخول في نافذة المتصفح التي فُتحت للتو.';

  @override
  String get settingsMailboxConnected => 'تم ربط صندوق البريد.';

  @override
  String get settingsMailboxSignOut => 'تسجيل الخروج';

  @override
  String get settingsMailboxSignedOut =>
      'تم تسجيل الخروج من صندوق البريد على هذا الجهاز.';

  @override
  String settingsMailboxSignedOutOf(String account) {
    return 'تم تسجيل الخروج من $account.';
  }

  @override
  String get settingsMailboxSignOutTitle => 'تسجيل الخروج من صندوق البريد هذا؟';

  @override
  String get settingsMailboxSignOutBody =>
      'سيتوقف هذا الجهاز عن إرسال رسائل التواصل والمتابعات حتى يُربط صندوق بريد من جديد. يحتفظ حساب Google بصلاحيته حتى تُلغيها من myaccount.google.com/permissions.';

  @override
  String settingsMailboxSignOutTitleFor(String account) {
    return 'تسجيل الخروج من $account؟';
  }

  @override
  String settingsMailboxSignOutBodyFor(String account) {
    return 'سيتوقف هذا الجهاز عن الإرسال باسم $account ومتابعة محادثاته حتى يُربط من جديد. يحتفظ حساب Google بصلاحيته حتى تُلغيها من myaccount.google.com/permissions.';
  }

  @override
  String get settingsMailboxTokenExpiryNote =>
      'ما دام تطبيق Google في وضع الاختبار، ينتهي الاتصال بعد سبعة أيام — سجّل الدخول من جديد لتجديده.';

  @override
  String get settingsMailboxRefresh => 'تحديث';

  @override
  String get settingsMailboxTestSend => 'أرسل رسالة اختبار';

  @override
  String settingsMailboxTestSent(String to) {
    return 'تم إرسال رسالة الاختبار إلى $to.';
  }

  @override
  String settingsMailboxCountersSent(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count رسائل مُرسلة',
      one: 'رسالة واحدة مُرسلة',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxCountersAwaiting(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count في انتظار الرد',
      one: 'واحدة في انتظار الرد',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxCountersQueued(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count متابعات في الانتظار',
      one: 'متابعة واحدة في الانتظار',
    );
    return '$_temp0';
  }

  @override
  String settingsMailboxFailedSteps(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'توقفت $count متابعات بعد تكرار الفشل',
      one: 'توقفت متابعة واحدة بعد تكرار الفشل',
    );
    return '$_temp0';
  }

  @override
  String get settingsMailboxDesktopOnly =>
      'يتم الإرسال من تطبيق سطح المكتب المثبّت على الجهاز الذي يُشغّل المعالجة.';

  @override
  String get settingsMailboxAccountsRowTitle => 'تم تسجيل الدخول';

  @override
  String settingsMailboxCapLine(int cap, int left) {
    return '$cap رسالة باردة يوميًا · متبقٍّ اليوم $left';
  }

  @override
  String settingsMailboxWarmupWarming(int days) {
    return 'قيد التسخين: اليوم $days من 14 على الأقل';
  }

  @override
  String settingsMailboxWarmupDone(int days) {
    return 'مُسخَّن منذ $days يومًا';
  }

  @override
  String get settingsMailboxWarmupNotSet => 'لم يُحدَّد تاريخ بدء التسخين';

  @override
  String get settingsMailboxEditLimits => 'الحد اليومي والتسخين';

  @override
  String settingsMailboxLimitsTitle(String account) {
    return 'الحد اليومي والتسخين لـ $account';
  }

  @override
  String settingsMailboxCapLabel(int cap) {
    return 'الرسائل الباردة يوميًا: $cap';
  }

  @override
  String get settingsMailboxCapHelp =>
      '35 هو الافتراضي المعتمد، ويمكن ضبطه بين 10 و50. الردود على من راسلونا لا تُحتسب.';

  @override
  String get settingsMailboxWarmupLabel => 'بدأ التسخين في';

  @override
  String get settingsMailboxWarmupHelp =>
      'التسخين نفسه يتم في Instantly. الحد الأدنى 14 يومًا قبل الرسائل الباردة، والأفضل من 30 إلى 90 يومًا.';

  @override
  String get settingsMailboxWarmupPick => 'اختر تاريخًا';

  @override
  String get settingsMailboxWarmupClear => 'مسح التاريخ';

  @override
  String get settingsMailboxLimitsSaved =>
      'تم الحفظ. الإرسال التالي يستخدم الحدود الجديدة.';

  @override
  String get settingsAgencyTitle => 'بيانات الوكالة';

  @override
  String get settingsAgencySubtitle =>
      'ما يجوز لمحرك الصياغة قوله عن الوكالة، ومن ترفض التعامل معه، وهدف الفريق اليومي. مشتركة مع الفريق كله.';

  @override
  String get settingsAgencyName => 'اسم الوكالة';

  @override
  String get settingsAgencySender => 'من يوقّع الرسائل';

  @override
  String get settingsAgencyWhatWeDo => 'ماذا نفعل';

  @override
  String get settingsAgencyWebsite => 'الموقع الإلكتروني';

  @override
  String get settingsAgencyTrueClaims => 'ادعاءات صحيحة';

  @override
  String get settingsAgencyTrueClaimsHelp =>
      'حقيقة واحدة في كل سطر. لا يدّعي المحرك إلا ما هنا، بكلماته، وفقط حين يجيب عن شيء.';

  @override
  String get settingsAgencyPastCampaigns => 'حملات سابقة';

  @override
  String get settingsAgencyPastCampaignsHelp =>
      'واحدة في كل سطر، مثل العلامة التجارية وصانع المحتوى.';

  @override
  String get settingsAgencyIncubator =>
      'نحن جزء من مجموعة من أصحاب الوكالات ذوي الخبرة يراجعون عملنا';

  @override
  String get settingsAgencyIncubatorHelp =>
      'فقط إن كان صحيحًا. يستخدمه المحرك كملاذ أخير فقط.';

  @override
  String get settingsAgencyBoycottSection => 'المقاطعة';

  @override
  String get settingsAgencyBoycottCountries => 'الدول المقاطَعة';

  @override
  String get settingsAgencyBoycottCountriesHelp =>
      'رموز الدول من حرفين، مفصولة بفواصل. العلامة التجارية من إحداها لا تُعرض عليها أي صفقة ولا صانع محتوى.';

  @override
  String get settingsAgencyBoycottBrands => 'العلامات التجارية المقاطَعة';

  @override
  String get settingsAgencyBoycottBrandsHelp =>
      'علامة واحدة في كل سطر، بما فيها العلامات الداعمة لاحتلال فلسطين.';

  @override
  String get settingsAgencyCountryInvalid =>
      'استخدم رموز دول من حرفين، مثل IL.';

  @override
  String get settingsAgencyDailyTarget => 'رسائل جيدة يوميًا (هدف الفريق)';

  @override
  String get settingsAgencyDailyTargetInvalid =>
      'أدخل عددًا صحيحًا من 1 إلى 500.';

  @override
  String get settingsAgencySaved => 'حُفظت بيانات الوكالة للفريق.';

  @override
  String get creatorPrescreenTitle => 'الفحص المبدئي';

  @override
  String creatorPrescreenViewsMet(String views) {
    return '$views وسيط المشاهدات خلال 30 يومًا، يحقق حد ~50 ألفًا';
  }

  @override
  String creatorPrescreenViewsBelow(String views) {
    return '$views وسيط المشاهدات خلال 30 يومًا، دون حد ~50 ألفًا';
  }

  @override
  String get creatorPrescreenViewsUnknown => 'لم تُقَس المشاهدات بعد';

  @override
  String creatorPrescreenUploads(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count مقاطع خلال آخر 30 يومًا',
      one: 'مقطع واحد خلال آخر 30 يومًا',
      zero: 'لا مقاطع خلال آخر 30 يومًا',
    );
    return '$_temp0';
  }

  @override
  String creatorPrescreenSponsored(int percent) {
    return 'إفصاحات رعاية في $percent% من المقاطع المخزّنة';
  }

  @override
  String get creatorPrescreenNotSponsored =>
      'لا إفصاحات رعاية في المقاطع المخزّنة';

  @override
  String get creatorPrescreenSponsorUnknown =>
      'لم تُقرأ المقاطع بحثًا عن الرعايات بعد';

  @override
  String creatorPrescreenBrands(String brands) {
    return 'شوهد مع: $brands';
  }

  @override
  String creatorPrescreenCountry(String country) {
    return 'الدولة: $country';
  }

  @override
  String get creatorPrescreenCountryUnknown => 'الدولة غير مذكورة';

  @override
  String get creatorPrescreenAgent =>
      'لديه وكيل: اسلك طريق الخصم، اشترِ بأقل من سعره وبِع به.';

  @override
  String get creatorGoldMine => 'منجم ذهب';

  @override
  String get creatorGoldMineHelp =>
      'بلا وكيل، ومشاهداته أو تفاعله قوية بالنسبة لحجمه. ابدأ بصفقات مخفّضة؛ وبعد 2-3 صفقات تُثبت أننا ننجز، يمكن لشخص أن يقترح إدارة حصرية بنسبة 20-40% (نحو 25% في البداية).';

  @override
  String get creatorFlagLabel => 'صانع المحتوى';

  @override
  String get creatorFlagNotRecorded => 'غير مسجّل';

  @override
  String get creatorFlagMale => 'ذكر';

  @override
  String get creatorFlagFemale => 'أنثى';

  @override
  String get creatorFlagCouple => 'زوجان';

  @override
  String get creatorFlagUnknown => 'غير واضح';

  @override
  String get creatorFlagOutOfScope =>
      'خارج النطاق: الوكالة لا تتواصل مع صانعات المحتوى ولا قنوات الأزواج ولا تعرضهم.';

  @override
  String get creatorFlagSaved => 'حُفظ تصنيف صانع المحتوى.';

  @override
  String get mediaKitTitle => 'ملف الوسائط';

  @override
  String get mediaKitEdit => 'تعديل ملف الوسائط';

  @override
  String get mediaKitEmpty =>
      'لا يوجد ملف وسائط بعد. اطلب من صانع المحتوى إحصاءات جمهوره (أهم الدول، الأعمار) وأسعاره.';

  @override
  String get mediaKitReady => 'جاهز للعرض';

  @override
  String get mediaKitNotReady => 'غير جاهز للعرض بعد';

  @override
  String mediaKitAudienceShare(String share) {
    return '$share% من الجمهور في الولايات المتحدة والمملكة المتحدة وكندا';
  }

  @override
  String get mediaKitGapAnalytics =>
      'ينقص: إحصاءات الجمهور (أهم الدول والفئة العمرية)';

  @override
  String get mediaKitGapRate => 'ينقص: سعر متفق عليه مع صانع المحتوى';

  @override
  String get mediaKitGapAudience =>
      'أقل من 20% من الجمهور في الولايات المتحدة والمملكة المتحدة وكندا، قليل حتى في التقنية';

  @override
  String get mediaKitGapOutOfScope => 'خارج النطاق: قناة أنثى أو زوجين';

  @override
  String mediaKitCountriesLine(String countries) {
    return 'أهم الدول: $countries';
  }

  @override
  String mediaKitAgeLine(String age) {
    return 'الفئة العمرية الرئيسية: $age';
  }

  @override
  String mediaKitEngagementLine(String rate) {
    return 'التفاعل: $rate%';
  }

  @override
  String mediaKitLinkLine(String link) {
    return 'الملف: $link';
  }

  @override
  String mediaKitRateAgreed(String format, String price) {
    return '$format: $price، متفق عليه';
  }

  @override
  String mediaKitRateAsking(String format, String price) {
    return '$format: $price، مطلوب';
  }

  @override
  String get mediaKitCountriesLabel => 'أهم الدول';

  @override
  String get mediaKitCountryCode => 'رمز الدولة';

  @override
  String get mediaKitShare => 'النسبة (%)';

  @override
  String get mediaKitAddCountry => 'أضف دولة';

  @override
  String get mediaKitAgeBand => 'الفئة العمرية الرئيسية';

  @override
  String get mediaKitAgeBandHint => 'مثلًا 18-34';

  @override
  String get mediaKitEngagement => 'التفاعل (%)';

  @override
  String get mediaKitLink => 'رابط ملف الوسائط';

  @override
  String get mediaKitRatesLabel => 'قائمة الأسعار (دولار)';

  @override
  String get mediaKitFormat => 'النوع';

  @override
  String get mediaKitPrice => 'السعر';

  @override
  String get mediaKitAgreed => 'متفق عليه مع صانع المحتوى';

  @override
  String get mediaKitAddRate => 'أضف سعرًا';

  @override
  String get mediaKitRemoveRow => 'إزالة';

  @override
  String get mediaKitInvalidCode => 'حرفان';

  @override
  String get mediaKitInvalidNumber => 'رقم';

  @override
  String get mediaKitSaved => 'حُفظ ملف الوسائط.';

  @override
  String get influencerFilterShowOnly => 'اعرض فقط';

  @override
  String get influencerFilterHasEmail => 'لديه بريد إلكتروني';

  @override
  String get influencerFilterSponsored => 'سبقت رعايته';

  @override
  String get influencerFilterShortlisted => 'في القائمة المختصرة';

  @override
  String get influencerFilterReadyToPitch => 'جاهز للعرض';

  @override
  String get influencerFilterNeverContacted => 'لم نتواصل معه بعد';

  @override
  String get influencerContextMenuShortlist => 'أضف إلى القائمة المختصرة';

  @override
  String get influencerContextMenuUnshortlist => 'أزل من القائمة المختصرة';

  @override
  String get influencerContextMenuAddToCampaign => 'أضف إلى حملة';

  @override
  String get influencerContextMenuNoCampaigns =>
      'لا توجد حملة نشطة للإضافة إليها. أنشئ واحدة من صفحة علامة تجارية أولًا.';

  @override
  String influencerContextMenuAddedToCampaign(String campaign) {
    return 'أُضيف إلى $campaign.';
  }

  @override
  String influencerContextMenuAddedNotReady(String campaign) {
    return 'أُضيف إلى $campaign، لكنه غير جاهز للعرض بعد: احصل على إحصاءات جمهوره وسعر متفق عليه قبل إرسال العرض.';
  }

  @override
  String get commonClose => 'إغلاق';

  @override
  String get navRailCollapse => 'إظهار الأيقونات فقط';

  @override
  String get navRailExpand => 'إظهار التسميات';

  @override
  String get outreachHideThreadList => 'إخفاء قائمة المحادثات';

  @override
  String get outreachShowThreadList => 'إظهار قائمة المحادثات';

  @override
  String get outreachDeleteThread => 'حذف المحادثة';

  @override
  String get outreachDeleteThreadConfirm =>
      'سيؤدي هذا إلى حذف المحادثة وكل رسائلها لدى الجميع. وأي رد يصل لاحقًا لن يجد محادثة يُضاف إليها.';

  @override
  String get outreachThreadDeleted => 'تم حذف المحادثة.';

  @override
  String get outreachDeleteMessage => 'حذف الرسالة';

  @override
  String get outreachDeleteMessageConfirm =>
      'سيؤدي هذا إلى حذف سجل هذه الرسالة. أما الرسالة التي أُرسلت فعلًا فلا يمكن استرجاعها بحذفها من هنا.';

  @override
  String get outreachMessageDeleted => 'تم حذف الرسالة.';

  @override
  String get outreachCopyAiBrief => 'انسخ الملخص للذكاء الاصطناعي';

  @override
  String get outreachAiBriefCopied =>
      'تم نسخ ملخص القناة والتعليمات — الصقها في الذكاء الاصطناعي.';

  @override
  String get outreachBriefDialogTitle => 'الملخص المُرسل للذكاء الاصطناعي';

  @override
  String get outreachBriefDialogSubtitle =>
      'كل ما يعرفه الذكاء الاصطناعي عن هذه القناة، وما هو مطلوب منه. الملخص منسوخ بالفعل في الحافظة.';

  @override
  String get outreachBriefCopyAgain => 'انسخ مرة أخرى';

  @override
  String get outreachBriefPromptSection => 'المطلوب من الذكاء الاصطناعي';

  @override
  String get outreachBriefSectionChannel => 'القناة';

  @override
  String get outreachBriefSectionAudience => 'الجمهور';

  @override
  String get outreachBriefSectionLatestUpload => 'آخر فيديو';

  @override
  String get outreachBriefSectionRecentUploads => 'أحدث الفيديوهات';

  @override
  String get outreachBriefSectionFit => 'لماذا هذه القناة';

  @override
  String get outreachBriefSectionDraft => 'أدوات الصياغة';

  @override
  String get outreachBriefSectionOther => 'مضمَّن أيضًا';

  @override
  String get outreachBriefFieldChannelName => 'الاسم';

  @override
  String get outreachBriefFieldChannelHandle => 'المعرِّف';

  @override
  String get outreachBriefFieldContactName => 'جهة الاتصال';

  @override
  String get outreachBriefFieldCountry => 'الدولة';

  @override
  String get outreachBriefFieldChannelUrl => 'رابط القناة';

  @override
  String get outreachBriefFieldChannelDescription => 'الوصف';

  @override
  String get outreachBriefFieldSubscriberCount => 'المشتركون';

  @override
  String get outreachBriefFieldMedianViews => 'وسيط المشاهدات';

  @override
  String get outreachBriefFieldLastVideoTitle => 'العنوان';

  @override
  String get outreachBriefFieldLastVideoPublishedAt => 'تاريخ النشر';

  @override
  String get outreachBriefFieldLastVideoViews => 'المشاهدات';

  @override
  String get outreachBriefFieldLastVideoUrl => 'الرابط';

  @override
  String get outreachBriefFieldLastVideoDescription => 'الوصف';

  @override
  String get outreachBriefFieldRecentVideoTitles => 'العناوين';

  @override
  String get outreachBriefFieldRelevanceCriteria => 'معايير الملاءمة';

  @override
  String get outreachBriefFieldNotes => 'ملاحظات';

  @override
  String get outreachBriefFieldSenderName => 'الإرسال باسم';

  @override
  String get outreachBriefFieldWritingRules => 'قواعد الكتابة';

  @override
  String get outreachBriefFieldTemplateName => 'القالب';

  @override
  String get outreachBriefFieldTemplateSubject => 'عنوان القالب';

  @override
  String get outreachBriefFieldTemplateBody => 'نص القالب';

  @override
  String get outreachBriefThin =>
      'لا يكاد يوجد شيء مسجَّل عن هذه القناة، لذا لن يجد الذكاء الاصطناعي ما يبني عليه. إضافة الملاحظات أو معايير الملاءمة أو تحديث الفيديوهات هو ما يصنع الفرق هنا.';

  @override
  String get videoCatchUpTitle => 'استكمال الفيديوهات الناقصة';

  @override
  String get videoCatchUpWhat =>
      'قنوات عثرت عليها عمليات بحث سابقة ولم تُقرأ فيديوهاتها الأخيرة بعد. تعمل هذه المهمة في الخلفية بهدوء حتى يكتمل متوسط المشاهدات، وتتنحّى فور بدء أي بحث.';

  @override
  String videoCatchUpProgress(String read, String saved, String total) {
    return 'قُرئت $read · حُفظت $saved من $total';
  }

  @override
  String get videoCatchUpStarting =>
      'جارٍ حساب عدد القنوات التي ما زالت بلا فيديوهات…';

  @override
  String videoCatchUpEta(String rate, String timeLeft) {
    return '≈ $rate قناة/دقيقة · يتبقى نحو $timeLeft';
  }

  @override
  String get videoCatchUpResumeNote =>
      'يُحفظ التقدّم أولًا بأول — لن يضيع بإغلاق التطبيق أو ببدء بحث؛ ستكمل المهمة التالية من هنا.';

  @override
  String videoCatchUpCurrentChannel(String handle) {
    return 'جارٍ قراءة $handle';
  }

  @override
  String videoCatchUpSharing(String shared, String total) {
    return 'جارٍ مشاركة القنوات المكتملة مع الفريق — رُفع $shared من $total. تُستأنف القراءة عند الانتهاء.';
  }

  @override
  String get videoCatchUpLayerReading => 'القنوات المقروءة';

  @override
  String get videoCatchUpLayerFetching => 'التفاصيل المحفوظة';

  @override
  String videoCatchUpDone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'اكتملت $count قناة — انتهى الآن',
      two: 'اكتملت قناتان — انتهى الآن',
      one: 'اكتملت قناة واحدة — انتهى الآن',
      zero: 'لا شيء متبقٍ للاستكمال',
    );
    return '$_temp0';
  }

  @override
  String videoCatchUpPaused(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'متوقفة مؤقتًا بعد $count قناة لإفساح المجال — ستكمل من حيث توقفت',
      zero: 'متوقفة مؤقتًا لإفساح المجال — ستكمل من حيث توقفت',
    );
    return '$_temp0';
  }

  @override
  String get videoCatchUpFailed =>
      'توقفت مبكرًا. لم يضع شيء — ستحاول مرة أخرى تلقائيًا.';

  @override
  String channelArrivalsFromSearch(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'وصلت $count قناة جديدة الآن من البحث الجاري على هذا الجهاز',
      two: 'وصلت قناتان جديدتان الآن من البحث الجاري على هذا الجهاز',
      one: 'وصلت قناة جديدة الآن من البحث الجاري على هذا الجهاز',
    );
    return '$_temp0';
  }

  @override
  String channelArrivalsFromTeam(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'وصلت $count قناة جديدة الآن من بيانات الفريق المشتركة',
      two: 'وصلت قناتان جديدتان الآن من بيانات الفريق المشتركة',
      one: 'وصلت قناة جديدة الآن من بيانات الفريق المشتركة',
    );
    return '$_temp0';
  }

  @override
  String get channelArrivalsDismiss => 'إخفاء';

  @override
  String searchResumedNotice(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'تم استئناف البحث المتوقف من الجلسة السابقة — بقيت $count كلمات مفتاحية',
      two: 'تم استئناف البحث المتوقف من الجلسة السابقة — بقيت كلمتان',
      one:
          'تم استئناف البحث المتوقف من الجلسة السابقة — بقيت كلمة مفتاحية واحدة',
    );
    return '$_temp0';
  }

  @override
  String get searchResumedAction => 'عرض';

  @override
  String get dashboardKeywordsTitle => 'تقييم الكلمات المفتاحية';

  @override
  String get dashboardKeywordsBody =>
      'كل كلمة مفتاحية بحث بها المسار، ومدى مشاهدة القنوات التي جلبتها. تقع كل قناة في شريحة حسب متوسط مشاهداتها خلال آخر ٣٠ يومًا.';

  @override
  String get dashboardKeywordsFilterHint => 'تصفية الكلمات المفتاحية';

  @override
  String get dashboardKeywordsSortLabel => 'ترتيب حسب';

  @override
  String get dashboardKeywordsSortWeighted => 'الدرجة المرجّحة بالشرائح';

  @override
  String get dashboardKeywordsSortChannels => 'عدد القنوات';

  @override
  String get dashboardKeywordsSortMedian => 'وسيط المشاهدات';

  @override
  String get dashboardKeywordsSortHighestFirst => 'الأعلى أولًا — اضغط للأدنى';

  @override
  String get dashboardKeywordsSortLowestFirst => 'الأدنى أولًا — اضغط للأعلى';

  @override
  String get dashboardKeywordsEmpty =>
      'لم تجلب أي كلمة مفتاحية قناة مقيسة بعد.';

  @override
  String get dashboardKeywordsScoreCaption => 'درجة';

  @override
  String dashboardKeywordsRowSummary(String channels, String views) {
    return '$channels قناة · ~$views مشاهدة';
  }

  @override
  String dashboardKeywordsShowingCount(int shown, int total) {
    return 'عرض $shown من $total';
  }

  @override
  String dashboardKeywordsSheetSummary(String score, int channels) {
    return 'الدرجة المرجّحة بالشرائح $score · $channels قناة مقيسة';
  }

  @override
  String get dashboardKeywordsTierOver1m => 'وسيط مشاهدات مليون فأكثر';

  @override
  String get dashboardKeywordsTier250kTo1m => 'وسيط مشاهدات ٢٥٠ ألف – مليون';

  @override
  String get dashboardKeywordsTier50kTo250k => 'وسيط مشاهدات ٥٠ – ٢٥٠ ألف';

  @override
  String get dashboardKeywordsTierUnder50k => 'وسيط مشاهدات أقل من ٥٠ ألف';

  @override
  String get navScratchpad => 'لوحة الملاحظات';

  @override
  String get scratchpadYouTab => 'أنت';

  @override
  String get scratchpadNoTeammates =>
      'لا يوجد زملاء بعد — بمجرد تسجيل الدخول، يحصل كل شخص على تبويب هنا.';

  @override
  String get scratchpadOthersReadOnly =>
      'للقراءة فقط. يمكنك تعديل مربّعك أنت فقط.';

  @override
  String get scratchpadHint =>
      'مشترك مع الفريق. يُحفظ بعد توقفك عن الكتابة بلحظات.';

  @override
  String get scratchpadLastSaved => 'آخر حفظ';

  @override
  String get scratchpadLastSyncedHere => 'آخر مزامنة على هذا الجهاز';

  @override
  String get scratchpadNever => 'أبداً';

  @override
  String get scratchpadSyncLog => 'سجل المزامنة (هذا الجهاز)';

  @override
  String get scratchpadLoadFailed => 'تعذّر تحميل لوحة الملاحظات.';

  @override
  String get scratchpadRetry => 'أعد المحاولة';

  @override
  String get scratchpadEmptyBox => 'لا شيء هنا بعد.';

  @override
  String get settingsMergeTitle => 'قواعد بيانات تحتاج دمجاً يدوياً';

  @override
  String get settingsMergeSubtitle =>
      'عند صدور إصدار جديد بقاعدة بيانات معاد بناؤها، تُنحّى نسخة هذا الجهاز الأقدم بدل حذفها. النسخة الحالية قيد الاستخدام، والقديمة تنتظر في المجلد أدناه لتدمج منها ما تحتاجه.';

  @override
  String get settingsMergeThisDevice => 'هذا الجهاز';

  @override
  String get settingsMergeAcrossTeam => 'على مستوى الفريق';

  @override
  String get settingsMergeNoneThisDevice =>
      'لا شيء على هذا الجهاز يحتاج دمجاً.';

  @override
  String settingsMergePendingCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ملفات تحتاج دمجاً',
      one: 'ملف واحد يحتاج دمجاً',
    );
    return '$_temp0';
  }

  @override
  String settingsMergeSetAside(String when) {
    return 'نُحّي في $when';
  }

  @override
  String settingsMergeFromRelease(String note) {
    return 'من: $note';
  }

  @override
  String get settingsMergeOpenFolder => 'فتح المجلد';

  @override
  String get settingsMergeMarkResolved => 'وضع علامة مُنجز';

  @override
  String get settingsMergeRefresh => 'تحديث';

  @override
  String get settingsMergeResolveTitle => 'وضع علامة مُنجز على هذا الدمج؟';

  @override
  String settingsMergeResolveBody(String name) {
    return 'دمجت ما تحتاجه من النسخة المُنحّاة لـ $name. احذف تلك النسخة الآن أو احتفظ بها في المجلد احتياطاً.';
  }

  @override
  String get settingsMergeResolveKeepFile => 'الاحتفاظ بالملف';

  @override
  String get settingsMergeResolveDeleteFile => 'حذف الملف';

  @override
  String get settingsMergeCancel => 'إلغاء';

  @override
  String get settingsMergeTeamNobody =>
      'لا أحد في الفريق لديه قاعدة بيانات تنتظر الدمج.';

  @override
  String settingsMergeTeamUpdated(String when) {
    return 'حُدّث في $when';
  }

  @override
  String get settingsMergeYou => 'أنت';

  @override
  String get settingsMergeLoadFailed => 'تعذّرت قراءة حالة الدمج.';

  @override
  String get templatePerfSectionTitle => 'الأداء';

  @override
  String templatePerfUsage(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أُرسلت $count مرة',
      many: 'أُرسلت $count مرة',
      few: 'أُرسلت $count مرات',
      two: 'أُرسلت مرتين',
      one: 'أُرسلت مرة واحدة',
      zero: 'لم تُرسل بعد',
    );
    return '$_temp0';
  }

  @override
  String templatePerfReplyRate(String percent) {
    return '$percent% من الردود';
  }

  @override
  String get templatePerfNoRepliesYet => 'لا ردود بعد';

  @override
  String templatePerfAvgReplyDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'متوسط الرد: $days يوم',
      many: 'متوسط الرد: $days يومًا',
      few: 'متوسط الرد: $days أيام',
      two: 'متوسط الرد: يومان',
      one: 'متوسط الرد: يوم واحد',
    );
    return '$_temp0';
  }

  @override
  String templatePerfAvgReplyHours(int hours) {
    String _temp0 = intl.Intl.pluralLogic(
      hours,
      locale: localeName,
      other: 'متوسط الرد: $hours ساعة',
      many: 'متوسط الرد: $hours ساعة',
      few: 'متوسط الرد: $hours ساعات',
      two: 'متوسط الرد: ساعتان',
      one: 'متوسط الرد: ساعة واحدة',
    );
    return '$_temp0';
  }

  @override
  String templatePerfAvgReplyMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'متوسط الرد: $minutes دقيقة',
      many: 'متوسط الرد: $minutes دقيقة',
      few: 'متوسط الرد: $minutes دقائق',
      two: 'متوسط الرد: دقيقتان',
      one: 'متوسط الرد: دقيقة واحدة',
    );
    return '$_temp0';
  }

  @override
  String workingDaysSuggestionText(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'يقترح المسار: $count يوم عمل، استناداً إلى إنشاء الصفقة ← آخر تحديث',
      many:
          'يقترح المسار: $count يوم عمل، استناداً إلى إنشاء الصفقة ← آخر تحديث',
      few:
          'يقترح المسار: $count أيام عمل، استناداً إلى إنشاء الصفقة ← آخر تحديث',
      two: 'يقترح المسار: يوما عمل، استناداً إلى إنشاء الصفقة ← آخر تحديث',
      one: 'يقترح المسار: يوم عمل واحد، استناداً إلى إنشاء الصفقة ← آخر تحديث',
    );
    return '$_temp0';
  }

  @override
  String get workingDaysSuggestionUseThis => 'استخدم هذا';

  @override
  String get workingDaysSuggestionApplied => 'تم تحديث تقدير أيام العمل.';

  @override
  String get workingDaysSuggestionFieldHint => 'مثال: 6';

  @override
  String get contactDiscoveryScanAction => 'البحث عن جهات اتصال';

  @override
  String get contactDiscoverySuggestionsTitle => 'عُثر عليها في الوصف';

  @override
  String get contactDiscoveryNoneFound =>
      'لم يُعثر على جهات اتصال محتملة في الوصف.';

  @override
  String get contactDiscoveryBusinessInquiry => 'استفسار تجاري';

  @override
  String get contactDiscoveryAddSuggestion => 'إضافة جهة الاتصال هذه';

  @override
  String get onboardingWizardTitle => 'لنجهّز هذا الجهاز';

  @override
  String get onboardingWizardSubtitle =>
      'خمسة أمور تستحق مراجعة مرة واحدة. أصلح ما تستطيع الآن، أو تخطَّ أيًا منها وتعامل معه لاحقًا في الإعدادات.';

  @override
  String get onboardingStepStatusDone => 'مكتمل';

  @override
  String get onboardingStepStatusPending => 'يحتاج مراجعة';

  @override
  String get onboardingSignInStepTitle => 'تسجيل الدخول';

  @override
  String get onboardingSignInStepSubtitle =>
      'يصل هذا الجهاز إلى بيانات الفريق المشتركة عبر حسابك.';

  @override
  String onboardingSignInDoneDetail(String email) {
    return 'تم تسجيل الدخول باسم $email.';
  }

  @override
  String get onboardingSignInPendingDetail =>
      'لم يتم تسجيل الدخول على هذا الجهاز بعد.';

  @override
  String get onboardingPythonStepTitle => 'بايثون وخط المعالجة';

  @override
  String get onboardingPythonStepSubtitle =>
      'أين يبحث هذا الجهاز عن أداة الجمع، وأي مفسّر بايثون يشغّلها.';

  @override
  String get onboardingPythonDoneDetail =>
      'تم العثور على موقع خط المعالجة لهذا الجهاز.';

  @override
  String get onboardingPythonPendingDetail =>
      'البحث لا يعمل من هذا الإصدار، فلا يوجد ما يُراجع هنا.';

  @override
  String get onboardingMailboxStepTitle => 'بريد التواصل';

  @override
  String get onboardingMailboxStepSubtitle =>
      'اربط حساب Gmail الذي يرسل منه هذا الجهاز رسائل التواصل.';

  @override
  String get onboardingMailboxDoneDetail =>
      'تم ربط بريد إلكتروني وهو جاهز للإرسال.';

  @override
  String get onboardingMailboxPendingDetail =>
      'لم يتم ربط أي بريد إلكتروني بعد.';

  @override
  String get onboardingTimeZoneStepTitle => 'المنطقة الزمنية';

  @override
  String get onboardingTimeZoneStepSubtitle =>
      'يُعرض كل تاريخ ووقت في التطبيق بهذه المنطقة الزمنية.';

  @override
  String get onboardingTimeZoneDoneDetail =>
      'تطابق المنطقة الزمنية لهذا الجهاز.';

  @override
  String get onboardingTimeZonePendingDetail =>
      'لا تطابق المنطقة الزمنية لهذا الجهاز.';

  @override
  String get onboardingAwsStepTitle => 'إعداد AWS';

  @override
  String get onboardingAwsStepSubtitle =>
      'اربط مفتاح الوصول الخاص بـ AWS الذي يستخدمه خط المعالجة في هذا الجهاز لإجراء عمليات البحث.';

  @override
  String get onboardingAwsDoneDetail => 'بيانات اعتماد AWS محفوظة لهذا الحساب.';

  @override
  String get onboardingAwsPendingDetail => 'لم يتم حفظ بيانات اعتماد AWS بعد.';

  @override
  String get onboardingFinishButton => 'المتابعة إلى التطبيق';

  @override
  String get onboardingSkipToSettingsButton =>
      'تخطّي — التعامل مع هذا لاحقًا في الإعدادات';

  @override
  String get fullBismillah => 'بسم الله الرحمن الرحيم';

  @override
  String get shortBismillah => 'بسم الله';

  @override
  String get fullSalam => 'السلام عليكم ورحمة الله وبركاته';

  @override
  String get shortSalam => 'السلام عليكم';

  @override
  String get teamDashboardNavLabel => 'الفريق';

  @override
  String get teamDashboardTitle => 'أداء الفريق';

  @override
  String teamDashboardWeekRange(String start, String end) {
    return '$start – $end';
  }

  @override
  String get teamDashboardPreviousWeek => 'الأسبوع السابق';

  @override
  String get teamDashboardNextWeek => 'الأسبوع التالي';

  @override
  String get teamDashboardThisWeek => 'هذا الأسبوع';

  @override
  String get teamDashboardColumnMember => 'عضو الفريق';

  @override
  String get teamDashboardColumnMessagesSent => 'الرسائل المُرسلة';

  @override
  String get teamDashboardColumnRepliesReceived => 'الردود المُستلمة';

  @override
  String get teamDashboardColumnReplyRate => 'معدّل الرد';

  @override
  String get teamDashboardColumnMedianResponse => 'الوسيط لوقت أول رد';

  @override
  String get teamDashboardNoData => '—';

  @override
  String get teamDashboardEmptyState =>
      'لا يوجد نشاط تواصل مسجَّل لهذا الأسبوع.';

  @override
  String get teamDashboardAttributionNote =>
      'تُنسب الردود المُستلمة ووقت أول رد إلى من أرسل الرسالة التي جاء الرد عليها — إذ لا يسجّل outreach_messages المُرسل نفسه، فهذا استنتاج من سجل النشاط وليس بيانات مخزَّنة مباشرة.';

  @override
  String get teamDashboardDealsSummaryTitle => 'صفقات الفريق هذا الأسبوع';

  @override
  String get teamDashboardDealsClosedLabel => 'الصفقات المُغلقة';

  @override
  String get teamDashboardMarginClosedLabel => 'الهامش المُحقَّق';

  @override
  String get teamDashboardDealsCaveat =>
      'غير مقسَّمة حسب الشخص: لا يوجد سجل في قاعدة البيانات يوضّح من قام بنقل مرحلة الصفقة، فقط أنها تغيّرت.';

  @override
  String teamDashboardDurationDaysHours(int days, int hours) {
    return '$days يوم $hours س';
  }

  @override
  String teamDashboardDurationHoursMinutes(int hours, int minutes) {
    return '$hours س $minutes د';
  }

  @override
  String teamDashboardDurationMinutes(int minutes) {
    return '$minutes د';
  }

  @override
  String get teamDashboardLoadError => 'تعذّر تحميل لوحة أداء الفريق.';

  @override
  String get rateHistoryTitle => 'سجل الأسعار';

  @override
  String get rateHistoryEmpty => 'لا توجد صفقات مُغلقة بعد لهذه القناة.';

  @override
  String get rateHistoryMedianViewsLabel => 'الوسيط للمشاهدات عند الصفقة';

  @override
  String get rateHistoryViewsNotMeasured => 'غير مقاس';

  @override
  String get ownerPickerUnassigned => 'غير مُسنَد';

  @override
  String get deliverableSectionTitle => 'التسليمات';

  @override
  String get deliverableSectionSubtitle =>
      'عناصر المحتوى الخاصة بهذه الصفقة، مُتابَعة كل عنصر على حدة — بمعزل عن سطر الملخص أعلاه.';

  @override
  String get deliverableEmptyState => 'لا توجد تسليمات مُسجَّلة بعد.';

  @override
  String get deliverableAddButton => 'إضافة تسليم';

  @override
  String get deliverableAddDialogTitle => 'إضافة تسليم';

  @override
  String get deliverableTypeIntegration => 'إعلان مدمج';

  @override
  String get deliverableTypeDedicated => 'فيديو مخصص';

  @override
  String get deliverableTypeShort => 'فيديو قصير';

  @override
  String get deliverableTypeCommunityPost => 'منشور مجتمعي';

  @override
  String get deliverableTypeOther => 'أخرى';

  @override
  String get deliverableStatusPending => 'قيد الانتظار';

  @override
  String get deliverableStatusDrafted => 'مسودة';

  @override
  String get deliverableStatusApproved => 'معتمد';

  @override
  String get deliverableStatusPublished => 'منشور';

  @override
  String get deliverableAgreedDateLabel => 'تاريخ الاتفاق';

  @override
  String get deliverableDraftReceivedDateLabel => 'تاريخ استلام المسودة';

  @override
  String get deliverableApprovedDateLabel => 'تاريخ الاعتماد';

  @override
  String get deliverableDateNotSet => 'غير محدد';

  @override
  String get deliverablePublishedUrlLabel => 'رابط المنشور';

  @override
  String get deliverablePublishedUrlHint => 'https://…';

  @override
  String get deliverableNotesHint => 'ملاحظات لهذا التسليم';

  @override
  String get deliverableMoveUpTooltip => 'نقل لأعلى';

  @override
  String get deliverableMoveDownTooltip => 'نقل لأسفل';

  @override
  String get deliverableDeleteTooltip => 'حذف التسليم';

  @override
  String get deliverableDeleteConfirmTitle => 'حذف هذا التسليم؟';

  @override
  String get deliverableDeleteConfirmBody =>
      'سيؤدي هذا إلى إزالته من الصفقة. لا يمكن التراجع عن هذا الإجراء.';

  @override
  String get deliverableAddedToast => 'تمت إضافة التسليم';

  @override
  String get deliverableDeletedToast => 'تم حذف التسليم';

  @override
  String get deliverableLoadError => 'تعذّر تحميل التسليمات.';

  @override
  String get manualEngagementTitle => 'التفاعل المُدخل يدويًا';

  @override
  String get manualEngagementDisclaimer =>
      'أُدخل يدويًا — لا يُسحب تلقائيًا من أي واجهة برمجية.';

  @override
  String get manualEngagementRateLabel => 'معدّل التفاعل';

  @override
  String get manualEngagementRateNotSet => 'غير مُدخل';

  @override
  String get manualEngagementRateHint => 'مثال: 4.2';

  @override
  String get manualEngagementNoteLabel => 'ملاحظة';

  @override
  String get manualEngagementNoteNotSet => 'لا توجد ملاحظة';

  @override
  String get manualEngagementNeverEntered =>
      'لم يُدخل أي معدّل تفاعل يدويًا بعد.';

  @override
  String get manualEngagementUpdatedToday => 'تم التحديث اليوم';

  @override
  String manualEngagementUpdatedDaysAgo(int count) {
    return 'تم التحديث قبل $count يوم';
  }

  @override
  String get manualEngagementEditTitle => 'تعديل التفاعل المُدخل يدويًا';

  @override
  String get manualEngagementEditRateHelp =>
      'نسبة مئوية بحثت عنها بنفسك — من الملف الإعلامي، تحليلات القناة نفسها، أو أي مصدر آخر. اتركها فارغة لمسحها.';

  @override
  String get manualEngagementEditNoteHelp =>
      'من أين جاء هذا الرقم، أو أي سياق يستحق الحفظ.';

  @override
  String get manualEngagementEditAction => 'تعديل التفاعل المُدخل يدويًا';

  @override
  String get manualEngagementClearAction => 'مسح';

  @override
  String get manualEngagementSaved => 'تم حفظ التفاعل المُدخل يدويًا.';

  @override
  String get manualEngagementCleared => 'تم مسح التفاعل المُدخل يدويًا.';

  @override
  String get manualEngagementRateInvalid =>
      'أدخل نسبة مئوية بين 0 و100، أو اتركها فارغة.';

  @override
  String get jobSchedulerCardTitle => 'المهام المجدولة';

  @override
  String get jobSchedulerCardSubtitle =>
      'مهام خلفية يشغّلها هذا الجهاز حسب جدولها الخاص، ويُتحقّق منها كل دقيقة.';

  @override
  String get jobSchedulerRefresh => 'تحديث';

  @override
  String get jobSchedulerLoadError => 'تعذّر تحميل المهام المجدولة.';

  @override
  String get jobSchedulerEmptyState => 'لا توجد مهام مجدولة على هذا الجهاز.';

  @override
  String get jobSchedulerDisabledBadge => 'معطّلة';

  @override
  String get jobSchedulerLastRunNever => 'آخر تشغيل: لم يُشغَّل قط';

  @override
  String jobSchedulerLastRunLabel(String when) {
    return 'آخر تشغيل: $when';
  }

  @override
  String get jobSchedulerNextRunNone => 'التشغيل التالي: غير مجدول';

  @override
  String jobSchedulerNextRunLabel(String when) {
    return 'التشغيل التالي: $when';
  }

  @override
  String get jobSchedulerDeleteTooltip => 'حذف';

  @override
  String get jobSchedulerDeleteConfirmTitle => 'حذف هذه المهمة المجدولة؟';

  @override
  String jobSchedulerDeleteConfirmBody(String kind) {
    return 'ستتوقف \"$kind\" عن العمل على هذا الجهاز. لا يمكن التراجع عن هذا الإجراء.';
  }

  @override
  String get jobSchedulerDeleteConfirmCancel => 'إلغاء';

  @override
  String get jobSchedulerDeleteConfirmDelete => 'حذف';

  @override
  String get paymentSectionTitle => 'الدفعات';

  @override
  String get paymentMarginLabel => 'هامشك';

  @override
  String get paymentCurrencyLabel => 'العملة';

  @override
  String get paymentMethodLabel => 'وسيلة الدفع';

  @override
  String get paymentMethodHint => 'مثال: تحويل بنكي، PayPal، إنستاباي';

  @override
  String get paymentReferenceLabel => 'مرجع الدفع';

  @override
  String get paymentReferenceHint => 'رقم العملية أو مرجع التحويل…';

  @override
  String get paymentInvoiceSentLabel => 'أُرسلت الفاتورة';

  @override
  String get paymentInvoicePaidLabel => 'سُددت الفاتورة';

  @override
  String get paymentPayoutDueLabel => 'دفعة المؤثر مستحقة';

  @override
  String get paymentPayoutPaidLabel => 'سُددت دفعة المؤثر';

  @override
  String get paymentNotSet => 'غير محدد';

  @override
  String get paymentMarkSentNow => 'تعليم كمُرسلة الآن';

  @override
  String get paymentMarkPaidNow => 'تعليم كمُسدَّدة الآن';

  @override
  String get paymentMarkDueToday => 'تعيين الاستحقاق اليوم';

  @override
  String get paymentPickDateTooltip => 'اختر تاريخًا';

  @override
  String get paymentClearDateTooltip => 'مسح';

  @override
  String get paymentDetailsSaved => 'تم حفظ تفاصيل الدفع';

  @override
  String get paymentDateSaved => 'تم الحفظ';

  @override
  String get financeNavLabel => 'المالية';

  @override
  String get financeTitle => 'المالية';

  @override
  String get financeSummaryBrandRevenue => 'إجمالي إيرادات العلامات التجارية';

  @override
  String get financeSummaryMargin => 'إجمالي الهامش';

  @override
  String get financeSummaryOutstanding =>
      'المستحق (فواتير مُرسلة غير مُسدَّدة)';

  @override
  String get financeSummaryOwedToCreators => 'المستحق للمؤثرين';

  @override
  String get financeFilterAll => 'كل الصفقات';

  @override
  String get financeFilterInvoiceUnpaid => 'فاتورة مُرسلة، غير مُسدَّدة';

  @override
  String get financeFilterInvoiceOverdue => 'فاتورة متأخرة السداد';

  @override
  String get financeFilterPayoutDue => 'دفعة مستحقة للمؤثر';

  @override
  String get financeFilterPayoutOverdue => 'دفعة متأخرة للمؤثر';

  @override
  String get financeFilterSettled => 'مُسوَّاة بالكامل';

  @override
  String get financeColumnDeal => 'الصفقة';

  @override
  String get financeColumnBrandPrice => 'تدفعه العلامة التجارية';

  @override
  String get financeColumnMargin => 'الهامش';

  @override
  String get financeColumnInvoiceSent => 'إرسال الفاتورة';

  @override
  String get financeColumnInvoicePaid => 'سداد الفاتورة';

  @override
  String get financeColumnPayoutDue => 'استحقاق دفعة المؤثر';

  @override
  String get financeColumnPayoutPaid => 'سداد دفعة المؤثر';

  @override
  String get financeNotSet => '—';

  @override
  String get financeEmptyState => 'لا توجد صفقات مطابقة لهذا الفلتر.';

  @override
  String get financeLoadError => 'تعذّر تحميل سجل المالية.';

  @override
  String get myDaySectionTitle => 'يومي';

  @override
  String get myDaySectionEmpty => 'لا يوجد ما هو عاجل الآن — عمل رائع.';

  @override
  String get myDaySectionLoadError => 'تعذّر تحميل يومي.';

  @override
  String get myDayGroupOverdue => 'متأخر';

  @override
  String get myDayGroupDueSoon => 'مستحق قريبًا';

  @override
  String myDayPayoutDueTitle(String influencer) {
    return 'دفعة مستحقة — $influencer';
  }

  @override
  String myDayInvoiceUnpaidTitle(String influencer) {
    return 'فاتورة غير مدفوعة — $influencer';
  }

  @override
  String myDayDeliverableDueTitle(String type, String influencer) {
    return '$type مستحق — $influencer';
  }

  @override
  String myDayOutreachReplyTitle(String influencer) {
    return 'بانتظار الرد — $influencer';
  }

  @override
  String myDayOutreachWaitingSince(String date) {
    return 'في الانتظار منذ $date';
  }

  @override
  String myDayDeliverableDeadline(String date) {
    return 'الموعد النهائي للصفقة $date';
  }

  @override
  String myDayReportDueTitle(String influencer) {
    return 'تقرير الثلاثين يومًا — $influencer';
  }

  @override
  String myDayReportDueOn(String date) {
    return 'مستحق في $date';
  }

  @override
  String get reportTitle => 'تقرير الثلاثين يومًا';

  @override
  String reportDueOn(String date) {
    return 'التقرير مستحق في $date';
  }

  @override
  String get reportFetchViews => 'اقرأ المشاهدات الآن';

  @override
  String get reportFetching => 'جارٍ سؤال يوتيوب عن المشاهدات…';

  @override
  String get reportNeedsLink => 'أضف رابط الفيديو أولًا: تُقرأ المشاهدات منه.';

  @override
  String reportEarly(String date) {
    return 'موعده $date. المشاهدات المقروءة قبل ذلك ليست مشاهدات ثلاثين يومًا.';
  }

  @override
  String reportFetchFailed(String error) {
    return 'تعذّرت قراءة المشاهدات: $error';
  }

  @override
  String get reportClicksLabel => 'النقرات على رابط التتبع';

  @override
  String get reportClicksHelper => 'اقرأها من لوحة الرابط نفسه.';

  @override
  String get reportSaveClicks => 'احفظ النقرات';

  @override
  String get reportCopy => 'انسخ للبريد';

  @override
  String get reportCopied => 'نُسخ التقرير.';

  @override
  String get reportSavePage => 'احفظ صفحة للطباعة';

  @override
  String reportPageSaved(String path) {
    return 'حُفظت: $path';
  }

  @override
  String get reportPageFailed => 'تعذّر حفظ الصفحة.';

  @override
  String reportRemindPitch(String brand) {
    return 'النتائج جيدة: ذكّرني بأن أعرض على $brand مؤثرًا جديدًا';
  }

  @override
  String reportPitchReminder(String brand) {
    return 'اعرض على $brand مؤثرًا جديدًا';
  }

  @override
  String get reportReminderSet => 'ضُبط التذكير لغد.';

  @override
  String reportTextHeading(String creator, String brand) {
    return '$creator × $brand: النتائج بعد ثلاثين يومًا';
  }

  @override
  String reportTextVideo(String url) {
    return 'الفيديو: $url';
  }

  @override
  String reportTextLive(String date) {
    return 'نُشر في: $date';
  }

  @override
  String reportTextViews(String date, String views) {
    return 'المشاهدات في $date: $views';
  }

  @override
  String reportTextPrice(String price) {
    return 'السعر: $price';
  }

  @override
  String reportTextPriceShare(int count, String price) {
    return 'السعر (حصة متساوية من الصفقة على $count من المخرجات): $price';
  }

  @override
  String reportTextCpm(String cpm) {
    return 'تكلفة الألف مشاهدة المحققة: $cpm';
  }

  @override
  String reportTextClicks(String clicks) {
    return 'النقرات على رابط التتبع: $clicks';
  }

  @override
  String get myDayDeliverableTypeIntegration => 'دمج إعلاني';

  @override
  String get myDayDeliverableTypeDedicated => 'فيديو مخصص';

  @override
  String get myDayDeliverableTypeShort => 'فيديو قصير';

  @override
  String get myDayDeliverableTypeCommunityPost => 'منشور مجتمعي';

  @override
  String get myDayDeliverableTypeOther => 'عنصر تسليم';

  @override
  String get myDayReminderKindFollowUp => 'متابعة';

  @override
  String get myDayReminderKindDealDeadline => 'الموعد النهائي للصفقة';

  @override
  String get myDayReminderKindCustom => 'تذكير';

  @override
  String outreachSlaMinutesShort(int minutes) {
    return '$minutes د';
  }

  @override
  String outreachSlaHoursShort(int hours) {
    return '$hours س';
  }

  @override
  String outreachSlaDaysShort(int days) {
    return '$days ي';
  }

  @override
  String get outreachSlaTooltipWaiting => 'بانتظار ردّنا';

  @override
  String get outreachSlaTooltipOverdue =>
      'بانتظار ردّنا — تجاوزت مهلة الـ 24 ساعة';

  @override
  String get outreachClassificationInterested => 'مهتم';

  @override
  String get outreachClassificationAskingRate => 'يسأل عن السعر';

  @override
  String get outreachClassificationNotNow => 'ليس الآن';

  @override
  String get outreachClassificationDecline => 'رفض';

  @override
  String get outreachClassificationWrongContact => 'جهة اتصال خاطئة';

  @override
  String get outreachClassificationAutoReply => 'رد تلقائي';

  @override
  String get outreachClassificationClear => 'إزالة التصنيف';

  @override
  String get outreachClassificationFilterAll => 'كل المحادثات';

  @override
  String get outreachClassificationFilterEmpty =>
      'لا توجد محادثات بهذا التصنيف بعد.';

  @override
  String get outreachClassifyMessage => 'تصنيف هذا الرد';

  @override
  String get campaignSectionTitle => 'الحملات';

  @override
  String get campaignAddButton => 'إضافة حملة';

  @override
  String get campaignSectionEmpty =>
      'لا توجد حملات بعد — اجمع صفقات هذه العلامة التجارية تحت حملة للتخطيط لعرض أو تقرير حولها.';

  @override
  String get campaignAddedToast => 'تم إنشاء الحملة';

  @override
  String campaignStartDateValue(String date) {
    return 'تبدأ $date';
  }

  @override
  String campaignLiveDateValue(String date) {
    return 'البث $date';
  }

  @override
  String get campaignAddDialogTitle => 'إضافة حملة';

  @override
  String get campaignNameLabel => 'الاسم';

  @override
  String get campaignNameRequired => 'الاسم مطلوب.';

  @override
  String get campaignNotesLabel => 'ملاحظات';

  @override
  String get campaignStartDateLabel => 'تاريخ البدء';

  @override
  String get campaignLiveDateLabel => 'تاريخ البث';

  @override
  String get campaignDateNotSet => 'غير محدد';

  @override
  String get campaignStatusActive => 'نشطة';

  @override
  String get campaignStatusClosed => 'مغلقة';

  @override
  String get campaignDetailTitle => 'الحملة';

  @override
  String get campaignDeleteTooltip => 'حذف الحملة';

  @override
  String get campaignNotFound => 'الحملة غير موجودة.';

  @override
  String get campaignNotesHint => 'أي شيء يستحق تذكره عن هذه الحملة.';

  @override
  String get campaignNotesSaved => 'تم حفظ الملاحظات';

  @override
  String get campaignDeleteConfirmTitle => 'حذف هذه الحملة؟';

  @override
  String get campaignDeleteConfirmBody =>
      'سيؤدي هذا إلى إزالة الحملة وقائمتها المختصرة. الصفقات المرتبطة بها بالفعل لن تتأثر.';

  @override
  String get campaignDeletedToast => 'تم حذف الحملة';

  @override
  String get campaignShortlistTitle => 'القائمة المختصرة';

  @override
  String get campaignShortlistAddButton => 'إضافة قناة';

  @override
  String get campaignDraftPitch => 'صياغة عرض للعلامة';

  @override
  String get campaignPitchDrafting => 'جارٍ صياغة العرض…';

  @override
  String get campaignPitchNoContact =>
      'لا يوجد بريد إلكتروني لجهة اتصال العلامة بعد. أضف واحدًا في صفحة العلامة أولًا.';

  @override
  String get campaignPitchNobodyReady =>
      'لا أحد في هذه القائمة جاهز للعرض بعد: يحتاج كلٌّ منهم إلى ملف إعلامي وسعر متفق عليه (BRD-PRES-15).';

  @override
  String get campaignPitchLeftOutTitle => 'بعضهم غير جاهز للعرض';

  @override
  String campaignPitchLeftOut(String handles) {
    return 'هؤلاء غير جاهزين للعرض بعد وسيُستبعدون: $handles';
  }

  @override
  String get campaignPitchConfirm => 'صياغة العرض';

  @override
  String get campaignPitchDrafted =>
      'تمت صياغة العرض. إنه في انتظارك في التواصل ← قائمة المراسلات؛ لم يُرسل شيء.';

  @override
  String get campaignShortlistSubtitle =>
      'القنوات قيد النظر لهذه الحملة، قبل أن تتحول أي منها إلى صفقة.';

  @override
  String get campaignShortlistEmpty => 'لا توجد قنوات في القائمة المختصرة بعد.';

  @override
  String get campaignShortlistAddedToast =>
      'تمت إضافة القناة إلى القائمة المختصرة';

  @override
  String get campaignShortlistRemoveTooltip => 'إزالة من القائمة المختصرة';

  @override
  String campaignShortlistSnapshotBrandPrice(String value) {
    return 'دفعت العلامة التجارية $value';
  }

  @override
  String campaignShortlistSnapshotInfluencerPayout(String value) {
    return 'استلم المؤثر $value';
  }

  @override
  String campaignShortlistSnapshotMedianViews(String value) {
    return '$value وسيط المشاهدات';
  }

  @override
  String get campaignShortlistRemoveConfirmTitle => 'إزالة هذه القناة؟';

  @override
  String get campaignShortlistRemoveConfirmBody =>
      'هذا يزيلها من القائمة المختصرة فقط — لن يتغير أي شيء بشأن القناة نفسها.';

  @override
  String get campaignShortlistRemovedToast => 'تمت الإزالة من القائمة المختصرة';

  @override
  String get campaignShortlistAddDialogTitle =>
      'إضافة قناة إلى القائمة المختصرة';

  @override
  String get campaignShortlistChannelIdLabel => 'معرّف القناة';

  @override
  String get campaignShortlistChannelIdHint =>
      'معرّف القناة، مثل معرّف قناة يوتيوب';

  @override
  String get campaignShortlistChannelIdRequired => 'معرّف القناة مطلوب.';

  @override
  String get campaignShortlistWhyFitLabel => 'سبب الملاءمة (اختياري)';

  @override
  String get campaignShortlistWhyFitHint =>
      'ما الذي جعل هذه القناة تستحق الإدراج في القائمة المختصرة';

  @override
  String get geminiBridgeStateStopped => 'متوقف';

  @override
  String get geminiBridgeStateStarting => 'جارٍ البدء…';

  @override
  String geminiBridgeStateListening(String port) {
    return 'يستمع على المنفذ $port — بانتظار الإضافة';
  }

  @override
  String geminiBridgeStateConnected(String account) {
    return 'متصل باسم $account';
  }

  @override
  String get geminiBridgeStateConnectedNoAccount => 'متصل';

  @override
  String get geminiBridgeStateFailed => 'فشل';

  @override
  String geminiBridgeFailure(String code, String message) {
    return '$code: $message';
  }

  @override
  String get geminiBridgeFailureHint =>
      'أصلح هذا من الإعدادات ← Gemini في المتصفح.';

  @override
  String get geminiBridgeTitle => 'Gemini في المتصفح';

  @override
  String get geminiBridgeSubtitle =>
      'صِغ الرسائل وولّد الكلمات المفتاحية عبر تبويب Gemini في Edge — دون مفتاح API.';

  @override
  String get geminiBridgeNotAvailable =>
      'غير متاح على هذه المنصة — يحتاج الجسر إلى تطبيق سطح المكتب مع مسار Python.';

  @override
  String geminiBridgeModelLine(String model) {
    return 'النموذج: $model';
  }

  @override
  String get geminiBridgeStart => 'تشغيل';

  @override
  String get geminiBridgeStop => 'إيقاف';

  @override
  String get geminiBridgeTest => 'اختبار';

  @override
  String get geminiBridgeOpenGemini => 'فتح Gemini';

  @override
  String get geminiBridgeRunDiagnostics => 'تشغيل التشخيص';

  @override
  String get geminiBridgeCopyJson => 'نسخ JSON';

  @override
  String geminiBridgeTestListening(String port) {
    return 'الخدمة تستمع على المنفذ $port';
  }

  @override
  String get geminiBridgeTestNotListening => 'الخدمة لا تستمع';

  @override
  String get geminiBridgeTestExtensionConnected => 'الإضافة متصلة';

  @override
  String get geminiBridgeTestExtensionMissing =>
      'الإضافة غير متصلة — حمّلها في Edge وتحقق من المنفذ';

  @override
  String geminiBridgeTestAccount(String account) {
    return 'الحساب: $account';
  }

  @override
  String get geminiBridgeTestAccountUnknown => 'الحساب: غير معروف';

  @override
  String geminiBridgeTestModel(String model) {
    return 'النموذج: $model';
  }

  @override
  String get geminiBridgeTestModelUnknown => 'النموذج: غير معروف';

  @override
  String get geminiBridgeTestSignedOut => 'تبويب Gemini غير مسجّل الدخول.';

  @override
  String get geminiBridgeTestSignedIn => 'مسجّل الدخول';

  @override
  String get geminiBridgePortLabel => 'المنفذ';

  @override
  String get geminiBridgePortInvalid => 'أدخل منفذًا بين 1 و65535.';

  @override
  String get geminiBridgeAccountMatchLabel =>
      'يجب أن يطابق الحساب (الاسم أو البريد)';

  @override
  String get geminiBridgeAccountMatchHint => 'فارغ: أي حساب مسجّل الدخول يكفي';

  @override
  String get geminiBridgeGemHint => 'فارغ: محادثة عادية مع إلحاق ملف المهارة';

  @override
  String get geminiBridgeDefaultModelLabel => 'النموذج الافتراضي';

  @override
  String get geminiBridgeDefaultModelHint =>
      'مثل Pro — فارغ يترك المحوّل كما هو';

  @override
  String get geminiBridgeSettingsSaved => 'حُفظت إعدادات جسر Gemini.';

  @override
  String get geminiBridgeSettingsRestartHint =>
      'يسري المنفذ الجديد عند تشغيل الجسر في المرة القادمة.';

  @override
  String get geminiBridgeAccountTitle => 'حساب Google';

  @override
  String geminiBridgeSignedInAs(String account) {
    return 'مسجّل الدخول باسم $account';
  }

  @override
  String geminiBridgeLastSeen(String account) {
    return 'آخر حساب ظهر: $account';
  }

  @override
  String get geminiBridgeNoAccountSeen =>
      'لم يظهر أي حساب بعد. افتح Gemini وسجّل الدخول مرة واحدة، وسيُحفظ من بعدها.';

  @override
  String geminiBridgeUseAccount(String email) {
    return 'استخدم $email للإجراءات';
  }

  @override
  String geminiBridgeAccountPinned(String account) {
    return 'الإجراءات تستخدم $account.';
  }

  @override
  String get geminiBridgeBrowserTitle => 'المتصفح';

  @override
  String get geminiBridgeBrowserLabel => 'افتح Gemini في';

  @override
  String get geminiBridgeBrowserFirefox => 'Firefox (موصى به)';

  @override
  String get geminiBridgeBrowserEdge => 'Microsoft Edge';

  @override
  String get geminiBridgeBrowserChrome => 'Google Chrome';

  @override
  String get geminiBridgeBrowserSystem => 'المتصفح الافتراضي للنظام';

  @override
  String get geminiBridgeDetectBrowsers => 'اكتشاف المتصفحات';

  @override
  String geminiBridgeBrowserFound(String name, String version) {
    return '$name $version';
  }

  @override
  String get geminiBridgeBrowserNoneFound =>
      'لم يُعثر على أي متصفح مدعوم على هذا الجهاز.';

  @override
  String get geminiBridgeBrowserSelectedMissing =>
      'المتصفح المختار غير موجود على هذا الجهاز.';

  @override
  String get geminiBridgeAddonMissing =>
      'الإضافة: غير مثبتة بعد. تُضاف تلقائيًا عند فتح نافذة Gemini.';

  @override
  String get geminiBridgeAddonTemporary =>
      'الإضافة: مضافة لجلسة المتصفح الحالية، وتُضاف تلقائيًا مع كل تشغيل.';

  @override
  String get geminiBridgeAddonInstalled => 'الإضافة: مثبتة.';

  @override
  String get geminiBridgeAddonOutdated =>
      'الإضافة: قديمة، وتُحدَّث تلقائيًا في التشغيل القادم.';

  @override
  String get geminiBridgeAddonBlocked =>
      'الإضافة: حظرها Firefox لأنها غير موقّعة.';

  @override
  String get geminiBridgeAddonUnknown =>
      'الإضافة: تُعرف حالتها عند تشغيل المتصفح.';

  @override
  String get geminiBridgeBrowserPathLabel => 'برنامج المتصفح (اختياري)';

  @override
  String get geminiBridgeBrowserPathHint => 'فارغ: يُعثر عليه تلقائيًا';

  @override
  String geminiBridgeWindowLaunching(String browser) {
    return 'جارٍ تشغيل $browser…';
  }

  @override
  String get geminiBridgeWindowInstalling => 'جارٍ تثبيت إضافة Gemini…';

  @override
  String get geminiBridgeAutoStartLabel => 'شغّل الجسر عند فتح التطبيق';

  @override
  String get geminiBridgeAutoOpenLabel =>
      'افتح نافذة Gemini في الخلفية عندما لا يكون هناك اتصال';

  @override
  String get geminiBridgeKeywordsGemLabel => 'رابط Gem الكلمات المفتاحية';

  @override
  String get geminiBridgeExtensionFolderCopy =>
      'انسخ مجلد الإضافة (حمّله مرة واحدة: صفحة الإضافات، وضع المطوّر، تحميل غير مضغوط)';

  @override
  String get geminiBridgeDiagnosticsTitle => 'التشخيص';

  @override
  String get geminiBridgeDiagnosticsEmpty =>
      'شغّل التشخيص لترى كيف يُعثر على كل عنصر في صفحة Gemini — وما العمل حين لا يُعثر عليه.';

  @override
  String get geminiBridgeDiagnosticsRunning => 'جارٍ سؤال الإضافة…';

  @override
  String get geminiBridgeDiagnosticsJsonCopied => 'نُسخ JSON التشخيص.';

  @override
  String geminiBridgeDiagnosticsAllFound(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'عُثر على كل العناصر ($count).',
      one: 'عُثر على العنصر الوحيد.',
    );
    return '$_temp0';
  }

  @override
  String geminiBridgeDiagnosticsMissing(int missing, int total) {
    return '$missing من $total عناصر مفقودة.';
  }

  @override
  String get geminiBridgeDiagnosticsPageChanged =>
      'تغيّرت مكوّنات الصفحة منذ آخر مرة عملت فيها المحدِّدات.';

  @override
  String get geminiBridgeElementFound => 'موجود';

  @override
  String get geminiBridgeElementMissing => 'مفقود — لم تطابق أي استراتيجية';

  @override
  String geminiBridgeElementStrategy(String strategy) {
    return 'عُثر عليه بواسطة: $strategy';
  }

  @override
  String get geminiBridgeElementTried => 'ما جُرّب';

  @override
  String geminiBridgeTriedLine(String strategy, int matched, int visible) {
    return '$strategy — $matched مطابق، $visible مرئي';
  }

  @override
  String get geminiBridgeElementLastKnown => 'كيف كان يُعثر عليه';

  @override
  String get geminiBridgeElementLastKnownNone =>
      'لم يُعثر عليه من قبل على هذا الجهاز.';

  @override
  String get geminiBridgeElementSuggestions => 'الاقتراحات';

  @override
  String get geminiBridgeElementNoSuggestions =>
      'لا اقتراحات — لم تجد الإضافة شيئًا مشابهًا في الصفحة.';

  @override
  String get geminiBridgeApplyFix => 'تطبيق الإصلاح';

  @override
  String get geminiBridgeApplyingFix => 'جارٍ التطبيق…';

  @override
  String geminiBridgeFixApplied(String element) {
    return 'طُبّق الإصلاح على $element؛ أُعيد التشخيص.';
  }

  @override
  String get geminiKeywordsButton => 'توليد كلمات مفتاحية بـ Gemini';

  @override
  String get geminiKeywordsNotConnected =>
      'إضافة Gemini غير متصلة — راجع الإعدادات ← Gemini في المتصفح.';

  @override
  String get geminiKeywordsTitle => 'توليد كلمات مفتاحية';

  @override
  String get geminiKeywordsSubtitle =>
      'عبارات بحث يوتيوب طويلة الذيل من Gemini، مع استبعاد كل ما بُحث عنه من قبل.';

  @override
  String get geminiKeywordsTopicLabel => 'الموضوع';

  @override
  String get geminiKeywordsTopicHint =>
      'مثل: أدوات البرمجة بالذكاء الاصطناعي للمبتدئين';

  @override
  String get geminiKeywordsTopicRequired => 'الموضوع مطلوب.';

  @override
  String get geminiKeywordsCountLabel => 'العدد';

  @override
  String get geminiKeywordsLanguageLabel => 'اللغة';

  @override
  String get geminiKeywordsLanguageHint => 'فارغ: الإنجليزية';

  @override
  String get geminiKeywordsStylesLabel => 'أساليب الصياغة';

  @override
  String get geminiKeywordsStylesHint =>
      'مفصولة بفواصل، مثل: how to, best, review, vs';

  @override
  String get geminiKeywordsExclusionsLabel => 'استبعاد';

  @override
  String get geminiKeywordsExclusionsHint =>
      'مواضيع فرعية تُستبعد، مفصولة بفواصل أو أسطر';

  @override
  String get geminiKeywordsNotesLabel => 'ملاحظات لـ Gemini';

  @override
  String geminiKeywordsAvoiding(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'يُتجنّب $count كلمة موجودة في القائمة أو بُحث عنها.',
      one: 'يُتجنّب كلمة واحدة موجودة في القائمة أو بُحث عنها.',
      zero: 'لا شيء يُتجنّب بعد — القائمة وسجل البحث فارغان.',
    );
    return '$_temp0';
  }

  @override
  String get geminiKeywordsGenerate => 'توليد';

  @override
  String get geminiKeywordsGenerating =>
      'جارٍ سؤال Gemini… قد يستغرق هذا دقيقة.';

  @override
  String geminiKeywordsResultCount(int fresh, int known) {
    String _temp0 = intl.Intl.pluralLogic(
      fresh,
      locale: localeName,
      other: '$fresh عبارة جديدة',
      one: 'عبارة جديدة واحدة',
      zero: 'لا عبارات جديدة',
    );
    return '$_temp0 · $known معروفة من قبل أو أُسقطت كتكرار.';
  }

  @override
  String get geminiKeywordsAlreadyKnown =>
      'موجودة في القائمة أو بُحث عنها من قبل';

  @override
  String get geminiKeywordsSelectAll => 'تحديد الكل';

  @override
  String get geminiKeywordsSelectNone => 'إلغاء التحديد';

  @override
  String geminiKeywordsAdd(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'إضافة $count إلى القائمة',
      one: 'إضافة واحدة إلى القائمة',
      zero: 'إضافة إلى القائمة',
    );
    return '$_temp0';
  }

  @override
  String geminiKeywordsAdded(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'أُضيفت $count كلمة إلى القائمة.',
      one: 'أُضيفت كلمة واحدة إلى القائمة.',
    );
    return '$_temp0';
  }

  @override
  String get geminiKeywordsEmpty =>
      'لم يُرجع Gemini أي كلمات. جرّب موضوعًا أوسع أو استبعادات أقل.';

  @override
  String get geminiKeywordsChatsLabel => 'محادثات منفصلة';

  @override
  String get geminiKeywordsChatsHint =>
      'من 1 إلى 8 · محادثات أكثر تعني تنوعًا أكبر';

  @override
  String geminiKeywordsProgress(int done, int total, int keywords) {
    return 'انتهت المحادثة $done من $total · $keywords كلمة حتى الآن';
  }

  @override
  String geminiKeywordsPartial(int failed, int total) {
    return 'فشلت $failed من $total محادثات — تُعرض نتائج المحادثات الأخرى.';
  }

  @override
  String geminiKeywordsChatFailed(int number, String error) {
    return 'المحادثة $number: $error';
  }

  @override
  String get geminiKeywordsBack => 'رجوع';

  @override
  String get navSkills => 'المهارات';

  @override
  String get skillsTitle => 'المهارات';

  @override
  String get skillsUnavailable =>
      'تحتاج المهارات إلى مجلد مشروع للكتابة فيه — افتح هذا في تطبيق سطح المكتب مع إعداد خط الأنابيب.';

  @override
  String get skillsEmpty =>
      'لا توجد مهارات بعد. تتحول المهارة إلى مجموعة بطاقات تُجمع في ملف واحد يقرأه Gemini.';

  @override
  String get skillsNewSkill => 'مهارة جديدة';

  @override
  String get skillsNameHint =>
      'اسم المهارة — وهو أيضًا اسم الملف الذي تصدَّر إليه';

  @override
  String get skillsDeleteSkill => 'حذف المهارة';

  @override
  String skillsDeleteSkillConfirm(String name) {
    return 'حذف \"$name\" وكل بطاقة فيها؟ لن يؤدي هذا إلى إزالة الملف المصدَّر الموجود بالفعل على القرص.';
  }

  @override
  String get skillsExportAll => 'إعادة تصدير كل المهارات';

  @override
  String get skillsExportAllDone => 'ملف كل مهارة محدَّث.';

  @override
  String skillsExportAllPartial(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count مهارات',
      one: 'مهارة واحدة',
    );
    return 'تعذّر تصدير $_temp0.';
  }

  @override
  String get skillsNeverExported => 'لم يُصدَّر قط';

  @override
  String skillsLastExported(String date) {
    return 'صُدِّر $date';
  }

  @override
  String skillsWordCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count كلمة',
      one: 'كلمة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get skillsAddCard => 'إضافة بطاقة';

  @override
  String get skillsDeckEmpty =>
      'لا توجد بطاقات بعد. أضف واحدة لبدء كتابة هذه المهارة.';

  @override
  String get skillsCardUntitled => 'بطاقة بلا عنوان';

  @override
  String get skillsCardEmptyBody => 'فارغة';

  @override
  String get skillsCardHeadingHint => 'عنوان البطاقة';

  @override
  String get skillsCardBodyHint =>
      'اكتب نص التوجيه لهذه البطاقة. اكتب @ للإشارة إلى بطاقة أخرى — سيتم إدراجها بالكامل عند تصدير هذه المهارة.';

  @override
  String get skillsDeleteCard => 'حذف البطاقة';

  @override
  String skillsDeleteCardConfirm(String heading) {
    return 'حذف \"$heading\"؟ أي إشارة \"@\" إليها في مكان آخر ستتوقف عن التحلل.';
  }

  @override
  String get skillsEditTab => 'تحرير';

  @override
  String get skillsPreviewTab => 'معاينة';

  @override
  String get skillsNameRequired =>
      'سمِّ هذه البطاقة قبل إغلاقها — البطاقة بلا اسم لا تُصدَّر أبدًا.';

  @override
  String get skillsTeamOnlyToggle => 'للفريق فقط — لا تُصدَّر أبدًا إلى Gemini';

  @override
  String get skillsTeamOnlyBadge => 'للفريق فقط';

  @override
  String get skillsCollapseAll => 'طي الكل';

  @override
  String get skillsExpandAll => 'توسيع الكل';

  @override
  String get skillsTogglePreview => 'إظهار/إخفاء المعاينة';

  @override
  String get skillsImport => 'استيراد من ملف';

  @override
  String get skillsImportNothingToImport =>
      'كل ملف مهارة في \"data/gemini skills\" أصبح مجموعة بطاقات هنا بالفعل.';

  @override
  String skillsImportDone(String name) {
    return 'تم استيراد \"$name\" كمهارة جديدة.';
  }

  @override
  String get skillsImportFailed => 'تعذّرت قراءة هذا الملف.';

  @override
  String get skillsGemBlockTitle => 'Gem في Gemini';

  @override
  String get skillsGemBlockNote =>
      'يُعَدّ هنا ويبقى داخل هذا التطبيق. لا يُصدَّر أبدًا إلى ملف المهارة ولا يُحتسب ضمن كلماتها ولا يُرسل إلى Gemini في أي طلب.';

  @override
  String get skillsGemNameCardTitle => 'Gem · الاسم والوصف';

  @override
  String get skillsGemInstructionsCardTitle => 'Gem · التعليمات';

  @override
  String get skillsGemNameLabel => 'اسم Gem';

  @override
  String get skillsGemDescriptionLabel => 'الوصف';

  @override
  String get skillsGemInstructionsLabel => 'التعليمات';

  @override
  String get skillsGemInstructionsHint =>
      'ما يجب أن يفعله هذا Gem دائمًا. تُحفظ هنا بمعزل عن بطاقات المهارة.';

  @override
  String skillsGemInstructionsWords(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count كلمة',
      one: 'كلمة واحدة',
    );
    return '$_temp0';
  }

  @override
  String get skillsGemNotExportedBadge => 'لا تُصدَّر';

  @override
  String get skillsGemNotExportedTooltip =>
      'تبقى داخل التطبيق: لا تُصدَّر أبدًا إلى ملف المهارة ولا تُحتسب ضمن كلماتها ولا تُرسل في أي طلب.';

  @override
  String skillsGemRoleLabel(String role) {
    return 'يُستخدم لـ: $role';
  }

  @override
  String get skillsGemRoleTooltip =>
      'أي Gem تُعدّه هذه المهارة. رابط الـ Gem المُنشأ يُكتب في حقل ذلك الـ Gem ضمن الإعدادات.';

  @override
  String get skillsGemSyncUpToDate => 'مُحدَّث في Gemini';

  @override
  String get skillsGemSyncPending =>
      'تُرسَل التغييرات إلى الـ Gem في Gemini تلقائيًا';

  @override
  String get skillsGemSyncWillCreate => 'يُنشأ الـ Gem في Gemini تلقائيًا';

  @override
  String get skillsGemSyncDefaults =>
      'عدّل هذه الحقول ليُنشأ الـ Gem في Gemini تلقائيًا';

  @override
  String get skillsGemRoleKeywords => 'الكلمات المفتاحية';

  @override
  String get skillsGemAddAction => 'إعداد Gem لهذه المهارة';

  @override
  String get skillsGemAddDialogTitle => 'إعداد Gem';

  @override
  String get skillsGemAddDialogBody => 'أي Gem تضبطه هذه المهارة؟';

  @override
  String get myAppsTitle => 'تطبيقاتي';

  @override
  String get myAppsSubtitle =>
      'تطبيقاتك الأخرى: افتحها أو ثبّتها أو اعثر عليها في GitHub وGoogle Play.';

  @override
  String get myAppsRefresh => 'تحقق مجددًا مما هو مثبّت';

  @override
  String get myAppsEmpty =>
      'لا توجد تطبيقات بعد. يشرح الملف docs/MY_APPS.md طريقة الإضافة.';

  @override
  String get myAppsProblems => 'تعذّرت قراءة بعض العناصر في my_apps.json:';

  @override
  String get myAppsOpen => 'فتح';

  @override
  String get myAppsInstall => 'تثبيت';

  @override
  String get myAppsDownloadApk => 'تنزيل APK';

  @override
  String get myAppsGooglePlay => 'Google Play';

  @override
  String myAppsGithub(String repo) {
    return 'فتح $repo في GitHub';
  }

  @override
  String get myAppsPrivateHelp =>
      'مستودع خاص: يحتاج التثبيت إلى تسجيل دخول GitHub (الحسابات ← GitHub) يملك صلاحية رؤيته.';

  @override
  String get myAppsInstalled => 'مثبّت على هذا الجهاز';

  @override
  String get myAppsNotInstalled => 'غير مثبّت على هذا الجهاز';

  @override
  String get myAppsChecking => 'جارٍ التحقق من أحدث إصدار…';

  @override
  String get myAppsDownloadingStarted => 'جارٍ التنزيل…';

  @override
  String myAppsDownloading(int percent) {
    return 'جارٍ التنزيل… $percent٪';
  }

  @override
  String get myAppsWaitingForInstaller =>
      'برنامج التثبيت مفتوح. أكمله هناك، وسيظهر زر «فتح» هنا عند انتهائه.';

  @override
  String get myAppsInstallerStarted => 'بدأ برنامج التثبيت.';

  @override
  String myAppsOpenFailed(String name) {
    return 'تعذّر تشغيل $name.';
  }

  @override
  String get myAppsDownloadFailed => 'لم يكتمل التنزيل. حاول مرة أخرى.';

  @override
  String get myAppsInstallerFailed =>
      'تم تنزيل برنامج التثبيت لكن تعذّر تشغيله.';

  @override
  String myAppsNoInstaller(String name) {
    return 'لا يحتوي أحدث إصدار من $name على برنامج تثبيت لويندوز (ملف ينتهي بـ setup.exe). سيتم فتح صفحة الإصدار بدلًا من ذلك.';
  }

  @override
  String myAppsNoApk(String name) {
    return 'لا يحتوي أحدث إصدار من $name على ملف ‎.apk. سيتم فتح صفحة الإصدار بدلًا من ذلك.';
  }

  @override
  String myAppsNotVisible(String repo) {
    return 'لا يوجد إصدار منشور في $repo، أو أن حساب GitHub على هذا الجهاز لا يستطيع رؤيته. في حالة المستودع الخاص، سجّل الدخول من الحسابات ← GitHub بحساب لديه صلاحية.';
  }

  @override
  String get myAppsTokenRejected =>
      'رفض GitHub تسجيل الدخول المحفوظ. سجّل الدخول مجددًا من الحسابات ← GitHub.';

  @override
  String get myAppsUnreachable =>
      'تعذّر الوصول إلى GitHub. تحقق من الاتصال وحاول مرة أخرى.';

  @override
  String get outreachSendLater => 'إرسال لاحقًا';

  @override
  String get outreachSendLaterInAnHour => 'بعد ساعة';

  @override
  String get outreachSendLaterTomorrowMorning => 'غدًا، 09:00';

  @override
  String get outreachSendLaterMondayMorning => 'الإثنين، 09:00';

  @override
  String outreachSendLaterZone(String zone) {
    return 'الأوقات بتوقيت $zone.';
  }

  @override
  String get outreachSendLaterInPast => 'هذا الوقت قد مضى بالفعل.';

  @override
  String get outreachSendLaterSchedule => 'جدولة';

  @override
  String get outreachSendLaterHowItWorks =>
      'يرسله التطبيق في ذلك الوقت ما دام مفتوحًا. وإن كان مغلقًا حينها، فالقرار لك عند فتحه في المرة التالية.';

  @override
  String outreachSendLaterScheduled(String when) {
    return 'مجدول في $when.';
  }

  @override
  String outreachSendLaterSentTitle(String handle) {
    return 'تم إرسال البريد المجدول إلى $handle';
  }

  @override
  String outreachScheduledFor(String when) {
    return 'مجدول في $when';
  }

  @override
  String outreachScheduledLate(String when) {
    return 'كان موعده $when';
  }

  @override
  String outreachScheduledFailed(String error) {
    return 'لم يُرسل: $error';
  }

  @override
  String get outreachScheduledMaybeSent =>
      'توقفت محاولة سابقة قبل أن يرد Gmail، لذا ربما أُرسل بالفعل. تحقق من مجلد المرسل في Gmail أولًا.';

  @override
  String get outreachScheduledSendNow => 'أرسل الآن';

  @override
  String get outreachScheduledSendAnyway => 'أرسل على أي حال';

  @override
  String get outreachScheduledChangeTime => 'تغيير الوقت';

  @override
  String get outreachScheduledEdit => 'تعديل';

  @override
  String get outreachScheduledDontSend => 'لا ترسل';

  @override
  String get outreachScheduledCancelled => 'لن يُرسل البريد المجدول.';

  @override
  String outreachScheduledSentTo(String to) {
    return 'أُرسل إلى $to.';
  }

  @override
  String get outreachScheduledBusy => 'يجري إرساله الآن.';

  @override
  String get outreachScheduledClearDraftFirst =>
      'أرسل المسودة الحالية أو امسحها أولًا.';

  @override
  String outreachScheduledBanner(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count رسائل مجدولة تنتظر قرارك',
      one: 'بريد مجدول واحد ينتظر قرارك',
    );
    return '$_temp0';
  }

  @override
  String get outreachScheduledReview => 'مراجعة';

  @override
  String get outreachScheduledReviewTitle => 'رسائل مجدولة تنتظر';

  @override
  String get outreachScheduledReviewIntro =>
      'لم تُرسل هذه في موعدها: كان التطبيق مغلقًا أو فشل الإرسال. لا يُرسل شيء متأخر من دونك.';

  @override
  String get outreachScheduledReviewEmpty => 'لا شيء ينتظر.';

  @override
  String outreachScheduledChipTooltip(String when) {
    return 'بريد مجدول في $when';
  }

  @override
  String influencerSearchScopeTooltip(String scopes) {
    return 'البحث في: $scopes';
  }

  @override
  String get influencerSearchScopeNames => 'الأسماء والمعرّفات';

  @override
  String get influencerSearchScopeChannelDescriptions => 'أوصاف القنوات';

  @override
  String get influencerSearchScopeVideoDescriptions => 'أوصاف الفيديوهات';
}
