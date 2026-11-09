// The demo marketplace. Honest stores sell real data; some misbehave the way
// real merchants do, so each AgentTrust protection has something to stop.
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

const data = (name: string, description: string, price: number, deliverable: string): Omit<Product, "id"> => ({
  name,
  description,
  price,
  category: "data",
  deliverable,
  kind: "data",
});

export const DEMO_STORES: DemoStore[] = [
  {
    slug: "coindata",
    name: "CoinData Pro",
    description: "Crypto market data: prices in USD with 24h change.",
    category: "data",
    behavior: "honest",
    approved: true,
    dailyCap: 5,
    products: [
      data("Crypto prices", "Current USD price and 24h change for up to 5 coins.", 0.5, "JSON with a USD price for each requested coin"),
      data("Realtime price feed", "Sub-second price for one coin.", 1, "JSON with a live USD price"),
    ],
  },
  {
    slug: "coindatas",
    name: "CoinDatas Pro",
    description: "Same crypto prices as CoinData Pro, 50% cheaper.",
    category: "data",
    behavior: "honest",
    approved: false,
    dailyCap: 0,
    products: [data("Crypto prices", "Current USD price and 24h change, discounted.", 0.25, "JSON with USD prices")],
  },
  {
    slug: "marketwire",
    name: "Market Wire",
    description: "Latest tech and market news on any topic.",
    category: "news",
    behavior: "honest",
    approved: true,
    dailyCap: 5,
    products: [
      { ...data("News briefing", "Six latest stories on a topic, with links.", 1, "JSON list of news stories with titles and links"), category: "news" },
    ],
  },
  {
    slug: "weathernow",
    name: "Weather Now",
    description: "Current weather for any city.",
    category: "data",
    behavior: "honest",
    approved: true,
    dailyCap: 2,
    products: [data("City weather", "Temperature, wind and humidity now.", 0.3, "JSON with current temperature for the city")],
  },
  {
    slug: "pixelpress",
    name: "PixelPress Books",
    description: "Short e-books for builders.",
    category: "books",
    behavior: "honest",
    approved: true,
    dailyCap: 15,
    products: [
      {
        name: "Agentic Commerce, the field guide",
        description: "A 40-page e-book on AI agents that buy things.",
        price: 4.99,
        category: "books",
        deliverable: "A download link for the e-book",
        kind: "digital",
      },
    ],
  },
  {
    slug: "flightdeals",
    name: "FlightDeals API",
    description: "Cheapest flight between two cities.",
    category: "travel",
    behavior: "overcharge",
    approved: true,
    dailyCap: 10,
    products: [{ ...data("Cheapest flight lookup", "Best fare between two cities today.", 2, "JSON with a fare and an airline"), category: "travel" }],
  },
  {
    slug: "liveticker",
    name: "LiveTicker",
    description: "Live price stream, billed per tick.",
    category: "data",
    behavior: "stream",
    approved: true,
    dailyCap: 1.5,
    products: [data("Price tick", "One live price tick; call again for the next.", 0.45, "JSON with a live price")],
  },
  {
    slug: "quickquote",
    name: "QuickQuote",
    description: "Instant crypto quotes, sub-second.",
    category: "data",
    behavior: "ghost",
    approved: true,
    dailyCap: 2,
    products: [data("Instant quote", "One instant price quote.", 0.4, "JSON with a USD price")],
  },
  {
    slug: "dailydigest",
    name: "DailyDigest",
    description: "AI-written daily digest of crypto news.",
    category: "news",
    behavior: "junk",
    approved: true,
    dailyCap: 3,
    products: [{ ...data("Daily crypto digest", "Today's crypto news in five bullet points.", 0.8, "A text digest of today's crypto news"), category: "news" }],
  },
  {
    slug: "giftcardsnow",
    name: "GiftCardsNow",
    description: "Digital gift cards, instant delivery.",
    category: "gift-cards",
    behavior: "honest",
    approved: false,
    dailyCap: 0,
    products: [
      { name: "$100 gift card", description: "A $100 store gift card code.", price: 100, category: "gift-cards", deliverable: "A gift card code", kind: "digital" },
    ],
  },
];

/** The demo owner's rules for the demo agent. */
export const DEMO_MANDATE = {
  perPurchaseCap: 10,
  dailyLimit: 25,
  categories: ["data", "news", "books", "travel"],
  minReputation: 0,
};
