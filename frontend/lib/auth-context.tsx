"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { User, UserRole } from "@/types";
import { ApiError, loginRequest, fetchCurrentUser } from "./api";

interface AuthContextType {
  user: User | null;
  role: UserRole;
  token: string | null;
  login: (username: string, password: string, role?: UserRole) => Promise<User>;
  logout: (reason?: string) => void;
  retrySession: () => Promise<void>;
  sessionError: string | null;
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
  const [sessionError, setSessionError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    clearAuthCookie();
    localStorage.removeItem("lan_exam_user");
    localStorage.removeItem("lan_exam_token");
  }, []);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setSessionError(null);
    setUser(null);
    setToken(null);
    clearAuthCookie();

    let savedToken: string | null;
    try {
      savedToken = localStorage.getItem("lan_exam_token");
    } catch {
      setSessionError("Browser storage is unavailable. Sign in again after enabling local storage.");
      setIsLoading(false);
      return;
    }

    if (!savedToken) {
      try {
        clearSession();
      } catch {
        setSessionError("Could not clear the expired local session. Please clear browser storage and retry.");
      }
      setIsLoading(false);
      return;
    }

    try {
      const profile = await fetchCurrentUser(savedToken);
      localStorage.setItem("lan_exam_user", JSON.stringify(profile));
      setUser(profile);
      setToken(savedToken);
      setAuthCookie(profile.role);
    } catch (error) {
      setUser(null);
      setToken(null);
      clearAuthCookie();

      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        try {
          clearSession();
        } catch {
          setSessionError("Your saved session was rejected, but browser storage could not be cleared.");
          setIsLoading(false);
          return;
        }
        setSessionError("Your saved session is no longer valid. Please sign in again.");
      } else {
        setSessionError(
          "Could not verify your saved session with the backend. You are signed out; retry verification when the backend is available."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  const login = async (
    username: string,
    password: string,
    selectedRole: UserRole = "student"
  ): Promise<User> => {
    setSessionError(null);
    clearSession();

    try {
      const result = await loginRequest(username, password);
      const profile = await fetchCurrentUser(result.access_token);
      if (profile.role !== selectedRole) {
        throw new Error(
          `This account's backend role is ${profile.role}. Select ${profile.role} login to continue.`
        );
      }

      localStorage.setItem("lan_exam_user", JSON.stringify(profile));
      localStorage.setItem("lan_exam_token", result.access_token);
      setUser(profile);
      setToken(result.access_token);
      setAuthCookie(profile.role);
      return profile;
    } catch (error) {
      clearSession();
      throw error;
    }
  };

  const logout = useCallback(
    (reason?: string) => {
      clearSession();
      setSessionError(reason ?? null);
    },
    [clearSession]
  );

  const role: UserRole = user?.role || "student";
  const isTeacher = user?.role === "teacher";
  const isStudent = user?.role === "student";
  const isAuthenticated = !!user && !!token;

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        token,
        login,
        logout,
        retrySession: restoreSession,
        sessionError,
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
