import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [salt, hash] = encodedHash.split(':');
  if (!salt || !hash) {
    throw new Error('Invalid password hash format');
  }
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.byteLength !== stored.byteLength) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}
