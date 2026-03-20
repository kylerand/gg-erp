export const colorTokens = {
  primary: '#E37125',
  primaryDark: '#C95F18',
  secondary: '#353535',
  accent: '#F9F8D1',
  surface: '#FFF8EF',
  success: '#166534',
  warning: '#B56B00',
  danger: '#B32318',
  text: '#211F1E',
  mutedText: '#5F5752',
  background: '#F7F0E6'
} as const;

export type ColorTokenName = keyof typeof colorTokens;
