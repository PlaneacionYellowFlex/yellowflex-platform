import ExcelJS from "exceljs";
import { getHrBillingSummary } from "@/lib/food-services/hr-billing-service";
import { getExtraordinaryFoodServicesByWeek } from "@/lib/food-services/extraordinary-service";

function dateKey(value: Date | string) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatWeekForFile(value: Date | string) {
  return dateKey(value).replaceAll("-", "");
}

function serviceLabel(serviceType: string) {
  if (serviceType === "BREAKFAST") {
    return "Desayuno";
  }

  if (serviceType === "LUNCH") {
    return "Comida";
  }

  return serviceType;
}

function applyHeaderStyle(
  row: ExcelJS.Row,
  columnCount: number,
) {
  for (
    let column = 1;
    column <= columnCount;
    column += 1
  ) {
    const cell = row.getCell(column);

    cell.font = {
      bold: true,
      color: {
        argb: "FFFFFFFF",
      },
    };

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF0B3A82",
      },
    };

    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
    };

    cell.border = {
      bottom: {
        style: "thin",
        color: {
          argb: "FFD9E2F2",
        },
      },
    };
  }

  row.height = 24;
}

function applyTitle(
  worksheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  lastColumn: number,
) {
  worksheet.mergeCells(1, 1, 1, lastColumn);
  worksheet.mergeCells(2, 1, 2, lastColumn);

  const titleCell = worksheet.getCell(1, 1);
  const subtitleCell = worksheet.getCell(2, 1);

  titleCell.value = title;
  titleCell.font = {
    bold: true,
    size: 18,
    color: {
      argb: "FF0B3A82",
    },
  };
  titleCell.alignment = {
    vertical: "middle",
  };

  subtitleCell.value = subtitle;
  subtitleCell.font = {
    bold: true,
    size: 10,
    color: {
      argb: "FF64748B",
    },
  };

  worksheet.getRow(1).height = 30;
  worksheet.getRow(2).height = 20;
}

export async function buildFoodServicesBillingExport(weekId: string) {
  if (!weekId) {
    throw new Error("Debes indicar la semana que deseas exportar.");
  }

    const billing = await getHrBillingSummary();

    const selectedWeek = billing.weeks.find(
      (week) => week.id === weekId,
    );

    if (!selectedWeek) {
      throw new Error(
        "La semana seleccionada no contiene pedidos confirmados.",
      );
    }

    const orders = billing.orders.filter(
      (order) => order.week.id === weekId,
    );

    if (orders.length === 0) {
      throw new Error(
        "No existen cargos para exportar en esta semana.",
      );
    }

    const totalServices = orders.reduce(
      (total, order) =>
        total + order.itemCount,
      0,
    );

    const totalAmount = orders.reduce(
      (total, order) =>
        total + Number(order.totalAmount),
      0,
    );

    const employeeCount = new Set(
      orders.map((order) => order.employee.id),
    ).size;

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "YELLOWFLEX PLATFORM";
    workbook.company = "YellowFlex";
    workbook.subject =
      "Concentrado de cobros Food Services";
    workbook.title =
      "Food Services - Corte de nómina";
    workbook.created = new Date();

    const summary =
      workbook.addWorksheet("Concentrado Nómina", {
        views: [
          {
            state: "frozen",
            ySplit: 5,
          },
        ],
      });

    applyTitle(
      summary,
      "YELLOWFLEX · FOOD SERVICES",
      `Concentrado de nómina · Semana ${dateKey(
        selectedWeek.weekStart,
      )}`,
      9,
    );

    summary.getCell("A4").value =
      "Nómina";
    summary.getCell("B4").value =
      "Colaborador";
    summary.getCell("C4").value =
      "Departamento";
    summary.getCell("D4").value =
      "Puesto";
    summary.getCell("E4").value =
      "Turno";
    summary.getCell("F4").value =
      "Servicios";
    summary.getCell("G4").value =
      "Precio unitario";
    summary.getCell("H4").value =
      "Total a descontar";
    summary.getCell("I4").value =
      "Confirmado";

    applyHeaderStyle(summary.getRow(4), 9);

    for (const order of orders) {
      const row = summary.addRow([
        order.employee.employeeNumber,
        order.employee.fullName,
        order.employee.department.name,
        order.employee.position ?? "",
        order.employee.workShift?.code ?? "",
        order.itemCount,
        Number(order.unitPrice),
        Number(order.totalAmount),
        new Date(order.confirmedAt),
      ]);

      row.getCell(7).numFmt =
        '"$"#,##0.00';
      row.getCell(8).numFmt =
        '"$"#,##0.00';
      row.getCell(9).numFmt =
        "dd/mm/yyyy hh:mm";

      row.alignment = {
        vertical: "middle",
      };
    }

    const totalRow =
      summary.addRow([
        "",
        "TOTAL",
        "",
        "",
        "",
        totalServices,
        "",
        totalAmount,
        "",
      ]);

    totalRow.font = {
      bold: true,
      color: {
        argb: "FF0B3A82",
      },
    };

    totalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FFFFF8E1",
      },
    };

    totalRow.getCell(8).numFmt =
      '"$"#,##0.00';

    summary.addRow([]);

    const controlRow =
      summary.addRow([
        "CONTROL",
        `${employeeCount} colaborador(es) · ${orders.length} pedido(s) · ${totalServices} servicio(s)`,
        "",
        "",
        "",
        "",
        "",
        totalAmount,
        "",
      ]);

    controlRow.font = {
      bold: true,
    };

    controlRow.getCell(8).numFmt =
      '"$"#,##0.00';

    summary.columns = [
      { width: 14 },
      { width: 34 },
      { width: 24 },
      { width: 30 },
      { width: 12 },
      { width: 12 },
      { width: 18 },
      { width: 20 },
      { width: 22 },
    ];

    summary.autoFilter = {
      from: "A4",
      to: `I${4 + orders.length}`,
    };

    const detail =
      workbook.addWorksheet(
        "Detalle de Servicios",
        {
          views: [
            {
              state: "frozen",
              ySplit: 5,
            },
          ],
        },
      );

    applyTitle(
      detail,
      "YELLOWFLEX · FOOD SERVICES",
      `Detalle de servicios cobrables · Semana ${dateKey(
        selectedWeek.weekStart,
      )}`,
      10,
    );

    detail.getCell("A4").value =
      "Nómina";
    detail.getCell("B4").value =
      "Colaborador";
    detail.getCell("C4").value =
      "Departamento";
    detail.getCell("D4").value =
      "Turno";
    detail.getCell("E4").value =
      "Fecha servicio";
    detail.getCell("F4").value =
      "Tipo";
    detail.getCell("G4").value =
      "Platillo";
    detail.getCell("H4").value =
      "Importe";
    detail.getCell("I4").value =
      "Pedido";
    detail.getCell("J4").value =
      "Reservación";

    applyHeaderStyle(detail.getRow(4), 10);

    let detailCount = 0;
    let detailAmount = 0;

    for (const order of orders) {
      for (const service of order.services) {
        const serviceAmount =
          Number(order.unitPrice);

        const row = detail.addRow([
          order.employee.employeeNumber,
          order.employee.fullName,
          order.employee.department.name,
          order.employee.workShift?.code ?? "",
          new Date(service.serviceDate),
          serviceLabel(service.serviceType),
          service.name,
          serviceAmount,
          order.id,
          service.reservationId,
        ]);

        row.getCell(5).numFmt =
          "dd/mm/yyyy";
        row.getCell(8).numFmt =
          '"$"#,##0.00';

        row.alignment = {
          vertical: "middle",
        };

        detailCount += 1;
        detailAmount += serviceAmount;
      }
    }

    const detailTotalRow =
      detail.addRow([
        "",
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        detailAmount,
        "",
        "",
      ]);

    detailTotalRow.font = {
      bold: true,
      color: {
        argb: "FF0B3A82",
      },
    };

    detailTotalRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FFFFF8E1",
      },
    };

    detailTotalRow.getCell(8).numFmt =
      '"$"#,##0.00';

    detail.columns = [
      { width: 14 },
      { width: 34 },
      { width: 24 },
      { width: 12 },
      { width: 18 },
      { width: 16 },
      { width: 38 },
      { width: 16 },
      { width: 30 },
      { width: 30 },
    ];

    if (detailCount > 0) {
      detail.autoFilter = {
        from: "A4",
        to: `J${4 + detailCount}`,
      };
    }

    const control =
      workbook.addWorksheet("Control");

    applyTitle(
      control,
      "YELLOWFLEX · FOOD SERVICES",
      "Validación del corte de nómina",
      4,
    );

    control.addRow([]);

    control.addRow([
      "Concepto",
      "Valor",
      "",
      "",
    ]);

    applyHeaderStyle(control.getRow(4), 4);

    control.addRow([
      "Semana",
      dateKey(selectedWeek.weekStart),
    ]);

    control.addRow([
      "Fecha de generación",
      new Date(),
    ]);

    control.getCell("B6").numFmt =
      "dd/mm/yyyy hh:mm";

    control.addRow([
      "Colaboradores",
      employeeCount,
    ]);

    control.addRow([
      "Pedidos confirmados",
      orders.length,
    ]);

    control.addRow([
      "Servicios cobrables",
      totalServices,
    ]);

    control.addRow([
      "Total a nómina",
      totalAmount,
    ]);

    control.getCell("B10").numFmt =
      '"$"#,##0.00';

    control.addRow([
      "Servicios en detalle",
      detailCount,
    ]);

    control.addRow([
      "Total detalle",
      detailAmount,
    ]);

    control.getCell("B12").numFmt =
      '"$"#,##0.00';

    control.addRow([
      "Validación",
      totalServices === detailCount &&
      Math.abs(
        totalAmount - detailAmount,
      ) < 0.001
        ? "CUADRA"
        : "REVISAR",
    ]);

    const validationCell =
      control.getCell("B13");

    validationCell.font = {
      bold: true,
      color: {
        argb:
          validationCell.value === "CUADRA"
            ? "FF166534"
            : "FFB91C1C",
      },
    };

    control.columns = [
      { width: 28 },
      { width: 30 },
      { width: 4 },
      { width: 4 },
    ];

    const extraordinary = await getExtraordinaryFoodServicesByWeek(weekId);

    const extraordinarySheet = workbook.addWorksheet("Servicios Extraordinarios", {
      views: [{ state: "frozen", ySplit: 5 }],
    });

    applyTitle(
      extraordinarySheet,
      "YELLOWFLEX · FOOD SERVICES",
      `Servicios extraordinarios autorizados · Semana ${dateKey(selectedWeek.weekStart)}`,
      12,
    );

    [
      "Fecha servicio", "Tipo", "Invitado / referencia", "Empresa", "Platillo",
      "Cantidad", "Precio unitario", "Importe", "Responsable del costo",
      "Área responsable", "Motivo", "Autorizó",
    ].forEach((value, index) => { extraordinarySheet.getCell(4, index + 1).value = value; });
    applyHeaderStyle(extraordinarySheet.getRow(4), 12);

    const guestTypeLabel = (value: string) => ({ PROVIDER: "Proveedor", VISITOR: "Visitante", NEW_HIRE: "Nuevo ingreso", OTHER: "Otro" }[value] ?? value);
    const chargeTypeLabel = (value: string) => ({ YELLOWFLEX: "YellowFlex", PROVIDER: "Proveedor", COURTESY: "Cortesía", OTHER: "Otro" }[value] ?? value);

    let extraordinaryTotal = 0;
    let extraordinaryServices = 0;
    for (const record of extraordinary) {
      const amount = Number(record.priceApplied) * record.quantity;
      extraordinaryTotal += amount;
      extraordinaryServices += record.quantity;
      const row = extraordinarySheet.addRow([
        new Date(record.menuItem.menuDay.serviceDate), guestTypeLabel(record.guestType),
        record.guestName, record.company ?? "", record.menuItem.name, record.quantity,
        Number(record.priceApplied), amount, chargeTypeLabel(record.chargeType),
        record.areaResponsible ?? "", record.reason, record.authorizedBy.name,
      ]);
      row.getCell(1).numFmt = "dd/mm/yyyy";
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
    }

    const extraordinaryTotalRow = extraordinarySheet.addRow([
      "", "", "TOTAL", "", "", extraordinaryServices, "", extraordinaryTotal, "", "", "", "",
    ]);
    extraordinaryTotalRow.font = { bold: true, color: { argb: "FF0B3A82" } };
    extraordinaryTotalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
    extraordinaryTotalRow.getCell(8).numFmt = '"$"#,##0.00';
    extraordinarySheet.columns = [
      { width: 16 }, { width: 16 }, { width: 30 }, { width: 24 }, { width: 30 }, { width: 10 },
      { width: 16 }, { width: 16 }, { width: 22 }, { width: 22 }, { width: 34 }, { width: 28 },
    ];
    if (extraordinary.length > 0) extraordinarySheet.autoFilter = { from: "A4", to: `L${4 + extraordinary.length}` };

    const excelBuffer =
      await workbook.xlsx.writeBuffer();

    const body = new Uint8Array(excelBuffer);

    const fileName =
      `YellowFlex_FoodServices_Nomina_${formatWeekForFile(
        selectedWeek.weekStart,
      )}.xlsx`;

    return {
      body,
      fileName,
    };
}
