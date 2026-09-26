import type { OeeWorkbookData } from "@/types/oee";

import {
  buildOeeAudit,
  type OeeAuditResult,
} from "./audit";

import {
  buildOeeDepartmentAnalytics,
  type OeeDepartmentAnalytics,
} from "./department";

import {
  buildOeeExecutiveAnalytics,
  type OeeExecutiveAnalytics,
} from "./executive";

import {
  buildOeeInsights,
  type OeeInsight,
} from "./insights";

import {
  buildOeeMachineAnalytics,
  type OeeMachineAnalytics,
} from "./machines";

import {
  buildOeeRanking,
  type OeeRanking,
} from "./ranking";

import {
  buildOeeSummary,
  type OeeSummary,
} from "./summary";

export type OeeEngineResult = {
  audit: OeeAuditResult;
  summary: OeeSummary;
  ranking: OeeRanking;
  insights: OeeInsight[];
  departments: OeeDepartmentAnalytics;
  machines: OeeMachineAnalytics;
  executive: OeeExecutiveAnalytics;
};

export function buildOeeEngine(
  data: OeeWorkbookData,
): OeeEngineResult {
  const audit = buildOeeAudit(data);

  const summary = buildOeeSummary(data);

  const ranking = buildOeeRanking(data);

  const insights = buildOeeInsights(
    data,
    summary,
    ranking,
  );

  const departments =
    buildOeeDepartmentAnalytics(data);

  const machines =
    buildOeeMachineAnalytics(data);

  const executive =
    buildOeeExecutiveAnalytics(
      data,
      departments,
    );

  return {
    audit,
    summary,
    ranking,
    insights,
    departments,
    machines,
    executive,
  };
}