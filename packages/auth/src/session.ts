export interface Session {
  sessionId: string;
  userId: string;
  roles: string[];
  issuedAt: string;
  expiresAt: string;
}

export function isSessionExpired(session: Session, now = new Date()): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}
