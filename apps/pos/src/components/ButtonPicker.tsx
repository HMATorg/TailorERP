import { CheckCircleFilled } from '@ant-design/icons';
import { Empty, Typography } from 'antd';
import type { ButtonDesign } from '../api';

interface ButtonPickerProps {
  buttons: ButtonDesign[];
  value?: string;
  onChange: (id: string | undefined) => void;
}

/** Photographed button catalog gallery — pick a shop's own numbered button by its photo (D-071). */
export default function ButtonPicker({ buttons, value, onChange }: ButtonPickerProps) {
  if (buttons.length === 0) {
    return <Empty description="No buttons in the catalog yet — add some in Admin → Buttons" style={{ margin: '12px 0' }} />;
  }
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        maxHeight: 260,
        overflowY: 'auto',
        padding: 4,
        border: '1px solid #f0f0f0',
        borderRadius: 6,
      }}
    >
      {buttons.map((b) => {
        const selected = value === b.id;
        return (
          <div
            key={b.id}
            onClick={() => onChange(selected ? undefined : b.id)}
            style={{
              position: 'relative',
              width: 78,
              cursor: 'pointer',
              border: selected ? '2px solid #00695C' : '1px solid #E0E0E0',
              borderRadius: 6,
              padding: 4,
              background: selected ? '#E0F2F1' : '#fff',
              textAlign: 'center',
            }}
          >
            {selected && (
              <CheckCircleFilled style={{ position: 'absolute', top: -6, right: -6, color: '#00695C', fontSize: 16, background: '#fff', borderRadius: '50%' }} />
            )}
            <img
              src={b.imageUrl}
              alt={b.serialNumber}
              style={{ width: '100%', height: 54, objectFit: 'contain', background: '#FAFAFA', borderRadius: 4 }}
            />
            <Typography.Text style={{ fontSize: 11, display: 'block', marginTop: 2 }} ellipsis>
              #{b.serialNumber}
            </Typography.Text>
          </div>
        );
      })}
    </div>
  );
}
