"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { User, UserRole } from "@/types";
import { loginRequest, fetchCurrentUser } from "./api";

interface AuthContextType {
  user: User | null;
  role: UserRole;
  token: string | null;
  login: (username: string, password: string, role?: UserRole) => Promise<User | null>;
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
      const savedToken = localStorage.getItem("lan_exam_token");
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          if (parsed?.role === "teacher" || parsed?.role === "student") {
            setUser(parsed);
            setToken(savedToken || "auth_token_" + parsed.role);
            setAuthCookie(parsed.role);
          } else {
            localStorage.removeItem("lan_exam_user");
            localStorage.removeItem("lan_exam_token");
            clearAuthCookie();
          }
        } catch (e) {
          localStorage.removeItem("lan_exam_user");
          localStorage.removeItem("lan_exam_token");
          clearAuthCookie();
        }
      } else {
        clearAuthCookie();
      }
      setIsLoading(false);
    }, []);

  const login = async (
    username: string,
    password: string,
    role: UserRole = "student"
    ): Promise<User | null> => {
      // Real backend authentication (JWT)
      const result = await loginRequest(username, password);
      if (!result) return null;

      const profile = await fetchCurrentUser(result.access_token);
      if (!profile) return null;

      // The role is authoritative from the backend profile
      setUser(profile);
      setToken(result.access_token);
      localStorage.setItem("lan_exam_user", JSON.stringify(profile));
      localStorage.setItem("lan_exam_token", result.access_token);
      setAuthCookie(profile.role);
      return profile;
    };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("lan_exam_user");
      localStorage.removeItem("lan_exam_token");
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
