"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { User, UserRole } from "@/types";
import { MOCK_USER_STUDENT, MOCK_USER_TEACHER } from "./api";

interface AuthContextType {
  user: User | null;
  role: UserRole;
  token: string | null;
  login: (username: string, role?: UserRole) => void;
  logout: () => void;
  isTeacher: boolean;
  isStudent: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_COOKIE = "lan_exam_role";

function setAuthCookie(role: UserRole) {
  document.cookie = `${AUTH_COOKIE}=${role}; path=/; max-age=28800; samesite=lax`;
}

function clearAuthCookie() {
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    // Check local storage for persistent session
    const savedUser = localStorage.getItem("lan_exam_user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed?.role === "teacher" || parsed?.role === "student") {
          setUser(parsed);
          setToken("auth_token_" + parsed.role);
          setAuthCookie(parsed.role);
        } else {
          localStorage.removeItem("lan_exam_user");
          clearAuthCookie();
        }
      } catch (e) {
        localStorage.removeItem("lan_exam_user");
        clearAuthCookie();
      }
    } else {
      clearAuthCookie();
    }
    setIsLoading(false);
  }, []);

  const login = (username: string, role: UserRole = "student") => {
    const newUser: User =
      role === "teacher"
        ? { ...MOCK_USER_TEACHER, username: username || "prof_alan" }
        : { ...MOCK_USER_STUDENT, username: username || "student_john" };
    setUser(newUser);
    setToken("auth_token_" + role);
    localStorage.setItem("lan_exam_user", JSON.stringify(newUser));
    setAuthCookie(role);
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("lan_exam_user");
    clearAuthCookie();
  };

  const role: UserRole = user?.role || "student";
  const isTeacher = user?.role === "teacher";
  const isStudent = user?.role === "student";
  const isAuthenticated = !!user;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        token,
        login,
        logout,
        isTeacher,
        isStudent,
        isAuthenticated,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
