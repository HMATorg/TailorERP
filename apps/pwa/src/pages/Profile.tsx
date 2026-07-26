import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES } from '@tailonix/shared';
import { useAuth } from '../api';
import { LANGUAGE_LABELS } from '../i18n';

export default function Profile() {
  const { customer, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="page">
      <h2>{t('profile.title')}</h2>
      <div className="card">
        <div className="row">
          <strong>{customer?.fullName}</strong>
          <select
            aria-label={t('profile.title')}
            value={i18n.language.split('-')[0]}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            style={{ border: 'none', background: 'transparent', color: 'var(--color-grey)' }}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn btn-ghost"
        style={{ inlineSize: '100%', marginBlockStart: 8 }}
        onClick={() => navigate('/measurements')}
      >
        📏 {t('profile.measurements')}
      </button>

      <button
        className="btn btn-ghost"
        style={{ marginBlockStart: 16 }}
        onClick={() => {
          logout();
          navigate('/login');
        }}
      >
        {t('app.signOut')}
      </button>
    </div>
  );
}
