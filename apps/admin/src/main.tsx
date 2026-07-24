import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import arEG from 'antd/locale/ar_EG';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import App from './App';
import i18n, { isRtl } from './i18n';

// Design tokens from wireframes §1.2
const baseToken = {
  colorPrimary: '#00695C',
  colorWarning: '#F9A825',
  borderRadius: 6,
};

function Root() {
  // re-renders on language change so direction and locale stay in sync
  const { i18n: instance } = useTranslation();
  const rtl = isRtl(instance.language);

  return (
    <ConfigProvider
      direction={rtl ? 'rtl' : 'ltr'}
      locale={rtl ? arEG : enUS}
      theme={{
        token: {
          ...baseToken,
          // Tajawal renders Arabic/Urdu more legibly and needs a touch more size
          fontFamily: rtl ? "'Tajawal', 'Inter', sans-serif" : "'Inter', 'Tajawal', sans-serif",
          fontSize: rtl ? 15 : 14,
        },
      }}
    >
      <App />
    </ConfigProvider>
  );
}

void i18n;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
