import type { ProductCategory } from "@/lib/engine/types";

export type OrderStatus = "processing" | "in_transit" | "delivered" | "cancelled";

export interface Buyer {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export interface OrderRecord {
  id: string;
  /** The shop's customer profile this order belongs to. */
  customerId: string;
  buyer: Buyer;
  item: { name: string; category: ProductCategory; price: number };
  status: OrderStatus;
  /** Dates are stored relative to "today" so the demo reproduces on any day. */
  placedDaysAgo: number;
  deliveredDaysAgo?: number;
  carrier?: string;
  tracking?: string;
  lastScan?: { en: string; sq: string; daysAgo: number };
}

export interface Order extends Omit<OrderRecord, "placedDaysAgo" | "deliveredDaysAgo"> {
  placedAt: Date;
  deliveredAt?: Date;
}

const ORDER_RECORDS: OrderRecord[] = [
  {
    id: "1048",
    customerId: "blerta",
    buyer: {
      name: "Blerta Hoxha",
      email: "blerta.hoxha@example.com",
      phone: "+383 44 212 048",
      address: "Rr. Luan Haradinaj 33, Prishtinë",
    },
    item: { name: "Samsung Galaxy Tab S9 FE", category: "tablet", price: 389 },
    status: "in_transit",
    placedDaysAgo: 6,
    carrier: "RapidKS Courier",
    tracking: "RKS-48-1048",
    lastScan: { en: "Ferizaj sorting hub", sq: "qendra e sortimit në Ferizaj", daysAgo: 3 },
  },
  {
    id: "1017",
    customerId: "leon",
    buyer: {
      name: "Leon Berisha",
      email: "leon.berisha@example.com",
      phone: "+383 45 118 017",
      address: "Rr. Adem Jashari 5, Pejë",
    },
    item: { name: "Sony WH-1000XM5 headphones", category: "headphones", price: 329 },
    status: "delivered",
    placedDaysAgo: 48,
    deliveredDaysAgo: 45,
    carrier: "RapidKS Courier",
  },
  {
    id: "1022",
    customerId: "gentrit",
    buyer: {
      name: "Gentrit Morina",
      email: "gentrit.morina@example.com",
      phone: "+383 49 377 022",
      address: "Rr. Skënderbeu 18, Prizren",
    },
    item: { name: "Lenovo IdeaPad Slim 5 laptop", category: "laptop", price: 749 },
    status: "delivered",
    placedDaysAgo: 41,
    deliveredDaysAgo: 38,
    carrier: "RapidKS Courier",
  },
  {
    id: "1031",
    customerId: "arben",
    buyer: {
      name: "Arben Gashi",
      email: "arben.gashi@example.com",
      phone: "+383 44 731 031",
      address: "Rr. Agim Ramadani 14, Prishtinë",
    },
    item: { name: "PlayStation 5 Slim", category: "console", price: 549 },
    status: "delivered",
    placedDaysAgo: 5,
    deliveredDaysAgo: 3,
    carrier: "RapidKS Courier",
  },
  {
    id: "1052",
    customerId: "vjosa",
    buyer: {
      name: "Vjosa Krasniqi",
      email: "vjosa.krasniqi@example.com",
      phone: "+383 44 905 052",
      address: "Rr. Dardania 9, Gjilan",
    },
    item: { name: "JBL Charge 5 speaker", category: "speaker", price: 169 },
    status: "processing",
    placedDaysAgo: 1,
  },
  {
    id: "1009",
    customerId: "vjosa",
    buyer: {
      name: "Vjosa Krasniqi",
      email: "vjosa.krasniqi@example.com",
      phone: "+383 44 905 052",
      address: "Rr. Dardania 9, Gjilan",
    },
    item: { name: "Apple AirPods Pro 2", category: "headphones", price: 279 },
    status: "delivered",
    placedDaysAgo: 14,
    deliveredDaysAgo: 12,
    carrier: "RapidKS Courier",
  },
  {
    id: "1039",
    customerId: "driton",
    buyer: {
      name: "Driton Kelmendi",
      email: "driton.kelmendi@example.com",
      phone: "+383 45 660 039",
      address: "Rr. Mbretëresha Teutë 3, Mitrovicë",
    },
    item: { name: 'LG 55" OLED TV', category: "tv", price: 1199 },
    status: "in_transit",
    placedDaysAgo: 12,
    carrier: "RapidKS Courier",
    tracking: "RKS-12-1039",
    lastScan: { en: "Prishtinë depot", sq: "depoja në Prishtinë", daysAgo: 9 },
  },
  {
    id: "1063",
    customerId: "dren",
    buyer: {
      name: "Dren Gashi",
      email: "dren.gashi@example.com",
      phone: "+383 44 118 063",
      address: "Rr. Rexhep Luci 7, Prishtinë",
    },
    item: { name: "Xiaomi Redmi Note 13 Pro", category: "phone", price: 299 },
    status: "in_transit",
    placedDaysAgo: 2,
    carrier: "RapidKS Courier",
    tracking: "RKS-02-1063",
    lastScan: { en: "Prishtinë depot", sq: "depoja në Prishtinë", daysAgo: 1 },
  },
  {
    id: "1057",
    customerId: "albina",
    buyer: {
      name: "Albina Rexhepi",
      email: "albina.rexhepi@example.com",
      phone: "+383 49 555 310",
      address: "Rr. Nëna Terezë 40, Ferizaj",
    },
    item: { name: "Apple iPad (10th gen)", category: "tablet", price: 429 },
    status: "delivered",
    placedDaysAgo: 22,
    deliveredDaysAgo: 20,
    carrier: "RapidKS Courier",
  },
];

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export function materialize(record: OrderRecord, now: Date): Order {
  const { placedDaysAgo, deliveredDaysAgo, ...rest } = record;
  return {
    ...rest,
    placedAt: daysAgo(now, placedDaysAgo),
    deliveredAt: deliveredDaysAgo === undefined ? undefined : daysAgo(now, deliveredDaysAgo),
  };
}

export function allOrders(now: Date): Order[] {
  return ORDER_RECORDS.map((r) => materialize(r, now));
}

export function findOrder(id: string, now: Date): Order | undefined {
  const record = ORDER_RECORDS.find((o) => o.id === id);
  return record && materialize(record, now);
}

export const ORDER_RECORDS_FOR_DISPLAY = ORDER_RECORDS;
