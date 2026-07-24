import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { RTL_LANGUAGES, SUPPORTED_LANGUAGES, type Language } from '@tailonix/shared';

const en = {
  app: {
    name: 'Tailonix',
    tagline: 'Track your orders and book appointments',
    loading: 'Loading…',
    cancel: 'Cancel',
    close: 'Close',
    signOut: 'Sign out',
    offline: "You're offline — showing last saved data.",
  },
  login: {
    sendOtp: 'Send OTP',
    sending: 'Sending…',
    codeHint: "We'll text you a {{length}}-digit code.",
    enterCodeSentTo: 'Enter the code sent to',
    resendIn: 'Resend in 0:{{seconds}}',
    resend: 'Resend code',
  },
  nav: { orders: 'Orders', appointments: 'Appointments', profile: 'Profile' },
  orders: {
    title: 'My Orders',
    none: 'No orders yet.',
    due: 'Due {{date}}',
    details: 'Details',
    total: 'Total',
    balance: 'Balance',
    paidInFull: 'Paid in full',
    estimatedCompletion: 'Estimated completion: {{date}}',
    chatPrefill: 'Hi, I have a question about order {{number}}',
    chatAria: 'Chat with us on WhatsApp',
  },
  status: {
    pending: 'Pending',
    cutting: 'Cutting',
    sewing: 'Sewing',
    fitting: 'Fitting',
    ready: 'Ready',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    in_progress: 'In progress',
    completed: 'Completed',
    no_show: 'No show',
  },
  appointments: {
    title: 'Appointments',
    book: '+ Book',
    none: 'No appointments yet.',
    chooseStore: 'Choose store…',
    noSlots: 'No slots for this day.',
    confirm: 'Confirm Appointment',
    booked: 'Appointment booked ✓',
    measurement: 'Measurement',
    first_fitting: 'First Fitting',
    final_fitting: 'Final Fitting',
    pickup: 'Pickup',
  },
  profile: {
    title: 'My Profile',
    measurements: 'My Measurements',
    noMeasurements: 'No measurements on file yet.',
    records: '{{count}} record',
    records_plural: '{{count}} records',
  },
  push: {
    prompt: 'Stay updated! Allow notifications when your order status changes.',
    allow: 'Allow',
    later: 'Maybe Later',
    enabled: 'Notifications enabled ✓',
    denied: 'Notifications blocked in your browser settings.',
  },
};

const ar: typeof en = {
  app: {
    name: 'تيلونكس',
    tagline: 'تابع طلباتك واحجز مواعيدك',
    loading: 'جارٍ التحميل…',
    cancel: 'إلغاء',
    close: 'إغلاق',
    signOut: 'تسجيل الخروج',
    offline: 'أنت غير متصل — نعرض آخر البيانات المحفوظة.',
  },
  login: {
    sendOtp: 'إرسال الرمز',
    sending: 'جارٍ الإرسال…',
    codeHint: 'سنرسل لك رمزًا من {{length}} أرقام.',
    enterCodeSentTo: 'أدخل الرمز المرسل إلى',
    resendIn: 'إعادة الإرسال خلال 0:{{seconds}}',
    resend: 'إعادة إرسال الرمز',
  },
  nav: { orders: 'الطلبات', appointments: 'المواعيد', profile: 'حسابي' },
  orders: {
    title: 'طلباتي',
    none: 'لا توجد طلبات بعد.',
    due: 'التسليم {{date}}',
    details: 'التفاصيل',
    total: 'الإجمالي',
    balance: 'المتبقي',
    paidInFull: 'مدفوع بالكامل',
    estimatedCompletion: 'موعد التسليم المتوقع: {{date}}',
    chatPrefill: 'مرحبًا، لدي استفسار عن الطلب {{number}}',
    chatAria: 'تواصل معنا عبر واتساب',
  },
  status: {
    pending: 'قيد الانتظار',
    cutting: 'القص',
    sewing: 'الخياطة',
    fitting: 'القياس',
    ready: 'جاهز',
    delivered: 'تم التسليم',
    cancelled: 'ملغى',
    scheduled: 'محجوز',
    confirmed: 'مؤكد',
    in_progress: 'قيد التنفيذ',
    completed: 'مكتمل',
    no_show: 'لم يحضر',
  },
  appointments: {
    title: 'المواعيد',
    book: '+ حجز',
    none: 'لا توجد مواعيد بعد.',
    chooseStore: 'اختر الفرع…',
    noSlots: 'لا توجد أوقات متاحة في هذا اليوم.',
    confirm: 'تأكيد الموعد',
    booked: 'تم حجز الموعد ✓',
    measurement: 'أخذ المقاسات',
    first_fitting: 'القياس الأول',
    final_fitting: 'القياس النهائي',
    pickup: 'الاستلام',
  },
  profile: {
    title: 'حسابي',
    measurements: 'مقاساتي',
    noMeasurements: 'لا توجد مقاسات محفوظة بعد.',
    records: '{{count}} سجل',
    records_plural: '{{count}} سجلات',
  },
  push: {
    prompt: 'ابقَ على اطلاع! فعّل الإشعارات عند تغيّر حالة طلبك.',
    allow: 'تفعيل',
    later: 'لاحقًا',
    enabled: 'تم تفعيل الإشعارات ✓',
    denied: 'الإشعارات محظورة في إعدادات متصفحك.',
  },
};

const ur: typeof en = {
  app: {
    name: 'ٹیلونکس',
    tagline: 'اپنے آرڈرز دیکھیں اور اپائنٹمنٹ بک کریں',
    loading: 'لوڈ ہو رہا ہے…',
    cancel: 'منسوخ',
    close: 'بند کریں',
    signOut: 'سائن آؤٹ',
    offline: 'آپ آف لائن ہیں — آخری محفوظ ڈیٹا دکھایا جا رہا ہے۔',
  },
  login: {
    sendOtp: 'کوڈ بھیجیں',
    sending: 'بھیجا جا رہا ہے…',
    codeHint: 'ہم آپ کو {{length}} ہندسوں کا کوڈ بھیجیں گے۔',
    enterCodeSentTo: 'اس نمبر پر بھیجا گیا کوڈ درج کریں',
    resendIn: 'دوبارہ بھیجیں 0:{{seconds}}',
    resend: 'کوڈ دوبارہ بھیجیں',
  },
  nav: { orders: 'آرڈرز', appointments: 'اپائنٹمنٹس', profile: 'پروفائل' },
  orders: {
    title: 'میرے آرڈرز',
    none: 'ابھی کوئی آرڈر نہیں۔',
    due: 'مقررہ {{date}}',
    details: 'تفصیلات',
    total: 'کل',
    balance: 'باقی',
    paidInFull: 'مکمل ادائیگی',
    estimatedCompletion: 'متوقع تکمیل: {{date}}',
    chatPrefill: 'السلام علیکم، مجھے آرڈر {{number}} کے بارے میں سوال ہے',
    chatAria: 'واٹس ایپ پر ہم سے رابطہ کریں',
  },
  status: {
    pending: 'زیر التواء',
    cutting: 'کٹائی',
    sewing: 'سلائی',
    fitting: 'فٹنگ',
    ready: 'تیار',
    delivered: 'حوالے کر دیا',
    cancelled: 'منسوخ',
    scheduled: 'شیڈول شدہ',
    confirmed: 'تصدیق شدہ',
    in_progress: 'جاری',
    completed: 'مکمل',
    no_show: 'حاضر نہیں',
  },
  appointments: {
    title: 'اپائنٹمنٹس',
    book: '+ بک کریں',
    none: 'ابھی کوئی اپائنٹمنٹ نہیں۔',
    chooseStore: 'برانچ منتخب کریں…',
    noSlots: 'اس دن کوئی وقت دستیاب نہیں۔',
    confirm: 'اپائنٹمنٹ کی تصدیق کریں',
    booked: 'اپائنٹمنٹ بک ہو گئی ✓',
    measurement: 'پیمائش',
    first_fitting: 'پہلی فٹنگ',
    final_fitting: 'آخری فٹنگ',
    pickup: 'وصولی',
  },
  profile: {
    title: 'میری پروفائل',
    measurements: 'میری پیمائشیں',
    noMeasurements: 'ابھی کوئی پیمائش محفوظ نہیں۔',
    records: '{{count}} ریکارڈ',
    records_plural: '{{count}} ریکارڈز',
  },
  push: {
    prompt: 'باخبر رہیں! آرڈر کی حالت بدلنے پر اطلاعات کی اجازت دیں۔',
    allow: 'اجازت دیں',
    later: 'بعد میں',
    enabled: 'اطلاعات فعال ✓',
    denied: 'آپ کے براؤزر میں اطلاعات بلاک ہیں۔',
  },
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ar: { translation: ar },
      ur: { translation: ur },
    },
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tailonix-lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

export function isRtl(lang: string): boolean {
  return RTL_LANGUAGES.includes(lang.split('-')[0] as Language);
}

export function applyDirection(lang: string): void {
  document.documentElement.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
  document.documentElement.setAttribute('lang', lang);
}

applyDirection(i18n.language);
i18n.on('languageChanged', applyDirection);

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
  ur: 'اردو',
};

export default i18n;
