"use client";

import React from "react";
import { useSocket } from "@/lib/socket-context";
import { Wifi, WifiOff } from "lucide-react";

export function ConnectionBadge() {
  const { isConnected } = useSocket();

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border bg-white/80 dark:bg-slate-900/80 shadow-xs border-slate-200 dark:border-slate-800">
      {isConnected ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <Wifi className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-slate-600 dark:text-slate-300 hidden sm:inline">
            LAN Active (TCP)
          </span>
        </>
      ) : (
        <>
          <span className="inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
          <WifiOff className="w-3.5 h-3.5 text-rose-600" />
          <span className="text-rose-600">Offline</span>
        </>
      )}
    </div>
  );
}

