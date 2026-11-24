"use client";
import EmployeeAccess from "@/components/food-services/employee-access";
export default function EmployeePortalAccess(_props: { corporateEmployee: { employeeNumber: string; fullName: string } | null }) {
  return <EmployeeAccess />;
}
