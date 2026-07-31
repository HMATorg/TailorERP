import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { api, errMsg, useAuth } from './api';

/**
 * api.ts's request/response interceptor pair (D-060 handoff, mirrors apps/admin) —
 * retry-once-on-401 via a shared in-flight refresh, and logout on a failed refresh.
 * Exercised through the real axios instance with a scripted adapter, not a mocked
 * client, so the actual interceptor chain registered at module load is under test.
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
  useAuth.setState({ user: null, accessToken: null, refreshToken: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api request interceptor', () => {
  it('attaches the current access token as a Bearer header', async () => {
    useAuth.setState({ accessToken: 'tok-123', refreshToken: null, user: null });
    queueAdapter([
      (config) => {
        expect(config.headers?.Authorization).toBe('Bearer tok-123');
        return okResponse({ ok: true }, config);
      },
    ]);

    const res = await api.get('/whatever');
    expect(res.data).toEqual({ ok: true });
  });

  it('sends no Authorization header when signed out', async () => {
    queueAdapter([
      (config) => {
        expect(config.headers?.Authorization).toBeUndefined();
        return okResponse({}, config);
      },
    ]);
    await api.get('/whatever');
  });
});

describe('api response interceptor — 401 retry', () => {
  it('refreshes once and retries the original request with the new token', async () => {
    useAuth.setState({ accessToken: 'stale', refreshToken: 'refresh-1', user: null });
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
    expect(postSpy).toHaveBeenCalledWith('/api/v1/auth/platform/refresh', { refreshToken: 'refresh-1' });
    expect(useAuth.getState().accessToken).toBe('fresh');
    expect(useAuth.getState().refreshToken).toBe('refresh-2');
  });

  it('logs out and rejects when the refresh call itself fails', async () => {
    useAuth.setState({
      accessToken: 'stale',
      refreshToken: 'dead-refresh',
      user: { id: 'u1', email: 'a@b.com', fullName: null, adminLevel: 'support' },
    });
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh rejected'));
    queueAdapter([(config) => unauthorized(config)]);

    await expect(api.get('/protected')).rejects.toBeInstanceOf(AxiosError);

    expect(useAuth.getState().accessToken).toBeNull();
    expect(useAuth.getState().user).toBeNull();
  });

  it('does not attempt a refresh at all when there is no refresh token to use', async () => {
    useAuth.setState({ accessToken: 'stale', refreshToken: null, user: null });
    const postSpy = vi.spyOn(axios, 'post');
    queueAdapter([(config) => unauthorized(config)]);

    await expect(api.get('/protected')).rejects.toBeInstanceOf(AxiosError);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('never retries a second time — a 401 on the retried request itself just rejects', async () => {
    useAuth.setState({ accessToken: 'stale', refreshToken: 'refresh-1', user: null });
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { accessToken: 'fresh', refreshToken: 'refresh-2' },
    } as never);
    queueAdapter([(config) => unauthorized(config), (config) => unauthorized(config)]);

    await expect(api.get('/still-protected')).rejects.toBeInstanceOf(AxiosError);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('deduplicates two concurrent 401s into a single refresh call', async () => {
    useAuth.setState({ accessToken: 'stale', refreshToken: 'refresh-1', user: null });
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
    expect([a.data, b.data]).toEqual(
      expect.arrayContaining([{ from: 'a' }, { from: 'b' }]),
    );
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

  it('returns a single string message as-is', () => {
    const err = new AxiosError('Conflict', 'ERR_BAD_REQUEST', {} as never, {}, {
      data: { message: 'Email already in use' },
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: {} as never,
    });
    expect(errMsg(err)).toBe('Email already in use');
  });

  it('falls back to the axios error message when the response has no message field', () => {
    const err = new AxiosError('Network Error', 'ERR_NETWORK');
    expect(errMsg(err)).toBe('Network Error');
  });

  it('stringifies a non-axios error', () => {
    expect(errMsg(new Error('boom'))).toBe('Error: boom');
  });
});
