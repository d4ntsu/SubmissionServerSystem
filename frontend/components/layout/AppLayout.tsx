"use client";

import React from "react";
import { Navbar } from "./Navbar";
import { NotificationOverlay } from "../realtime/NotificationOverlay";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col font-sans">
      <Navbar />
      <NotificationOverlay />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
        {children}
      </main>
    </div>
  );
}
