import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import App from './App';

// Design tokens from wireframes §1.2
const theme = {
  token: {
    colorPrimary: '#00695C',
    colorWarning: '#F9A825',
    borderRadius: 6,
    fontFamily: "'Inter', 'Tajawal', sans-serif",
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={theme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
