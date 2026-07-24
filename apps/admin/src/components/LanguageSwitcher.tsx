import { GlobalOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type Language } from '@tailonix/shared';
import { LANGUAGE_LABELS } from '../i18n';

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (i18n.language.split('-')[0] as Language) ?? 'en';

  return (
    <Select
      value={SUPPORTED_LANGUAGES.includes(current) ? current : 'en'}
      onChange={(lng) => void i18n.changeLanguage(lng)}
      variant="borderless"
      suffixIcon={<GlobalOutlined />}
      style={{ minWidth: 110 }}
      options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }))}
    />
  );
}
