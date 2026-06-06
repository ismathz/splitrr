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
    <main className="mx-auto min-h-screen w-full max-w-md p-4 space-y-6">
      <Outlet />
    </main>
  );
}
