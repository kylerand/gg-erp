import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

export type UserRole = 'technician' | 'manager' | 'parts' | 'trainer' | 'accounting' | 'admin';

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  name?: string;
}

const isMockMode = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

function extractRole(groups: string[]): UserRole {
  if (groups.includes('admin')) return 'admin';
  if (groups.includes('accounting')) return 'accounting';
  if (groups.includes('manager')) return 'manager';
  if (groups.includes('trainer')) return 'trainer';
  if (groups.includes('parts')) return 'parts';
  return 'technician';
}

export async function getAuthUser(): Promise<AuthUser | null> {
  if (isMockMode) {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem('gg_erp_mock_role') as UserRole | null;
    if (!stored) return null;
    return { userId: 'mock-user', email: 'dev@golfingarage.com', role: stored, name: 'Dev User' };
  }
  try {
    const user = await getCurrentUser();
    console.log('[auth] getCurrentUser:', user.userId, user.signInDetails?.loginId);
    const session = await fetchAuthSession();
    console.log('[auth] session tokens present:', !!session.tokens);
    const groups = (session.tokens?.idToken?.payload?.['cognito:groups'] as string[]) ?? [];
    console.log('[auth] groups:', groups);
    return { userId: user.userId, email: user.signInDetails?.loginId ?? '', role: extractRole(groups) };
  } catch (err) {
    console.warn('[auth] getCurrentUser failed:', err);
    return null;
  }
}

export async function doSignIn(email: string, password: string) {
  if (isMockMode) throw new Error('Use mock role selector in mock mode');
  return signIn({ username: email, password });
}

export async function doSignOut() {
  if (isMockMode) {
    localStorage.removeItem('gg_erp_mock_role');
    return;
  }
  await signOut();
}

export function setMockRole(role: UserRole) {
  localStorage.setItem('gg_erp_mock_role', role);
}
