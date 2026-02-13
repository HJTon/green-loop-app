import type { Client, Collector, Route, Farm } from '@/types';
import clientsData from '@/data/clients.json';
import collectorsData from '@/data/collectors.json';
import routeData from '@/data/route.json';
import farmsData from '@/data/farms.json';

// Type assertions for JSON imports
export const clients: Client[] = clientsData as Client[];
export const collectors: Collector[] = collectorsData as Collector[];
export const defaultRoute: Route = routeData as Route;
export const farms: Farm[] = farmsData as Farm[];

// Lookup functions
export function getClientById(id: string): Client | undefined {
  return clients.find(c => c.id === id);
}

export function getCollectorById(id: string): Collector | undefined {
  return collectors.find(c => c.id === id);
}

export function getCollectorByPin(pin: string): Collector | undefined {
  return collectors.find(c => c.pin === pin && c.active);
}

// Get route for today (in real app this would filter by date)
export function getTodayRoute(): Route {
  return defaultRoute;
}

// Farm lookup
export function getFarmById(id: string): Farm | undefined {
  return farms.find(f => f.id === id);
}
