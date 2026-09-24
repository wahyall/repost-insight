"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  MessageSquare,
  Users,
  KeyRound,
  Home,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";

export function Navbar() {
  const pathname = usePathname();

  // Don't render on login page
  if (pathname === "/login") return null;

  const navLinks = [
    { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
    { href: "/chat", label: "Chatbot RAG", icon: MessageSquare },
    { href: "/settings/followers", label: "Followers", icon: Users },
    { href: "/settings/apify-keys", label: "API Keys", icon: KeyRound },
  ];

  return (
    <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900 text-sm tracking-tight">
            <span className="w-6 h-6 rounded-lg bg-amber-500 text-white flex items-center justify-center text-xs font-black shadow-sm">
              RI
            </span>
            RepostInsight
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    isActive
                      ? "bg-slate-100 text-slate-900 font-semibold"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 transition p-1.5 rounded-lg hover:bg-slate-50"
            title="Keluar"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        </div>
      </div>
    </header>
  );
}
