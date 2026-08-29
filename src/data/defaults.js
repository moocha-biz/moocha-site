export const STAMP_GOAL = 12;

export const DEFAULT_SETTINGS = {
  paymentEnabled: true,
  stallPhone: "+6596586775",
  stallName: "Moocha",
};

// Only used when Supabase isn't connected yet (demo mode).
export const DEMO_PASSPHRASE_KEY = "moocha_demo_passphrase";
export const DEMO_DEFAULT_PASSPHRASE = "QUEENraks!";

export const DEFAULT_MENU = {
  categories: {
    "Matcha Drinks": [
      {
        id: "m1", name: "Matcha Latte", desc: "Our everyday matcha, whisked with fresh milk.",
        price: 6.00, iced: true, soldout: false, icon: "matcha",
        milks: [{ id: "milk1", name: "Fresh milk", price: 0 }, { id: "milk2", name: "Oat milk", price: 0.80 }, { id: "milk3", name: "Soy milk", price: 0.60 }],
        toppings: [{ id: "top1", name: "Extra matcha shot", price: 1.50 }, { id: "top2", name: "Pearls", price: 0.80 }],
      },
      {
        id: "m2", name: "Strawberry Matcha", desc: "Layered strawberry puree with ceremonial matcha.",
        price: 7.00, iced: true, soldout: false, icon: "strawberry",
        milks: [{ id: "milk1", name: "Fresh milk", price: 0 }, { id: "milk2", name: "Oat milk", price: 0.80 }],
        toppings: [{ id: "top1", name: "Extra matcha shot", price: 1.50 }, { id: "top2", name: "Pearls", price: 0.80 }, { id: "top3", name: "Grass jelly", price: 0.80 }],
      },
      {
        id: "m3", name: "Sea Salt Foam Matcha", desc: "Matcha topped with a whisked sea salt cream foam.",
        price: 7.00, iced: true, soldout: false, photo: "/assets/sea-salt-matcha.jpg",
        milks: [{ id: "milk1", name: "Fresh milk", price: 0 }, { id: "milk3", name: "Soy milk", price: 0.60 }],
        toppings: [{ id: "top1", name: "Extra matcha shot", price: 1.50 }],
      },
      {
        id: "m4", name: "Biscoff Matcha", desc: "Matcha and biscoff caramel, swirled together.",
        price: 7.50, iced: true, soldout: false, photo: "/assets/biscoff-matcha.jpg",
        milks: [{ id: "milk1", name: "Fresh milk", price: 0 }, { id: "milk2", name: "Oat milk", price: 0.80 }],
        toppings: [],
      },
    ],
    "Seasonal Bakes": [],
  },
};

export const MODIFIERS = {
  ice: { label: "Ice level", options: ["No ice", "Less ice", "Normal ice", "More ice"] },
  size: { label: "Size", options: [{ name: "Regular", price: 0 }, { name: "Large", price: 1.00 }] },
};

export const DEFAULT_SUGAR_LEVELS = ["0%", "25%", "50%", "75%", "100%"];
