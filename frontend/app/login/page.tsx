"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useSocket } from "@/lib/socket-context";
import { isValidDemoCredentials } from "@/lib/api";
import { UserRole } from "@/types";
import {
  GraduationCap,
  Shield,
  Lock,
  User as UserIcon,
  ArrowRight,
  Sparkles,
  AlertCircle,
} from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { user, login, isLoading: isSessionLoading } = useAuth();
  const { addLog } = useSocket();
  const [selectedRole, setSelectedRole] = useState<UserRole>("student");
  const [username, setUsername] = useState("student_john");
  const [password, setPassword] = useState("password123");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSessionLoading || !user) return;

    let target = user.role === "teacher" ? "/teacher/server/submissions" : "/dashboard";
    const next = new URLSearchParams(window.location.search).get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      target = next;
    }
    router.replace(target);
  }, [isSessionLoading, user, router]);

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role);
    setError(null);
    if (role === "student") {
      setUsername("student_john");
    } else {
      setUsername("prof_alan");
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isValidDemoCredentials(username, password, selectedRole)) {
      setError("Login failed. The username and password do not match the selected account.");
      addLog("WARN", "Login", `Failed sign-in attempt for "${username}" as ${selectedRole}.`);
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      const loggedInUser = login(username, password, selectedRole);
      if (!loggedInUser) {
        setError("Login failed. The username and password do not match the selected account.");
        setIsLoading(false);
        return;
      }
      addLog(
        "EVENT",
        loggedInUser.full_name,
        `Logged in to the exam portal as ${selectedRole === "teacher" ? "teacher" : "student"}`
      );
      setIsLoading(false);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      {/* Top Academic Brand */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-orange-500 text-white shadow-md mb-3">
          <GraduationCap className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-black text-slate-800 tracking-tight">
          LAN PROGRAMMING EXAM SYSTEM
        </h1>
      </div>

      {/* Boxed Login Container */}
      <div className="w-full max-w-md bg-white rounded-lg border border-slate-200 shadow-sm p-6 sm:p-8">
        {/* Role Tabs */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md mb-6 border border-slate-200">
          <button
            type="button"
            onClick={() => handleRoleSelect("student")}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded text-xs font-bold transition-all ${selectedRole === "student"
                ? "bg-white text-orange-600 shadow-xs border border-slate-200"
                : "text-slate-500 hover:text-slate-800"
              }`}
          >
            <GraduationCap className="w-4 h-4" />
            Student Login
          </button>
          <button
            type="button"
            onClick={() => handleRoleSelect("teacher")}
            className={`flex items-center justify-center gap-2 py-2 px-3 rounded text-xs font-bold transition-all ${selectedRole === "teacher"
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-500 hover:text-slate-800"
              }`}
          >
            <Shield className="w-4 h-4 text-orange-400" />
            Teacher / Admin
          </button>
        </div>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
          >
            <AlertCircle className="w-4 h-4 mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold tracking-wider uppercase text-slate-500 mb-1 font-mono">
              {selectedRole === "student" ? "Student ID / Username" : "Instructor Identifier"}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <UserIcon className="w-4 h-4" />
              </div>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={selectedRole === "student" ? "student_john" : "prof_alan"}
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold tracking-wider uppercase text-slate-500 mb-1 font-mono">
              Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold tracking-wide shadow-sm transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In as {selectedRole === "teacher" ? "Instructor" : "Student"}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Quick Credentials Picker */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2.5 font-mono">
            <Sparkles className="w-3.5 h-3.5 text-orange-500" />
            Quick Demo Accounts:
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => handleRoleSelect("student")}
              className={`p-2.5 rounded border text-left transition-colors ${selectedRole === "student"
                  ? "border-orange-500 bg-orange-50/50"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50"
                }`}
            >
              <div className="font-bold text-slate-800 text-xs">Student Portal</div>
              <div className="text-[11px] text-slate-500 font-mono">student_john / password123</div>
            </button>
            <button
              type="button"
              onClick={() => handleRoleSelect("teacher")}
              className={`p-2.5 rounded border text-left transition-colors ${selectedRole === "teacher"
                  ? "border-orange-500 bg-orange-50/50"
                  : "border-slate-200 hover:border-slate-300 bg-slate-50"
                }`}
            >
              <div className="font-bold text-slate-800 text-xs">Teacher Portal</div>
              <div className="text-[11px] text-slate-500 font-mono">prof_alan / password123</div>
            </button>
          </div>
        </div>
      </div>

      <div className="text-center mt-6 text-[11px] text-slate-400 font-mono">
        LAN Mode Active • Host SQLite & Piston Sandbox Ready
      </div>
    </div>
  );
}
