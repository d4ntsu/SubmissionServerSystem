import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { SocketProvider } from "@/lib/socket-context";

export const metadata: Metadata = {
  title: "LAN Programming Exam LMS",
  description: "Local-network programming exam and auto-grading system with realtime monitoring",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-100 text-slate-900 min-h-screen font-sans selection:bg-orange-500 selection:text-white">
        <AuthProvider>
          <SocketProvider>
            {children}
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
