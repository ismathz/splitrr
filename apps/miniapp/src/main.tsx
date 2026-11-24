import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppRouter } from "./app/AppRouter";

// Force dark-only mode for the miniapp by enabling the CSS variables used by shadcn/Tailwind.
document.documentElement.classList.add("dark");

const tg = (
  window as Window & {
    Telegram?: {
      WebApp?: {
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        ready?: () => void;
      };
    };
  }
).Telegram?.WebApp;

try {
  tg?.setHeaderColor?.("#0a0a0a");
  tg?.setBackgroundColor?.("#0a0a0a");
  tg?.ready?.();
} catch {
  // Telegram WebApp chrome APIs are optional outside Telegram.
}

createRoot(document.getElementById("root")!).render(<AppRouter />);
