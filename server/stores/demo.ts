// The demo marketplace: everyday things people ask an AI assistant to buy.
// Honest stores deliver; some misbehave the way real merchants do, so each
// AgentTrust protection has something to stop.
import type { Behavior, Product } from "../db.js";

export type DemoStore = {
  slug: string;
  name: string;
  description: string;
  category: string;
  behavior: Behavior;
  /** In the demo agent's mandate? */
  approved: boolean;
  dailyCap: number;
  products: Omit<Product, "id">[];
};

export const DEMO_STORES: DemoStore[] = [
  {
    slug: "staywell",
    name: "StayWell Hotels",
    description: "City hotels with free cancellation.",
    category: "travel",
    behavior: "honest",
    approved: true,
    dailyCap: 300,
    products: [
      { name: "Hotel room in Paris, 1 night", description: "Double room near Gare de Lyon, breakfast included.", price: 120, category: "travel", deliverable: "A booking confirmation with a reference, hotel name and dates", kind: "service" },
      { name: "Hotel room in Algiers, 1 night", description: "Sea-view double room in the city centre.", price: 85, category: "travel", deliverable: "A booking confirmation with a reference, hotel name and dates", kind: "service" },
    ],
  },
  {
    slug: "staywel",
    name: "StayWel Hotels",
    description: "City hotels, 20% cheaper than StayWell.",
    category: "travel",
    behavior: "honest",
    approved: false,
    dailyCap: 0,
    products: [{ name: "Hotel room in Paris, 1 night", description: "Double room in central Paris.", price: 95, category: "travel", deliverable: "A booking confirmation", kind: "service" }],
  },
  {
    slug: "grandplaza",
    name: "Grand Plaza Paris",
    description: "Boutique hotel on the Left Bank.",
    category: "travel",
    behavior: "overcharge",
    approved: true,
    dailyCap: 300,
    products: [{ name: "Classic room, 1 night", description: "Classic double room, city view.", price: 120, category: "travel", deliverable: "A booking confirmation with a reference and dates", kind: "service" }],
  },
  {
    slug: "pageturner",
    name: "PageTurner Books",
    description: "E-books, delivered instantly.",
    category: "books",
    behavior: "honest",
    approved: true,
    dailyCap: 50,
    products: [
      { name: "Agentic Commerce, the field guide", description: "How AI agents buy things, 40 pages.", price: 4.99, category: "books", deliverable: "A download link for the e-book", kind: "digital" },
      { name: "Paris in 3 days", description: "Travel guide e-book with maps.", price: 7.99, category: "books", deliverable: "A download link for the e-book", kind: "digital" },
    ],
  },
  {
    slug: "pixelly",
    name: "Pixelly",
    description: "Online design tool. Pro plan billed monthly.",
    category: "software",
    behavior: "pricejump",
    approved: true,
    dailyCap: 60,
    products: [{ name: "Pixelly Pro, 1 month", description: "Pro plan: unlimited exports, brand kit.", price: 9.99, category: "software", deliverable: "A licence key or account activation for Pixelly Pro", kind: "digital" }],
  },
  {
    slug: "bloomexpress",
    name: "Bloom Express",
    description: "Fresh flowers delivered the same day.",
    category: "gifts",
    behavior: "honest",
    approved: true,
    dailyCap: 100,
    products: [{ name: "Spring bouquet", description: "15 seasonal flowers, delivered today.", price: 39, category: "gifts", deliverable: "A shipping confirmation with a carrier and tracking number", kind: "physical" }],
  },
  {
    slug: "quickbloom",
    name: "QuickBloom",
    description: "Flowers in 1 hour, guaranteed.",
    category: "gifts",
    behavior: "ghost",
    approved: true,
    dailyCap: 100,
    products: [{ name: "Express bouquet", description: "12 roses, delivered within the hour.", price: 35, category: "gifts", deliverable: "A shipping confirmation with a tracking number", kind: "physical" }],
  },
  {
    slug: "gigdesk",
    name: "GigDesk",
    description: "Freelance designers, delivered in hours.",
    category: "services",
    behavior: "junk",
    approved: true,
    dailyCap: 150,
    products: [{ name: "Logo design, 3 concepts", description: "Three original logo concepts as PNG and SVG files.", price: 60, category: "services", deliverable: "Three original logo files (download links to PNG/SVG)", kind: "service" }],
  },
  {
    slug: "ticketnest",
    name: "TicketNest",
    description: "Concert and event tickets.",
    category: "tickets",
    behavior: "honest",
    approved: true,
    dailyCap: 100,
    products: [{ name: "Jazz night, 1 ticket", description: "Saturday 21:00, general admission.", price: 45, category: "tickets", deliverable: "An e-ticket with a ticket code", kind: "digital" }],
  },
  {
    slug: "gifthub",
    name: "GiftHub",
    description: "Digital gift cards, instant delivery.",
    category: "gift-cards",
    behavior: "honest",
    approved: false,
    dailyCap: 0,
    products: [{ name: "$100 gift card", description: "A $100 gift card code.", price: 100, category: "gift-cards", deliverable: "A gift card code", kind: "digital" }],
  },
];

/** The demo owner's rules for the demo agent. */
export const DEMO_MANDATE = {
  perPurchaseCap: 200,
  dailyLimit: 500,
  categories: ["travel", "books", "software", "gifts", "services", "tickets"],
  minReputation: 0,
};
