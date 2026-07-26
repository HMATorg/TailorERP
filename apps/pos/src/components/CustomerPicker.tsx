import { useEffect, useRef, useState } from 'react';
import { CloseCircleFilled, SearchOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Empty, Input, List, Spin, Tag, Typography } from 'antd';
import { api, errMsg } from '../api';

export interface DirectoryCustomer {
  id: string;
  fullName: string;
  phone: string;
  whatsappConsent: boolean;
  lifetimeOrderCount: number;
  tier: 'new' | 'bronze' | 'silver' | 'gold';
}

const TIER_COLOR: Record<DirectoryCustomer['tier'], string> = {
  new: 'default',
  bronze: 'orange',
  silver: 'default',
  gold: 'gold',
};

/**
 * Rush-hour customer picker (v4 §1 amendment, D-045).
 *
 * Replaces the old "type the exact phone number and press Find" box, which was
 * a dead end the moment a digit was mistyped or a walk-in couldn't recall their
 * registered number. This opens already showing something — the store's most
 * recently active customers — and narrows as the cashier types, by either name
 * or phone. Nothing here requires an exact match before it becomes useful.
 */
export default function CustomerPicker({
  onSelect,
  autoFocus = true,
}: {
  onSelect: (id: string) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryCustomer[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<any>(null);
  const requestId = useRef(0);

  // Debounced search: fires on every keystroke but only the newest request's
  // result is applied, so a slow early response can never clobber a later one.
  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get('/pos/customers', { params: query.trim() ? { search: query.trim() } : {} })
        .then(({ data }) => {
          if (requestId.current !== id) return;
          setResults(data);
          setHighlighted(0);
          setError(null);
        })
        .catch((e) => {
          if (requestId.current !== id) return;
          setError(errMsg(e));
        })
        .finally(() => {
          if (requestId.current === id) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const select = (c: DirectoryCustomer) => onSelect(c.id);

  return (
    <div>
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        size="large"
        allowClear
        prefix={<SearchOutlined style={{ color: '#00695C' }} />}
        placeholder="Search name or phone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ fontSize: 20 }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && results[highlighted]) {
            select(results[highlighted]);
          }
        }}
      />

      {error && (
        <Typography.Text type="danger" style={{ display: 'block', marginBlockStart: 8 }}>
          {error}
        </Typography.Text>
      )}

      <div style={{ marginBlockStart: 8 }}>
        {!query.trim() && !loading && results.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Recently active — type a name or phone to search everyone
          </Typography.Text>
        )}

        {loading && results.length === 0 ? (
          <Spin style={{ display: 'block', marginBlockStart: 24 }} />
        ) : results.length === 0 && !loading ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              query.trim() ? (
                <>
                  No customer matches "{query}"
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Create them in the admin app, then search again.
                    </Typography.Text>
                  </div>
                </>
              ) : (
                'No customers yet'
              )
            }
            style={{ marginBlockStart: 24 }}
          />
        ) : (
          <List
            size="large"
            dataSource={results}
            style={{ marginBlockStart: 4 }}
            renderItem={(c, i) => (
              <List.Item
                onClick={() => select(c)}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  cursor: 'pointer',
                  paddingInline: 12,
                  borderRadius: 8,
                  background: i === highlighted ? '#E0F2F1' : undefined,
                }}
              >
                <List.Item.Meta
                  avatar={<Avatar icon={<UserOutlined />} style={{ background: '#00695C' }} />}
                  title={
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {c.fullName}
                    </Typography.Text>
                  }
                  description={c.phone}
                />
                <Tag color={TIER_COLOR[c.tier]}>{c.tier.toUpperCase()}</Tag>
                {!c.whatsappConsent && (
                  <CloseCircleFilled title="No WhatsApp consent" style={{ color: '#BDBDBD' }} />
                )}
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );
}
