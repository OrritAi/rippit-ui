"use client";

import { useEffect } from "react";
import { WorkflowGlobe } from "@/components/dashboard/globe/WorkflowGlobe";

/*
 * Home = the workflow globe, and nothing else. Every workflow across the
 * connected platforms on one sphere; browse/search/health live elsewhere.
 */
export default function DashboardPage() {
  useEffect(() => {
    document.title = "Orrit";
  }, []);
  return <WorkflowGlobe />;
}
