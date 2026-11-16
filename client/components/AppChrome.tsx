"use client";

import { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { Navbar } from "@/components/navbar";
import Footer from "@/components/footer";

export function AppChrome({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return <main className="min-h-screen w-full">{children}</main>;
  }

  return (
    <div className="relative flex flex-col min-h-screen min-w-0 w-full overflow-x-hidden">
      <div className="fixed top-0 left-0 right-0 z-[9999]">
        <Navbar />
      </div>
      <main className="container mx-auto max-w-7xl pt-16 px-6 flex-grow overflow-x-hidden w-full">
        {children}
      </main>
      <Footer />
    </div>
  );
}