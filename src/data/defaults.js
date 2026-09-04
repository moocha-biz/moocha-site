export const STAMP_GOAL = 8;

export const DEFAULT_SETTINGS = {
  paymentEnabled: true,
  stallPhone: "+6596586775",
  stallName: "Moocha",
  collectionStart: null,
  collectionEnd: null,
  preorderCloseAt: null,
};

// Only used when Supabase isn't connected yet (demo mode).
export const DEMO_PASSPHRASE_KEY = "moocha_demo_passphrase";
export const DEMO_DEFAULT_PASSPHRASE = "QUEENraks!";

export const DEFAULT_MENU = {
  categories: {
    "Matcha Drinks": [
      {
        id: "m1", name: "Matcha Latte", desc: "Our everyday matcha, whisked with fresh milk.",
        price: 6.00, iced: true, soldout: false,
      },
      {
        id: "m2", name: "Strawberry Matcha", desc: "Layered strawberry puree with ceremonial matcha.",
        price: 7.00, iced: true, soldout: false,
      },
      {
        id: "m3", name: "Sea Salt Foam Matcha", desc: "Matcha topped with a whisked sea salt cream foam.",
        price: 7.00, iced: true, soldout: false, photo: "/assets/sea-salt-matcha.jpg",
      },
      {
        id: "m4", name: "Biscoff Matcha", desc: "Matcha and biscoff caramel, swirled together.",
        price: 7.50, iced: true, soldout: false, photo: "/assets/biscoff-matcha.jpg",
      },
    ],
    "Seasonal Bakes": [],
  },
};

export const DEFAULT_SUGAR_LEVELS = ["0%", "25%", "50%", "75%", "100%"];
