import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { api, errMsg } from './client';
import { useAuthStore } from '../stores/auth';

/**
 * api/client.ts's request/response interceptor pair — retry-once-on-401 via a
 * shared in-flight refresh, X-Store-Id forwarding, and logout on a failed
 * refresh. Exercised through the real axios instance with a scripted adapter
 * (mirrors apps/platform-admin's api.test.ts), not a mocked client, so the
 * actual interceptor chain registered at module load is under test.
 */

function okResponse(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: {}, config: config as never };
}

function unauthorized(config: AxiosRequestConfig): never {
  const response: AxiosResponse = {
    data: { message: 'Unauthorized' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config: config as never,
  };
  throw new AxiosError('Request failed with status code 401', 'ERR_BAD_REQUEST', config as never, {}, response);
}

type Handler = (config: AxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>;

function queueAdapter(handlers: Handler[]) {
  api.defaults.adapter = async (config: AxiosRequestConfig) => {
    const handler = handlers.shift();
    if (!handler) throw new Error('no adapter response queued for ' + config.url);
    return handler(config);
  };
}

beforeEach(() => {
  useAuthStore.setState({
    user: null,
    stores: [],
    accessToken: null,
    refreshToken: null,
    activeStoreId: null,
    isImpersonating: false,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api request interceptor', () => {
  it('attaches the access token and X-Store-Id when a real store is active', async () => {
    useAuthStore.setState({ accessToken: 'tok-123', activeStoreId: 'store-1' });
    queueAdapter([
      (config) => {
        expect(config.headers?.Authorization).toBe('Bearer tok-123');
        expect(config.headers?.['X-Store-Id']).toBe('store-1');
        return okResponse({}, config);
      },
    ]);
    await api.get('/whatever');
  });

  it('omits X-Store-Id for the HQ "all stores" view', async () => {
    useAuthStore.setState({ accessToken: 'tok-123', activeStoreId: 'all' });
    queueAdapter([
      (config) => {
        expect(config.headers?.['X-Store-Id']).toBeUndefined();
        return okResponse({}, config);
      },
    ]);
    await api.get('/whatever');
  });
});

describe('api response interceptor — 401 retry', () => {
  it('refreshes once and retries the original request with the new token', async () => {
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'refresh-1' });
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'fresh', refreshToken: 'refresh-2' },
    } as never);

    queueAdapter([
      (config) => unauthorized(config),
      (config) => {
        expect(config.headers?.Authorization).toBe('Bearer fresh');
        return okResponse({ retried: true }, config);
      },
    ]);

    const res = await api.get('/protected');

    expect(res.data).toEqual({ retried: true });
    expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/refresh', { refreshToken: 'refresh-1' });
    expect(useAuthStore.getState().accessToken).toBe('fresh');
  });

  it('logs out and rejects when the refresh call itself fails', async () => {
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'dead-refresh' });
    vi.spyOn(axios, 'post').mockImplementation((url: string) =>
      url.includes('/auth/refresh') ? Promise.reject(new Error('refresh rejected')) : Promise.resolve({ data: {} }),
    );
    queueAdapter([(config) => unauthorized(config)]);

    await expect(api.get('/protected')).rejects.toBeInstanceOf(AxiosError);

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('never retries a second time — a 401 on the retried request itself just rejects', async () => {
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'refresh-1' });
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'fresh', refreshToken: 'refresh-2' },
    } as never);
    queueAdapter([(config) => unauthorized(config), (config) => unauthorized(config)]);

    await expect(api.get('/still-protected')).rejects.toBeInstanceOf(AxiosError);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates two concurrent 401s into a single refresh call', async () => {
    useAuthStore.setState({ accessToken: 'stale', refreshToken: 'refresh-1' });
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'fresh', refreshToken: 'refresh-2' },
    } as never);
    queueAdapter([
      (config) => unauthorized(config),
      (config) => unauthorized(config),
      (config) => okResponse({ from: 'a' }, config),
      (config) => okResponse({ from: 'b' }, config),
    ]);

    const [a, b] = await Promise.all([api.get('/a'), api.get('/b')]);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect([a.data, b.data]).toEqual(expect.arrayContaining([{ from: 'a' }, { from: 'b' }]));
  });
});

describe('errMsg', () => {
  it('joins an array of validation messages from a NestJS error body', () => {
    const err = new AxiosError('Bad Request', 'ERR_BAD_REQUEST', {} as never, {}, {
      data: { message: ['name is required', 'email must be valid'] },
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {} as never,
    });
    expect(errMsg(err)).toBe('name is required; email must be valid');
  });

  it('stringifies a non-axios error', () => {
    expect(errMsg(new Error('boom'))).toBe('Error: boom');
  });
});
