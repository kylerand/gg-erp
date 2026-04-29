import {
  appendErpRouteSegment,
  getRequiredErpRecordRoute,
  getRequiredErpRoute,
  type ErpRouteQueryValue,
} from '@gg-erp/domain';

export function erpRoute(key: string, query?: Record<string, ErpRouteQueryValue>): string {
  return getRequiredErpRoute(key, query);
}

export function erpRecordRoute(
  key: string,
  id: string | number,
  query?: Record<string, ErpRouteQueryValue>,
): string {
  return getRequiredErpRecordRoute(key, id, query);
}

export function erpNestedRoute(key: string, ...segments: Array<string | number>): string {
  let route = erpRoute(key);
  for (const segment of segments) {
    route = appendErpRouteSegment(route, segment);
  }
  return route;
}
