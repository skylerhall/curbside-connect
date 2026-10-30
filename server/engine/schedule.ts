// Service calendar: which routes are collected on a given date once holiday,
// weather and operational overrides are applied.
import type { DB } from '../db/database.ts';
import { listOverrides, listRoutes } from '../db/repo.ts';
import { addDays, holidayAffectsService, nextWeekday, weekday, weekStart, daysBetween } from '../lib/dates.ts';
import type { Route, ScheduleOverride } from '../../shared/types.ts';

export interface Pickup {
  route: Route;
  originalDate: string; // the route's regular collection date
  serviceDate: string; // when the truck actually comes
  override: ScheduleOverride | null;
}

export function isRecyclingWeek(route: Route, originalDate: string): boolean {
  const weeks = Math.round(daysBetween(weekStart(route.recyclingAnchor), weekStart(originalDate)) / 7);
  return ((weeks % 2) + 2) % 2 === 0;
}

/** All pickups that actually happen on `date`, including ones moved there by an override. */
export function pickupsOn(db: DB, tenantId: string, date: string): Pickup[] {
  const routes = listRoutes(db, tenantId);
  const overrides = listOverrides(db, tenantId, addDays(date, -14));
  const pickups: Pickup[] = [];
  for (const route of routes) {
    if (route.serviceDay === weekday(date)) {
      const moved = overrides.find((o) => o.routeId === route.id && o.originalDate === date);
      if (!moved) pickups.push({ route, originalDate: date, serviceDate: date, override: null });
    }
    for (const o of overrides) {
      if (o.routeId === route.id && o.newDate === date) pickups.push({ route, originalDate: o.originalDate, serviceDate: date, override: o });
    }
  }
  return pickups;
}

/** The next time the truck actually visits this route, on or after `from`. */
export function nextPickupForRoute(db: DB, route: Route, from: string): Pickup {
  const overrides = listOverrides(db, route.tenantId, addDays(from, -14)).filter((o) => o.routeId === route.id);
  let regular = nextWeekday(from, route.serviceDay);
  // Look ahead a few weeks in case consecutive pickups were cancelled.
  for (let i = 0; i < 6; i++) {
    const o = overrides.find((x) => x.originalDate === regular);
    if (!o) return { route, originalDate: regular, serviceDate: regular, override: null };
    if (o.newDate && o.newDate >= from) return { route, originalDate: regular, serviceDate: o.newDate, override: o };
    regular = addDays(regular, 7);
  }
  return { route, originalDate: regular, serviceDate: regular, override: null };
}

export interface SlidePlanItem {
  routeId: string;
  routeName: string;
  originalDate: string;
  newDate: string;
}

/**
 * Standard holiday slide: when a holiday lands on a weekday, that day's pickups
 * and every later pickup that week move one day later (Friday moves to Saturday).
 * Weekend holidays don't change anything.
 */
export function holidaySlidePlan(routes: Route[], holidayDate: string): SlidePlanItem[] {
  if (!holidayAffectsService(holidayDate)) return [];
  const monday = weekStart(holidayDate);
  const holidayWd = weekday(holidayDate);
  return routes
    .filter((r) => r.serviceDay >= holidayWd && r.serviceDay <= 5)
    .map((r) => {
      const originalDate = addDays(monday, r.serviceDay - 1);
      return { routeId: r.id, routeName: r.name, originalDate, newDate: addDays(originalDate, 1) };
    });
}
