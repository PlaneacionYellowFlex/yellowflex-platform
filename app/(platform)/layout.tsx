import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";
import { getCurrentCorporateUser } from "@/lib/auth/corporate-auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentCorporateUser();

  if (!user) {
    redirect("/login");
  }

  const credential = await db.user.findUnique({ where: { id: user.id }, select: { passwordMustChange: true } });
  if (credential?.passwordMustChange) redirect("/change-password");

  return (
    <div className="min-h-screen bg-[#f7f9fc]">
      <Sidebar />

      <div className="min-h-screen lg:pl-72">
        <Topbar user={user} />

        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}