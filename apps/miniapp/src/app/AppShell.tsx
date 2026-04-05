import React from "react";
import { Outlet, useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AppShell() {
  const navigate = useNavigate();

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl p-4 md:p-8 space-y-6">
      <Outlet />
    </main>
  );
}
