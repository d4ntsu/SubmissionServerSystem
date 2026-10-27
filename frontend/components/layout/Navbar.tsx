"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import {
  GraduationCap,
  LogOut,
  Layers,
  Activity,
  FileCode2,
  CheckCircle2,
} from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isTeacher } = useAuth();
  const { exams, addLog } = useSocket();

  const handleLogout = () => {
    addLog(
      "EVENT",
      user?.full_name || "Unknown user",
      "Logged out of the exam portal"
    );
    logout();
    router.replace("/login");
  };

  const activeExam = exams.find((e) => e.status === "started") ?? exams[0];

  const studentNavItems = [
    { label: "Exam Dashboard", href: "/dashboard", icon: Layers },
    { label: "My Results", href: "/student/submissions", icon: CheckCircle2 },
  ];

  const teacherNavItems = [
    { label: "Exams & Questions", href: "/teacher/exams", icon: Layers },
    { label: "Submissions Dashboard", href: "/teacher/server/submissions", icon: FileCode2 },
    { label: "Realtime Monitor", href: "/teacher/server/monitoring", icon: Activity },
    { label: "Active Exam Workspace", href: `/student/exams/${activeExam?.id ?? 1}`, icon: FileCode2 },
  ];

  const navItems = isTeacher ? teacherNavItems : studentNavItems;

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/";
    }
    if (href === "/student/submissions") {
      return (
        pathname.startsWith(href) || pathname.startsWith("/student/results")
      );
    }
    return pathname.startsWith(href);
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 text-slate-100 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
        {/* Brand / Title */}
        <div className="flex items-center gap-8">
          <Link
            href={isTeacher ? "/teacher/server/submissions" : "/dashboard"}
            className="flex items-center gap-2.5 font-bold text-base text-white hover:text-orange-400 transition-colors"
          >
            <div className="w-9 h-9 rounded-md bg-orange-500 flex items-center justify-center text-white shadow-sm font-black">
              <GraduationCap className="w-5 h-5" />
            </div>
            <span className="leading-tight tracking-tight font-extrabold">
              LAN EXAM SYSTEM
            </span>
          </Link>

          {/* Navigation Links with vibrant orange active indicators */}
          {user && (
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition-all ${
                      active
                        ? "bg-slate-800 text-orange-400 border border-slate-700 shadow-xs"
                        : "text-slate-300 hover:text-white hover:bg-slate-800/60"
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${active ? "text-orange-400" : "text-slate-400"}`} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right User Bar */}
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
              <div className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center text-orange-400 font-bold text-xs">
                {user.full_name?.charAt(0) || "U"}
              </div>

              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-bold text-slate-100 leading-tight">
                  {user.full_name}
                </span>
                <span className="text-[9px] text-slate-400 tracking-wider uppercase font-semibold font-mono">
                  {user.role === "teacher" ? "Instructor / Proctor" : `Student ID: ${user.username}`}
                </span>
              </div>

              <button
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-slate-800 rounded-md transition-colors ml-1"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded-md shadow-xs transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
