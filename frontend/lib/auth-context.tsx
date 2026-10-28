"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { User, UserRole } from "@/types";
import {
  ApiError,
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  refreshAccessToken,
  setAccessToken,
  subscribeAccessToken,
  subscribeSessionExpired,
} from "./api";

interface AuthContextType {
  user: User | null;
  role: UserRole;
  token: string | null;
  login: (username: string, password: string, role?: UserRole) => Promise<User>;
  logout: () => Promise<void>;
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

function clearLegacyCredentials() {
  try {
    localStorage.removeItem("lan_exam_user");
    localStorage.removeItem("lan_exam_token");
  } catch (error) {
    console.warn("Could not remove legacy browser-stored auth data.", error);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    clearAuthCookie();
    clearLegacyCredentials();
  }, []);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setSessionError(null);
    setUser(null);
    setAccessToken(null);
    clearAuthCookie();
    clearLegacyCredentials();

    try {
      const accessToken = await refreshAccessToken();
      const profile = await fetchCurrentUser(accessToken);
      setUser(profile);
      setAuthCookie(profile.role);
    } catch (error) {
      clearSession();
      if (error instanceof ApiError && error.status === 401) {
        return;
      }
      if (error instanceof ApiError && error.status === 404) {
        setSessionError(
          "The backend does not have the /auth/refresh endpoint. Update or restart the backend, then retry session verification."
        );
        return;
      }
      setSessionError(
        "Could not verify your session because the backend is unavailable. You are signed out; retry when it is available."
      );
    } finally {
      setIsLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    const unsubscribeToken = subscribeAccessToken(setToken);
    const unsubscribeExpired = subscribeSessionExpired(() => {
      setUser(null);
      clearAuthCookie();
      setSessionError("Your session expired or was revoked. Please sign in again.");
    });
    return () => {
      unsubscribeToken();
      unsubscribeExpired();
    };
  }, []);

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
      setAccessToken(result.access_token);
      setUser(profile);
      setAuthCookie(profile.role);
      return profile;
    } catch (error) {
      try {
        await logoutRequest();
      } catch (revokeError) {
        console.error("Could not revoke the refresh session after login failed.", revokeError);
      }
      clearSession();
      throw error;
    }
  };

  const logout = useCallback(async () => {
    clearSession();
    setSessionError(null);
    try {
      await logoutRequest();
    } catch (error) {
      console.error("Local sign-out completed, but backend session revocation failed.", error);
      setSessionError(
        "You were signed out on this device, but the backend could not confirm session revocation. Check your connection."
      );
    }
  }, [clearSession]);

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
