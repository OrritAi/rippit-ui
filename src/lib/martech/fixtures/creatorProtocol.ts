import type { FunnelAutomation, FunnelGraph, FunnelPage, FunnelStage } from "@/app/lib/api";

/*
 * "Creator Protocol" — a complete FunnelGraph v2 for the dev preview and for
 * exercising every rendering branch: five spine pages, a disqualified page
 * reached by a `branches_to` relationship, one survey decision, six
 * automations (two Meta CAPI conversion actions, one unplaced), a survey
 * embed with its structure, and pages in all four screenshot states.
 *
 * Ids are fixture-only. Nothing here comes from a real account.
 */

const CONN = "conn_ghl_fixture";
const AT = "2026-09-08T09:12:00Z";

/** A tiny inline SVG so the captured state renders an <img> without a network. */
const THUMB =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><rect width='480' height='270' fill='#f4f4f5'/><rect x='40' y='36' width='260' height='22' rx='4' fill='#d4d4d8'/><rect x='40' y='72' width='400' height='12' rx='3' fill='#e4e4e7'/><rect x='40' y='92' width='360' height='12' rx='3' fill='#e4e4e7'/><rect x='40' y='150' width='400' height='84' rx='8' fill='#ffffff' stroke='#d4d4d8'/><rect x='60' y='170' width='200' height='14' rx='3' fill='#e4e4e7'/><rect x='60' y='196' width='120' height='24' rx='4' fill='#18181b'/></svg>`
  );

const stages: FunnelStage[] = [
  { id: "st_optin", kind: "page", displayName: "Opt-in", displayOrder: 0, origin: "suggested", meta: {}, url: "https://go.example.com/creator-protocol", role: "optin", sourceExternalId: "step_1" },
  { id: "st_app", kind: "page", displayName: "VSL + Application", displayOrder: 1, origin: "suggested", meta: {}, url: "https://go.example.com/creator-protocol/apply", role: "application", sourceExternalId: "step_2" },
  { id: "st_book", kind: "page", displayName: "Booking", displayOrder: 2, origin: "suggested", meta: {}, url: "https://go.example.com/creator-protocol/book", role: "booking", sourceExternalId: "step_3" },
  { id: "st_confirm", kind: "page", displayName: "Confirmation", displayOrder: 3, origin: "suggested", meta: {}, url: "https://go.example.com/creator-protocol/confirmed", role: "confirmation", sourceExternalId: "step_4" },
  { id: "st_dq", kind: "page", displayName: "Not a fit", displayOrder: 4, origin: "suggested", meta: {}, url: "https://go.example.com/creator-protocol/not-a-fit", role: "disqualified", sourceExternalId: "step_5" },
];

const pages: FunnelPage[] = [
  {
    id: "pg_optin",
    stageId: "st_optin",
    stepIndex: 0,
    name: "Creator Protocol — free training",
    url: "https://go.example.com/creator-protocol",
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator/pages/pg_optin",
    screenshot: { status: "captured", url: THUMB, capturedAt: AT, reason: null },
    variants: [{ pageExternalId: "pg_optin", name: "Creator Protocol — free training", path: "/creator-protocol", url: "https://go.example.com/creator-protocol", isDefault: true }],
    embeddedAssets: [{ kind: "form", externalId: "form_optin", name: "Creator Protocol opt-in", nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/form-builder/form_optin", assetKind: "ghl_form" }],
    origin: "captured",
    hasTrackingCode: null,
  },
  {
    id: "pg_app",
    stageId: "st_app",
    stepIndex: 0,
    name: "Watch the training + apply",
    url: "https://go.example.com/creator-protocol/apply",
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator/pages/pg_app",
    screenshot: { status: "pending", url: null, capturedAt: null, reason: null },
    variants: [
      { pageExternalId: "pg_app", name: "Watch the training + apply", path: "/creator-protocol/apply", url: "https://go.example.com/creator-protocol/apply", isDefault: true },
      { pageExternalId: "pg_app_b", name: "Apply (short VSL)", path: "/creator-protocol/apply-b", url: "https://go.example.com/creator-protocol/apply-b", isDefault: false },
    ],
    embeddedAssets: [
      {
        kind: "survey",
        externalId: "survey_app",
        name: "Creator Protocol application",
        nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/survey-builder/survey_app",
        assetKind: "ghl_form",
        surveyStructure: {
          surveyId: "survey_app",
          name: "Creator Protocol application",
          questionCount: 4,
          hasLogic: true,
          parsed: true,
          slides: [
            {
              id: "sl_1",
              order: 0,
              title: "About you",
              questions: [
                { id: "q_name", type: "text", label: "What's your name?", required: true, hidden: false, options: [], hasLogic: false, disqualifies: false },
                {
                  id: "q_audience",
                  type: "radio",
                  label: "How big is your audience?",
                  required: true,
                  hidden: false,
                  hasLogic: true,
                  disqualifies: true,
                  options: [
                    { label: "Under 1,000", logic: { action: "disqualify" } },
                    { label: "1,000 – 10,000" },
                    { label: "10,000+" },
                  ],
                },
              ],
            },
            {
              id: "sl_2",
              order: 1,
              title: "Fit",
              questions: [
                {
                  id: "q_budget",
                  type: "radio",
                  label: "Are you able to invest in growth this quarter?",
                  required: true,
                  hidden: false,
                  hasLogic: true,
                  disqualifies: true,
                  options: [
                    { label: "Yes" },
                    { label: "Not right now", logic: { action: "disqualify" } },
                  ],
                },
                { id: "q_goal", type: "textarea", label: "What would a win look like in 90 days?", required: false, hidden: false, options: [], hasLogic: false, disqualifies: false },
              ],
            },
          ],
        },
      },
    ],
    origin: "captured",
    hasTrackingCode: null,
  },
  {
    id: "pg_book",
    stageId: "st_book",
    stepIndex: 0,
    name: "Book your strategy call",
    url: "https://go.example.com/creator-protocol/book",
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator/pages/pg_book",
    screenshot: { status: "failed", url: null, capturedAt: null, reason: "Page returned HTTP 503 on the last three attempts" },
    variants: [{ pageExternalId: "pg_book", name: "Book your strategy call", path: "/creator-protocol/book", url: "https://go.example.com/creator-protocol/book", isDefault: true }],
    embeddedAssets: [{ kind: "calendar", externalId: "cal_strategy", name: "Strategy call (30 min)", nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/calendars/cal_strategy", assetKind: "ghl_calendar" }],
    origin: "captured",
    hasTrackingCode: null,
  },
  {
    id: "pg_confirm",
    stageId: "st_confirm",
    stepIndex: 0,
    name: "You're booked",
    url: "https://go.example.com/creator-protocol/confirmed",
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator/pages/pg_confirm",
    screenshot: { status: "unavailable", url: null, capturedAt: null, reason: "Screenshot renderer is not enabled on this worker" },
    variants: [{ pageExternalId: "pg_confirm", name: "You're booked", path: "/creator-protocol/confirmed", url: "https://go.example.com/creator-protocol/confirmed", isDefault: true }],
    embeddedAssets: [],
    origin: "captured",
    hasTrackingCode: null,
  },
  {
    id: "pg_dq",
    stageId: "st_dq",
    stepIndex: 0,
    name: "Thanks — not a fit right now",
    url: "https://go.example.com/creator-protocol/not-a-fit",
    nativeUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator/pages/pg_dq",
    screenshot: null,
    variants: [{ pageExternalId: "pg_dq", name: "Thanks — not a fit right now", path: "/creator-protocol/not-a-fit", url: "https://go.example.com/creator-protocol/not-a-fit", isDefault: true }],
    embeddedAssets: [],
    origin: "captured",
    hasTrackingCode: null,
  },
];

const wfUrl = (id: string) => `https://app.gohighlevel.com/v2/location/loc_fixture/workflow/${id}`;
const capture = { state: "current" as const, at: AT, attemptedAt: AT, error: null, deletedUpstreamAt: null };

const automations: FunnelAutomation[] = [
  {
    id: "au_optin",
    stageId: "st_optin",
    connectionId: CONN,
    workflowExternalId: "wf_optin",
    name: "CP · Opt-in → nurture",
    status: "published",
    captureState: capture,
    nativeUrl: wfUrl("wf_optin"),
    trigger: { type: "form_submission", label: "Form submitted", asset: { assetKind: "ghl_form", assetValue: "form_optin", label: "Creator Protocol opt-in" }, conditionText: null, qualification: null },
    actions: [
      { id: "a1", type: "add_contact_tag", kind: "crm", label: "Add tag · cp-lead", destinationSoftware: "ghl", conversion: null },
      { id: "a2", type: "facebook_conversion_api", kind: "conversion", label: "Meta CAPI · Lead", destinationSoftware: "meta", conversion: { platform: "meta", eventName: "Lead" } },
      { id: "a3", type: "send_email", kind: "message", label: "Email · training link", destinationSoftware: "ghl", conversion: null },
      { id: "a4", type: "wait", kind: "wait", label: "Wait 1 day", destinationSoftware: null, conversion: null },
      { id: "a5", type: "send_sms", kind: "message", label: "SMS · did you watch?", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: false,
  },
  {
    id: "au_app_q",
    stageId: "st_app",
    connectionId: CONN,
    workflowExternalId: "wf_app_q",
    name: "CP · Application qualified",
    status: "published",
    captureState: capture,
    nativeUrl: wfUrl("wf_app_q"),
    trigger: { type: "survey_submission", label: "Survey submitted", asset: { assetKind: "ghl_form", assetValue: "survey_app", label: "Creator Protocol application" }, conditionText: "Outcome is qualified", qualification: "qualified" },
    actions: [
      { id: "b1", type: "pipeline_stage_change", kind: "pipeline", label: "Pipeline · Applied", destinationSoftware: "ghl", conversion: null },
      { id: "b2", type: "facebook_conversion_api", kind: "conversion", label: "Meta CAPI · SubmitApplication", destinationSoftware: "meta", conversion: { platform: "meta", eventName: "SubmitApplication" } },
      { id: "b3", type: "send_sms", kind: "message", label: "SMS · book your call", destinationSoftware: "ghl", conversion: null },
      { id: "b4", type: "assign_user", kind: "crm", label: "Assign · closer round-robin", destinationSoftware: "ghl", conversion: null },
      { id: "b5", type: "wait", kind: "wait", label: "Wait 2 hours", destinationSoftware: null, conversion: null },
      { id: "b6", type: "send_email", kind: "message", label: "Email · booking reminder", destinationSoftware: "ghl", conversion: null },
      { id: "b7", type: "wait", kind: "wait", label: "Wait 1 day", destinationSoftware: null, conversion: null },
      { id: "b8", type: "send_sms", kind: "message", label: "SMS · last chance", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: true,
  },
  {
    id: "au_app_dq",
    stageId: "st_app",
    connectionId: CONN,
    workflowExternalId: "wf_app_dq",
    name: "CP · Application disqualified",
    status: "draft",
    captureState: { ...capture, state: "changed" },
    nativeUrl: wfUrl("wf_app_dq"),
    trigger: { type: "survey_submission", label: "Survey submitted", asset: { assetKind: "ghl_form", assetValue: "survey_app", label: "Creator Protocol application" }, conditionText: "Outcome is disqualified", qualification: "disqualified" },
    actions: [
      { id: "c1", type: "add_contact_tag", kind: "crm", label: "Add tag · cp-dq", destinationSoftware: "ghl", conversion: null },
      { id: "c2", type: "send_email", kind: "message", label: "Email · free resources", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: false,
  },
  {
    id: "au_booked",
    stageId: "st_book",
    connectionId: CONN,
    workflowExternalId: "wf_booked",
    name: "CP · Call booked",
    status: "published",
    captureState: capture,
    nativeUrl: wfUrl("wf_booked"),
    trigger: { type: "appointment", label: "Appointment booked", asset: { assetKind: "ghl_calendar", assetValue: "cal_strategy", label: "Strategy call (30 min)" }, conditionText: "Status is confirmed", qualification: null },
    actions: [
      { id: "d1", type: "pipeline_stage_change", kind: "pipeline", label: "Pipeline · Booked", destinationSoftware: "ghl", conversion: null },
      { id: "d2", type: "facebook_conversion_api", kind: "conversion", label: "Meta CAPI · Schedule", destinationSoftware: "meta", conversion: { platform: "meta", eventName: "Schedule" } },
      { id: "d3", type: "send_sms", kind: "message", label: "SMS · confirmation", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: false,
  },
  {
    id: "au_noshow",
    stageId: "st_book",
    connectionId: CONN,
    workflowExternalId: "wf_noshow",
    name: "CP · No-show follow-up",
    status: "published",
    captureState: capture,
    nativeUrl: wfUrl("wf_noshow"),
    trigger: { type: "appointment", label: "Appointment no-show", asset: { assetKind: "ghl_calendar", assetValue: "cal_strategy", label: "Strategy call (30 min)" }, conditionText: "Status is no-show", qualification: null },
    actions: [
      { id: "e1", type: "send_sms", kind: "message", label: "SMS · rebook link", destinationSoftware: "ghl", conversion: null },
      { id: "e2", type: "add_contact_tag", kind: "crm", label: "Add tag · no-show", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: false,
  },
  {
    id: "au_utm",
    stageId: null,
    connectionId: CONN,
    workflowExternalId: "wf_utm",
    name: "CP · UTM attribution",
    status: "published",
    captureState: capture,
    nativeUrl: wfUrl("wf_utm"),
    trigger: { type: "contact_created", label: "Contact created", asset: null, conditionText: "utm_source is set", qualification: null },
    actions: [
      { id: "f1", type: "update_contact_field", kind: "crm", label: "Set field · first_touch_source", destinationSoftware: "ghl", conversion: null },
    ],
    actionsTruncated: false,
  },
];

export const creatorProtocolGraph: FunnelGraph = {
  schemaVersion: 2,
  funnel: {
    id: "fn_creator",
    name: "Creator Protocol",
    description: null,
    primaryConnectionId: CONN,
    accountLabel: "Creator Protocol HQ",
    reviewState: "needs_review",
    revision: 3,
    reviewedAt: null,
    updatedAt: AT,
    origin: "detected",
    detectionSource: "ghl_funnel",
    sourceUrl: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator",
    pageCount: 5,
    workflowCount: 6,
    coverage: {
      pages: { state: "captured" },
      screenshots: { state: "partial", reason: "1 of 5 pages captured" },
      automations: { state: "captured" },
    },
    lastCapturedAt: AT,
    lastDetectedAt: AT,
  },
  stages,
  relationships: [
    { id: "rel_1", fromStageId: "st_optin", toStageId: "st_app", kind: "next", label: null, conditionText: null, origin: "suggested", validity: "current" },
    { id: "rel_2", fromStageId: "st_app", toStageId: "st_book", kind: "next", label: null, conditionText: null, origin: "suggested", validity: "current" },
    { id: "rel_3", fromStageId: "st_book", toStageId: "st_confirm", kind: "next", label: null, conditionText: null, origin: "suggested", validity: "stale" },
    { id: "rel_4", fromStageId: "st_app", toStageId: "st_dq", kind: "branches_to", label: null, conditionText: "Disqualified", origin: "suggested", validity: "current" },
  ],
  attachments: [],
  workflowSummaries: automations.map((a) => ({ connectionId: a.connectionId, workflowExternalId: a.workflowExternalId, name: a.name, status: a.status, isActive: a.status === "published", captureState: a.captureState?.state ?? null })),
  evidence: [
    { id: "ev_1", stageId: null, method: "source_directory", coverage: "captured", reasonText: "Pages and order from the GHL funnel directory" },
    { id: "ev_2", stageId: null, method: "source_configuration", coverage: "captured", reasonText: "Embeds from page builder element ids" },
  ],
  coverage: {
    workflowStructure: { state: "captured" },
    pageNavigation: { state: "captured", reason: "From funnel step order" },
    pageContent: { state: "partial", reason: "1 of 5 screenshots captured" },
    surveyLogic: { state: "captured" },
    browserTracking: { state: "not-captured", reason: "Tracking code is not captured yet" },
    serverConversions: { state: "captured", reason: "Meta Conversions API actions in 3 workflows" },
    runtimeDelivery: { state: "not-captured", reason: "GoHighLevel does not expose run history" },
  },
  pages,
  automations,
  decisions: [
    {
      id: "dec_app",
      stageId: "st_app",
      assetExternalId: "survey_app",
      label: "Qualified?",
      branches: [
        { outcome: "qualified", toStageId: "st_book", conditionText: "No disqualifying answer", evidence: "configured" },
        { outcome: "disqualified", toStageId: "st_dq", conditionText: "Disqualified", evidence: "configured" },
      ],
    },
  ],
  conversions: [
    { id: "cv_1", stageId: "st_optin", automationId: "au_optin", actionId: "a2", platform: "meta", eventName: "Lead", evidence: "configured" },
    { id: "cv_2", stageId: "st_app", automationId: "au_app_q", actionId: "b2", platform: "meta", eventName: "SubmitApplication", evidence: "configured" },
    { id: "cv_3", stageId: "st_book", automationId: "au_booked", actionId: "d2", platform: "meta", eventName: "Schedule", evidence: "configured" },
  ],
  tracking: stages.map((s) => ({ stageId: s.id, pixel: { state: "not-captured", reason: "Tracking code is not captured yet" } })),
  adPlatform: { destination: "meta", evidence: "configured", reason: "Meta Conversions API actions and utm_source attribution" },
  unplaced: [{ automationId: "au_utm", reason: "Trigger has no form, survey or calendar" }],
  source: { kind: "ghl_funnel", externalId: "fn_creator", url: "https://app.gohighlevel.com/v2/location/loc_fixture/funnels-websites/funnels/fn_creator", urlVerified: false, updatedAt: AT },
  lastCapturedAt: AT,
};

/** Multiply the automations to push the canvas past LITE_AT nodes. */
export function bigCreatorProtocolGraph(copies = 12): FunnelGraph {
  const extra: FunnelAutomation[] = [];
  for (let i = 1; i <= copies; i++) {
    for (const a of automations) {
      if (!a.stageId) continue;
      extra.push({
        ...a,
        id: `${a.id}_${i}`,
        workflowExternalId: `${a.workflowExternalId}_${i}`,
        name: `${a.name} (${i})`,
        actions: a.actions.map((x) => ({ ...x, id: `${x.id}_${i}` })),
      });
    }
  }
  return {
    ...creatorProtocolGraph,
    funnel: { ...creatorProtocolGraph.funnel, workflowCount: automations.length + extra.length },
    automations: [...automations, ...extra],
  };
}
