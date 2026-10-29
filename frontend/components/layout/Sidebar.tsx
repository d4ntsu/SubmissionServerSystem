"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  LayoutDashboard,
  FileCode2,
  CheckCircle2,
  Megaphone,
} from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
}

export function Sidebar({ isOpen }: SidebarProps) {
  const pathname = usePathname();
  const { role, isTeacher } = useAuth();

  if (!isOpen) {
    return null;
  }

  const studentLinks = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
    },
    {
      name: "Tests & Activities",
      href: "/student/exams",
      icon: FileCode2,
    },
    {
      name: "Grading & Results",
      href: "/student/submissions",
      icon: CheckCircle2,
    },
  ];

  const teacherGeneralLinks = [
    {
      name: "Exams & Questions",
      href: "/teacher/exams",
      icon: FileCode2,
    },
    {
      name: "Announcements Hub",
      href: "/teacher/announcements",
      icon: Megaphone,
    },
  ];

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return pathname === "/dashboard" || pathname === "/";
    }
    if (path === "/student/submissions") {
      return (
        pathname.startsWith(path) || pathname.startsWith("/student/results")
      );
    }
    return pathname.startsWith(path);
  };

  return (
    <aside className="w-64 shrink-0 hidden md:block border-r border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 min-h-[calc(100vh-4rem)] p-4 transition-all duration-300">
      {/* Student LMS Navigation */}
      <div className="space-y-1">
        <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Academic Portal
        </div>
        {studentLinks.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                active
                  ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-300 font-semibold"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? "text-brand-600 dark:text-brand-400" : ""}`} />
              {item.name}
            </Link>
          );
        })}
      </div>

      {/* Teacher Content & Announcements */}
      {isTeacher && (
        <div className="mt-6 space-y-1">
          <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Teacher Management
          </div>
          {teacherGeneralLinks.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? "bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-300 font-semibold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                <Icon className={`w-4 h-4 ${active ? "text-brand-600 dark:text-brand-400" : ""}`} />
                {item.name}
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
