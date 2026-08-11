"use client";
import Link from "next/link";
export default function Sidebar(){
return <aside className="fixed left-0 top-0 h-screen w-72 bg-[#0B3A82] text-white p-6">
<h1 className="text-2xl font-bold">YellowFlex</h1>
<nav className="mt-6 space-y-2">
<Link href="/dashboard">Dashboard</Link><br/>
<Link href="/modules/food-services">Food Services</Link><br/>
<Link href="/modules/rrhh">RH</Link><br/>
<Link href="/modules/control-tower">Control Tower</Link>
</nav></aside>}
