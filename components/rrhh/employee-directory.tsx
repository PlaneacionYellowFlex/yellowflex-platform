"use client";

import {
  ArrowRight,
  Clock3,
  Filter,
  IdCard,
  Search,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type EmployeeDirectoryItem = {
  id: string;
  employeeNumber: string;
  fullName: string;
  position: string | null;
  status: "ACTIVE" | "INACTIVE";
  department: {
    id: string;
    code: string;
    name: string;
  };
  workShift: {
    id: string;
    code: string;
    name: string;
    startTime: string;
    endTime: string;
  } | null;
};

type EmployeeDirectoryProps = {
  employees: EmployeeDirectoryItem[];
};

export default function EmployeeDirectory({
  employees,
}: EmployeeDirectoryProps) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [workShiftId, setWorkShiftId] = useState("ALL");

  const departments = useMemo(() => {
    const uniqueDepartments = new Map<
      string,
      EmployeeDirectoryItem["department"]
    >();

    employees.forEach((employee) => {
      uniqueDepartments.set(
        employee.department.id,
        employee.department,
      );
    });

    return Array.from(uniqueDepartments.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
  }, [employees]);

  const workShifts = useMemo(() => {
    const uniqueWorkShifts = new Map<
      string,
      NonNullable<EmployeeDirectoryItem["workShift"]>
    >();

    employees.forEach((employee) => {
      if (employee.workShift) {
        uniqueWorkShifts.set(
          employee.workShift.id,
          employee.workShift,
        );
      }
    });

    return Array.from(uniqueWorkShifts.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
  }, [employees]);

  const filteredEmployees = useMemo(() => {
    const normalizedSearch = normalizeText(search);

    return employees.filter((employee) => {
      const matchesSearch =
        normalizedSearch === "" ||
        [
          employee.employeeNumber,
          employee.fullName,
          employee.position ?? "",
          employee.department.name,
          employee.department.code,
          employee.workShift?.name ?? "",
        ].some((value) =>
          normalizeText(value).includes(normalizedSearch),
        );

      const matchesDepartment =
        departmentId === "ALL" ||
        employee.department.id === departmentId;

      const matchesStatus =
        status === "ALL" || employee.status === status;

      const matchesWorkShift =
  workShiftId === "ALL" ||
  (workShiftId === "NO_SHIFT"
    ? employee.workShift === null
    : employee.workShift?.id === workShiftId);

      return (
        matchesSearch &&
        matchesDepartment &&
        matchesStatus &&
        matchesWorkShift
      );
    });
  }, [
    employees,
    search,
    departmentId,
    status,
    workShiftId,
  ]);

  const hasFilters =
    search.trim() !== "" ||
    departmentId !== "ALL" ||
    status !== "ALL" ||
    workShiftId !== "ALL";

  function clearFilters() {
    setSearch("");
    setDepartmentId("ALL");
    setStatus("ALL");
    setWorkShiftId("ALL");
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-5 sm:px-8">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#b27f00]">
              Directorio corporativo
            </p>

            <h2 className="mt-2 text-xl font-bold text-slate-900">
              Colaboradores
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Consulta y filtra el maestro corporativo de personal.
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-[#0b3a82]">
              {filteredEmployees.length}
            </span>
            <span className="text-slate-500">
              de {employees.length} colaboradores
            </span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(280px,1.5fr)_1fr_1fr_1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, empleado, puesto..."
              aria-label="Buscar colaboradores"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#0b3a82] focus:bg-white focus:ring-4 focus:ring-blue-50"
            />
          </div>

          <FilterSelect
            value={departmentId}
            onChange={setDepartmentId}
            ariaLabel="Filtrar por departamento"
          >
            <option value="ALL">Todos los departamentos</option>

            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            value={status}
            onChange={setStatus}
            ariaLabel="Filtrar por estatus"
          >
            <option value="ALL">Todos los estatus</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </FilterSelect>

          <FilterSelect
            value={workShiftId}
            onChange={setWorkShiftId}
            ariaLabel="Filtrar por turno"
          >
            <option value="ALL">Todos los turnos</option>

            {workShifts.map((workShift) => (
              <option key={workShift.id} value={workShift.id}>
                {workShift.name}
              </option>
            ))}

            <option value="NO_SHIFT">Sin turno</option>
          </FilterSelect>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#0b3a82] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="size-4" />
            Limpiar
          </button>
        </div>

        {hasFilters && (
          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-slate-500">
            <Filter className="size-3.5 text-[#b27f00]" />
            Filtros activos
          </div>
        )}
      </div>

      {employees.length === 0 ? (
        <EmptyState
          title="No hay colaboradores registrados"
          description="Los colaboradores aparecerán aquí cuando existan registros en PostgreSQL."
        />
      ) : filteredEmployees.length === 0 ? (
        <EmptyState
          title="No encontramos coincidencias"
          description="Modifica la búsqueda o elimina alguno de los filtros aplicados."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200">
                <TableHeader>Empleado</TableHeader>
                <TableHeader>Colaborador</TableHeader>
                <TableHeader>Puesto</TableHeader>
                <TableHeader>Departamento</TableHeader>
                <TableHeader>Turno</TableHeader>
                <TableHeader>Estatus</TableHeader>
                <TableHeader>
                  <span className="sr-only">Expediente</span>
                </TableHeader>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.map((employee) => (
                <tr
                  key={employee.id}
                  className="transition-colors hover:bg-slate-50/80"
                >
                  <TableCell>
                    <div className="flex items-center gap-2 font-semibold text-slate-700">
                      <IdCard className="size-4 text-slate-400" />
                      {employee.employeeNumber}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Link
                      href={`/modules/rrhh/employees/${employee.id}`}
                      className="group flex items-center gap-3"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#0b3a82] transition group-hover:bg-[#0b3a82] group-hover:text-white">
                        <UserRound className="size-4" />
                      </div>

                      <span className="font-semibold text-slate-900 transition group-hover:text-[#0b3a82]">
                        {employee.fullName}
                      </span>
                    </Link>
                  </TableCell>

                  <TableCell>
                    {employee.position ?? "Sin puesto"}
                  </TableCell>

                  <TableCell>
                    <div>
                      <p className="font-medium text-slate-700">
                        {employee.department.name}
                      </p>

                      <p className="mt-0.5 text-xs text-slate-400">
                        {employee.department.code}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell>
                    {employee.workShift ? (
                      <div>
                        <div className="flex items-center gap-2 font-medium text-slate-700">
                          <Clock3 className="size-4 text-slate-400" />
                          {employee.workShift.name}
                        </div>

                        <p className="mt-0.5 text-xs text-slate-400">
                          {employee.workShift.startTime} –{" "}
                          {employee.workShift.endTime}
                        </p>
                      </div>
                    ) : (
                      <span className="text-slate-400">
                        Sin turno
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={employee.status} />
                  </TableCell>

                  <TableCell>
                    <Link
                      href={`/modules/rrhh/employees/${employee.id}`}
                      aria-label={`Abrir expediente de ${employee.fullName}`}
                      className="inline-flex size-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-[#0b3a82]"
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FilterSelect({
  value,
  onChange,
  ariaLabel,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0b3a82] focus:bg-white focus:ring-4 focus:ring-blue-50"
    >
      {children}
    </select>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="px-6 py-16 text-center">
      <UsersRound className="mx-auto size-10 text-slate-300" />

      <h3 className="mt-4 font-bold text-slate-900">
        {title}
      </h3>

      <p className="mt-2 text-sm text-slate-500">
        {description}
      </p>
    </div>
  );
}

function TableHeader({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <th className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">
      {children}
    </th>
  );
}

function TableCell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <td className="px-6 py-4 text-sm text-slate-600">
      {children}
    </td>
  );
}

function StatusBadge({
  status,
}: {
  status: "ACTIVE" | "INACTIVE";
}) {
  const active = status === "ACTIVE";

  return (
    <span
      className={
        active
          ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"
          : "inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"
      }
    >
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}