"use client";

import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import Link from "next/link";
import { ShieldAlert, ArrowLeft } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireTeacher?: boolean;
}

export function ProtectedRoute({ children, requireTeacher = false }: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { isTeacher, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider font-mono">
            Verifying Authentication Session...
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Will redirect in useEffect
  }

  if (requireTeacher && !isTeacher) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-14 h-14 rounded-lg bg-orange-100 border border-orange-200 flex items-center justify-center text-orange-600 mb-4 shadow-sm">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div className="text-[10px] font-bold tracking-widest uppercase px-2.5 py-0.5 rounded bg-slate-200 text-slate-700 font-mono mb-2">
          Clearance Restriction
        </div>
        <h2 className="text-xl font-bold text-slate-800">
          Teacher / Proctor Access Required
        </h2>
        <p className="text-xs text-slate-500 max-w-md mt-1 mb-6 leading-relaxed">
          The requested administrative module is restricted to course instructors and proctors.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-md shadow-xs transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Return to Student Dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
