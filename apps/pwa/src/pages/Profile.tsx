import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES } from '@tailonix/shared';
import { api, errMsg, useAuth } from '../api';
import { LANGUAGE_LABELS } from '../i18n';

interface Measurement {
  id: string;
  garmentType: string;
  data: Record<string, number | string>;
  createdAt: string;
  store: { name: string } | null;
}

export default function Profile() {
  const { customer, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get('/customer/measurements')
      .then(({ data }) => setMeasurements(data))
      .catch((e) => setError(errMsg(e)));
  }, []);

  const grouped = measurements.reduce<Record<string, Measurement[]>>((acc, m) => {
    (acc[m.garmentType] = acc[m.garmentType] ?? []).push(m);
    return acc;
  }, {});

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

      <h3 style={{ fontSize: 16 }}>{t('profile.measurements')}</h3>
      {error && <p className="error-text">{error}</p>}
      {measurements.length === 0 && <p className="muted">{t('profile.noMeasurements')}</p>}
      {Object.entries(grouped).map(([garment, items]) => (
        <div className="card" key={garment}>
          <div
            className="row"
            style={{ cursor: 'pointer' }}
            onClick={() => setExpanded(expanded === garment ? null : garment)}
          >
            <strong>{garment}</strong>
            <span className="muted">
              {t('profile.records', { count: items.length })} {expanded === garment ? '▴' : '▾'}
            </span>
          </div>
          {expanded === garment &&
            items.map((m) => (
              <div key={m.id} style={{ marginBlockStart: 10, borderBlockStart: '1px solid #eee', paddingBlockStart: 8 }}>
                <p className="muted" style={{ margin: 0 }}>
                  {new Date(m.createdAt).toLocaleDateString(i18n.language)}{' '}
                  {m.store ? `— ${m.store.name}` : ''}
                </p>
                <table style={{ width: '100%', fontSize: 13, marginBlockStart: 6 }}>
                  <tbody>
                    {Object.entries(m.data).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: 'var(--color-grey)', textTransform: 'capitalize' }}>{k}</td>
                        <td style={{ textAlign: 'end' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      ))}

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
