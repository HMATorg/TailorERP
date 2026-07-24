import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { enablePush, pushPermission, pushSupported } from '../push';

const DISMISSED_KEY = 'tailonix-push-dismissed';

/**
 * Bottom sheet shown after the customer first views an order
 * (wireframes §3.6e). Dismissal is remembered; re-enable from Profile.
 */
export default function PushOptIn() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported()) return;
    if (pushPermission() !== 'default') return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    const timer = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  if (result) {
    return (
      <div className="sheet" role="status">
        <p style={{ margin: 0 }}>{result}</p>
      </div>
    );
  }
  if (!visible) return null;

  return (
    <div className="sheet" role="dialog" aria-live="polite">
      <p style={{ marginBlockStart: 0 }}>{t('push.prompt')}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          className="btn"
          onClick={async () => {
            const ok = await enablePush();
            setVisible(false);
            setResult(ok ? t('push.enabled') : t('push.denied'));
            setTimeout(() => setResult(null), 4000);
          }}
        >
          {t('push.allow')}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, '1');
            setVisible(false);
          }}
        >
          {t('push.later')}
        </button>
      </div>
    </div>
  );
}
