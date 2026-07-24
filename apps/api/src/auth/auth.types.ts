export type PrincipalType = 'staff' | 'customer' | 'platform';

export interface AccessTokenPayload {
  /** user id (staff/platform) or customer id */
  sub: string;
  typ: PrincipalType;
  orgId?: string;
  adminLevel?: 'super_admin' | 'billing' | 'support';
  /** set when a platform support agent is impersonating a tenant HQ admin (TRD §7.4) */
  impersonatorId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
