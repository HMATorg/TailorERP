import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';

// Counter tablets: larger controls and touch targets than the admin desk app.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00695C',
          colorWarning: '#F9A825',
          borderRadius: 8,
          fontFamily: "'Inter', 'Tajawal', sans-serif",
          fontSize: 15,
          controlHeightLG: 48,
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
