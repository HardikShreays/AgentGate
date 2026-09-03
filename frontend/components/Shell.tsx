"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

// The landing page (/) is the product's front door and gets no app
// chrome; every other route is the merchant dashboard and keeps the
// sidebar. Splitting this by pathname here avoids moving every app
// route into a Next.js route group just to drop the sidebar on one page.
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const marketing = pathname === "/";

  if (marketing) return <>{children}</>;

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
