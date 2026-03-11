export const colorTokens = {
  primary: '#0054D1',
  success: '#0A7A34',
  warning: '#B56B00',
  danger: '#B32318',
  text: '#1A1D24',
  background: '#F7F8FA'
} as const;

export type ColorTokenName = keyof typeof colorTokens;
