"use client";

import { useState } from "react";

import CorporateEmployeeAccess from "@/components/food-services/corporate-employee-access";
import EmployeeAccess from "@/components/food-services/employee-access";

type EmployeeIdentity = {
  employeeNumber: string;
  fullName: string;
};

type EmployeePortalAccessProps = {
  corporateEmployee: EmployeeIdentity | null;
};

export default function EmployeePortalAccess({
  corporateEmployee,
}: EmployeePortalAccessProps) {
  const [corporateAccessGranted, setCorporateAccessGranted] =
    useState(false);

  if (corporateEmployee && !corporateAccessGranted) {
    return (
      <CorporateEmployeeAccess
        employee={corporateEmployee}
        onAccessGranted={() => setCorporateAccessGranted(true)}
      />
    );
  }

  return <EmployeeAccess />;
}