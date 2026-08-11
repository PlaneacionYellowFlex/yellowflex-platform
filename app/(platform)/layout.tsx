"use client";
import Sidebar from "@/components/sidebar";
import Topbar from "@/components/topbar";

export default function PlatformLayout({children}:{children:React.ReactNode}){
  return(
    <div className="min-h-screen bg-slate-100">
      <Sidebar/>
      <div className="ml-72">
        <Topbar/>
        <main className="p-8">{children}</main>
      </div>
    </div>
  )
}
