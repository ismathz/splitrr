import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppRouter } from "./app/AppRouter";

// Force dark-only mode for the miniapp by enabling the CSS variables used by shadcn/Tailwind.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<AppRouter />);
