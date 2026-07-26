import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MEASUREMENT_POINT_KEYS,
  type GarmentMeasurementHistory,
  type MeasurementPoint,
  type MeasurementSnapshot,
} from '@tailonix/shared';
import { api, errMsg } from '../api';

/**
 * The customer's own measurements — read-only.
 *
 * Every version is listed, not just the current one, because "why does the new
 * thobe fit differently from last year's" is answered by comparing them. There
 * is no edit affordance anywhere on this page and no write route behind it: what
 * a garment was cut against is a record, not a preference.
 */
export default function Measurements() {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language.split('-')[0] === 'ar';

  const [history, setHistory] = useState<GarmentMeasurementHistory[]>([]);
  const [points, setPoints] = useState<MeasurementPoint[]>([]);
  const [openGarment, setOpenGarment] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/customer/measurements'), api.get('/customer/measurements/points')])
      .then(([h, p]) => {
        setHistory(h.data);
        setPoints(p.data);
        // Open the first garment so the page is not a wall of collapsed rows.
        if (h.data.length) setOpenGarment(h.data[0].garmentType);
      })
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);

  const label = (p: MeasurementPoint) => (isArabic ? p.labelAr : p.label);
  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(i18n.language) : '—';

  /** Only the points this snapshot actually carries — no rows of dashes. */
  const filled = (m: MeasurementSnapshot) =>
    points.filter((p) => m[p.key] != null && m[p.key] !== '');

  return (
    <div className="page">
      <h2>{t('measurements.title')}</h2>
      <p className="muted" style={{ marginBlockStart: -6 }}>
        {t('measurements.readOnly')}
      </p>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">{t('measurements.loading')}</p>}
      {!loading && !error && history.length === 0 && (
        <p className="muted">{t('measurements.none')}</p>
      )}

      {history.map((garment) => {
        const open = openGarment === garment.garmentType;
        const active = garment.versions.find((v) => v.isActive) ?? null;
        const older = garment.versions.filter((v) => !v.isActive);
        const olderShown = showOlder[garment.garmentType] ?? false;

        return (
          <div className="card" key={garment.garmentType}>
            <div
              className="row"
              style={{ cursor: 'pointer' }}
              onClick={() => setOpenGarment(open ? null : garment.garmentType)}
            >
              <div>
                <strong>{garment.garmentType}</strong>
                <div className="muted" style={{ fontSize: 12 }}>
                  {t('measurements.lastTaken', { date: fmtDate(garment.latestTakenAt) })}
                </div>
              </div>
              <span className="muted">
                {t('measurements.versions', { count: garment.versions.length })} {open ? '▴' : '▾'}
              </span>
            </div>

            {open && (
              <div style={{ marginBlockStart: 10 }}>
                {active ? (
                  <SnapshotTable
                    snapshot={active}
                    points={filled(active)}
                    label={label}
                    badge={t('measurements.current')}
                    badgeTone="active"
                    fmtDate={fmtDate}
                    t={t}
                  />
                ) : (
                  <p className="muted">{t('measurements.noActive')}</p>
                )}

                {older.length > 0 && (
                  <>
                    <button
                      className="btn btn-ghost"
                      style={{ marginBlockStart: 10, inlineSize: '100%' }}
                      onClick={() =>
                        setShowOlder((s) => ({
                          ...s,
                          [garment.garmentType]: !olderShown,
                        }))
                      }
                    >
                      {olderShown
                        ? t('measurements.hideOlder')
                        : t('measurements.showOlder', { count: older.length })}
                    </button>
                    {olderShown &&
                      older.map((v) => (
                        <SnapshotTable
                          key={v.id}
                          snapshot={v}
                          points={filled(v)}
                          label={label}
                          badge={t('measurements.version', { n: v.version })}
                          badgeTone="old"
                          fmtDate={fmtDate}
                          t={t}
                        />
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SnapshotTable({
  snapshot,
  points,
  label,
  badge,
  badgeTone,
  fmtDate,
  t,
}: {
  snapshot: MeasurementSnapshot;
  points: MeasurementPoint[];
  label: (p: MeasurementPoint) => string;
  badge: string;
  badgeTone: 'active' | 'old';
  fmtDate: (d: string | null) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  return (
    <div
      style={{
        marginBlockStart: 10,
        borderBlockStart: '1px solid #eee',
        paddingBlockStart: 8,
        opacity: badgeTone === 'old' ? 0.75 : 1,
      }}
    >
      <div className="row">
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            background: badgeTone === 'active' ? 'var(--color-teal, #00695C)' : '#E0E0E0',
            color: badgeTone === 'active' ? '#fff' : '#555',
          }}
        >
          {badge}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {fmtDate(snapshot.createdAt)}
          {snapshot.store ? ` — ${snapshot.store.name}` : ''}
        </span>
      </div>

      {points.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          {t('measurements.noPoints')}
        </p>
      ) : (
        <table style={{ width: '100%', fontSize: 13, marginBlockStart: 6 }}>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <td style={{ color: 'var(--color-grey)' }}>{label(p)}</td>
                <td style={{ textAlign: 'end' }}>{snapshot[p.key]} cm</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {snapshot.notes && (
        <p className="muted" style={{ fontSize: 12, marginBlockStart: 6 }}>
          {snapshot.notes}
        </p>
      )}
    </div>
  );
}

/** Re-exported so Profile can link here without duplicating the key list. */
export const MEASUREMENT_KEYS = MEASUREMENT_POINT_KEYS;
