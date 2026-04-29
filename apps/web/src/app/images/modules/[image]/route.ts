import { NextResponse } from 'next/server';

function toTitle(imageName: string): string {
  return imageName
    .replace(/\.[^.]+$/u, '')
    .replace(/^\d+-/u, '')
    .replace(/-/gu, ' ')
    .replace(/\b\w/gu, (char) => char.toUpperCase());
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

export async function GET(
  _request: Request,
  { params }: { params: { image: string } },
) {
  const title = escapeXml(toTitle(params.image));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675" role="img" aria-label="${title}">
  <rect width="1200" height="675" fill="#211F1E"/>
  <rect x="48" y="48" width="1104" height="579" rx="28" fill="#FFF8EF"/>
  <path d="M140 502h920" stroke="#D9CCBE" stroke-width="8" stroke-linecap="round"/>
  <path d="M250 398h700" stroke="#E37125" stroke-width="18" stroke-linecap="round"/>
  <path d="M330 320h540" stroke="#F0B429" stroke-width="14" stroke-linecap="round"/>
  <circle cx="356" cy="500" r="56" fill="#211F1E"/>
  <circle cx="844" cy="500" r="56" fill="#211F1E"/>
  <circle cx="356" cy="500" r="24" fill="#FFF8EF"/>
  <circle cx="844" cy="500" r="24" fill="#FFF8EF"/>
  <text x="600" y="188" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800" fill="#211F1E">${title}</text>
  <text x="600" y="242" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="600" fill="#6E625A">Golfin Garage Training</text>
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
