import type { WorkflowShapes } from "@/app/lib/api";

/*
 * `GET /workflows/ghl/pcf-119/shapes?scope=colocated` for COLLAPSE_SUMMARY —
 * captured verbatim from the shipped algorithm (`orrit-api/app/shapes`,
 * SHAPE_VERSION 5), never hand-written. An earlier hand-written version of
 * this file claimed two arms shared a shape that the signature refuses, which
 * is exactly the drift a captured fixture cannot have.
 *
 * Nine head tiles and five arms: 119 steps as 14 elements, which is the
 * measurement the whole feature exists to produce.
 *
 * To regenerate after an algorithm change, run `shapes_for()` over the
 * summary this fixture builds and paste the body back.
 */
export const COLLAPSE_SHAPES: WorkflowShapes = {
  "groups": [
    {
      "kind": "shape",
      "signature": {
        "nodeCount": 12,
        "depth": 9,
        "hash": "870a84c236a6406f"
      },
      "representative": "A1",
      "count": 4,
      "target": "google_sheets",
      "fanOut": "p10",
      "nestedIn": null,
      "colocated": true,
      "members": [
        {
          "id": "A1",
          "label": "No-Showed",
          "nodeIds": [
            "A1",
            "A2",
            "A3",
            "Ay1",
            "Ay2",
            "Ay3",
            "Ay4",
            "Ay5",
            "Ay6",
            "An1",
            "An2",
            "An3"
          ],
          "count": 12
        },
        {
          "id": "B1",
          "label": "Canceled",
          "nodeIds": [
            "B1",
            "B2",
            "B3",
            "By1",
            "By2",
            "By3",
            "By4",
            "By5",
            "By6",
            "Bn1",
            "Bn2",
            "Bn3"
          ],
          "count": 12
        },
        {
          "id": "C1",
          "label": "Reschedule",
          "nodeIds": [
            "C1",
            "C2",
            "C3",
            "Cy1",
            "Cy2",
            "Cy3",
            "Cy4",
            "Cy5",
            "Cy6",
            "Cn1",
            "Cn2",
            "Cn3"
          ],
          "count": 12
        },
        {
          "id": "D1",
          "label": "Payment = No",
          "nodeIds": [
            "D1",
            "D2",
            "D3",
            "Dy1",
            "Dy2",
            "Dy3",
            "Dy4",
            "Dy5",
            "Dy6",
            "Dn1",
            "Dn2",
            "Dn3"
          ],
          "count": 12
        }
      ]
    },
    {
      "kind": "shape",
      "signature": {
        "nodeCount": 10,
        "depth": 10,
        "hash": "91fe26e9f758de3b"
      },
      "representative": "e1",
      "count": 2,
      "target": "webhook",
      "fanOut": "p10",
      "nestedIn": null,
      "colocated": true,
      "members": [
        {
          "id": "e1",
          "label": "Passed to Setter",
          "nodeIds": [
            "e1",
            "e2",
            "e3",
            "e4",
            "e5",
            "e6",
            "e7",
            "e8",
            "e9",
            "e10"
          ],
          "count": 10
        },
        {
          "id": "f1",
          "label": "Fake or Duplicate",
          "nodeIds": [
            "f1",
            "f2",
            "f3",
            "f4",
            "f5",
            "f6",
            "f7",
            "f8",
            "f9",
            "f10"
          ],
          "count": 10
        }
      ]
    }
  ],
  "elements": [
    {
      "kind": "tile",
      "target": "survey_submitted",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p1"
      ]
    },
    {
      "kind": "tile",
      "target": "clear_fields",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p2"
      ]
    },
    {
      "kind": "tile",
      "target": "wait",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p3"
      ]
    },
    {
      "kind": "tile",
      "target": "update_contact_field",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p4"
      ]
    },
    {
      "kind": "tile",
      "target": "google_sheets",
      "count": 2,
      "depth": 0,
      "nodeIds": [
        "p5",
        "p6"
      ]
    },
    {
      "kind": "tile",
      "target": "update_contact_field",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p7"
      ]
    },
    {
      "kind": "tile",
      "target": "wait",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p8"
      ]
    },
    {
      "kind": "tile",
      "target": "add_contact_tag",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p9"
      ]
    },
    {
      "kind": "tile",
      "target": "if_else",
      "count": 1,
      "depth": 0,
      "nodeIds": [
        "p10"
      ]
    },
    {
      "kind": "fan",
      "target": "if_else",
      "count": 9,
      "depth": 0,
      "nodeIds": [
        "p10"
      ],
      "children": [
        {
          "kind": "arm",
          "target": "google_sheets",
          "count": 4,
          "depth": 0,
          "nodeIds": [
            "A1",
            "A2",
            "A3",
            "Ay1",
            "Ay2",
            "Ay3",
            "Ay4",
            "Ay5",
            "Ay6",
            "An1",
            "An2",
            "An3",
            "B1",
            "B2",
            "B3",
            "By1",
            "By2",
            "By3",
            "By4",
            "By5",
            "By6",
            "Bn1",
            "Bn2",
            "Bn3",
            "C1",
            "C2",
            "C3",
            "Cy1",
            "Cy2",
            "Cy3",
            "Cy4",
            "Cy5",
            "Cy6",
            "Cn1",
            "Cn2",
            "Cn3",
            "D1",
            "D2",
            "D3",
            "Dy1",
            "Dy2",
            "Dy3",
            "Dy4",
            "Dy5",
            "Dy6",
            "Dn1",
            "Dn2",
            "Dn3"
          ],
          "signature": {
            "nodeCount": 12,
            "depth": 9,
            "hash": "870a84c236a6406f"
          },
          "representative": "A1",
          "members": [
            {
              "id": "A1",
              "label": "No-Showed",
              "nodeIds": [
                "A1",
                "A2",
                "A3",
                "Ay1",
                "Ay2",
                "Ay3",
                "Ay4",
                "Ay5",
                "Ay6",
                "An1",
                "An2",
                "An3"
              ],
              "count": 12
            },
            {
              "id": "B1",
              "label": "Canceled",
              "nodeIds": [
                "B1",
                "B2",
                "B3",
                "By1",
                "By2",
                "By3",
                "By4",
                "By5",
                "By6",
                "Bn1",
                "Bn2",
                "Bn3"
              ],
              "count": 12
            },
            {
              "id": "C1",
              "label": "Reschedule",
              "nodeIds": [
                "C1",
                "C2",
                "C3",
                "Cy1",
                "Cy2",
                "Cy3",
                "Cy4",
                "Cy5",
                "Cy6",
                "Cn1",
                "Cn2",
                "Cn3"
              ],
              "count": 12
            },
            {
              "id": "D1",
              "label": "Payment = No",
              "nodeIds": [
                "D1",
                "D2",
                "D3",
                "Dy1",
                "Dy2",
                "Dy3",
                "Dy4",
                "Dy5",
                "Dy6",
                "Dn1",
                "Dn2",
                "Dn3"
              ],
              "count": 12
            }
          ],
          "hidden": [
            "B1",
            "B2",
            "B3",
            "By1",
            "By2",
            "By3",
            "By4",
            "By5",
            "By6",
            "Bn1",
            "Bn2",
            "Bn3",
            "C1",
            "C2",
            "C3",
            "Cy1",
            "Cy2",
            "Cy3",
            "Cy4",
            "Cy5",
            "Cy6",
            "Cn1",
            "Cn2",
            "Cn3",
            "D1",
            "D2",
            "D3",
            "Dy1",
            "Dy2",
            "Dy3",
            "Dy4",
            "Dy5",
            "Dy6",
            "Dn1",
            "Dn2",
            "Dn3"
          ],
          "children": [
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "A1"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "A2"
              ]
            },
            {
              "kind": "tile",
              "target": "if_else",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "A3"
              ]
            },
            {
              "kind": "fan",
              "target": "if_else",
              "count": 2,
              "depth": 1,
              "nodeIds": [
                "A3"
              ],
              "children": [
                {
                  "kind": "arm",
                  "target": "slack_message",
                  "count": 1,
                  "depth": 1,
                  "nodeIds": [
                    "Ay1",
                    "Ay2",
                    "Ay3",
                    "Ay4",
                    "Ay5",
                    "Ay6"
                  ],
                  "signature": {
                    "nodeCount": 6,
                    "depth": 6,
                    "hash": "2018628a2779e42e"
                  },
                  "representative": "Ay1",
                  "members": [
                    {
                      "id": "Ay1",
                      "label": "yes",
                      "nodeIds": [
                        "Ay1",
                        "Ay2",
                        "Ay3",
                        "Ay4",
                        "Ay5",
                        "Ay6"
                      ],
                      "count": 6
                    }
                  ],
                  "hidden": [],
                  "children": [
                    {
                      "kind": "tile",
                      "target": "slack_message",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay1"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "add_notes",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay2"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "update_contact_field",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay3"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "wait",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay4"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "slack_message",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay5"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "add_notes",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "Ay6"
                      ]
                    }
                  ]
                },
                {
                  "kind": "arm",
                  "target": "slack_message",
                  "count": 1,
                  "depth": 1,
                  "nodeIds": [
                    "An1",
                    "An2",
                    "An3"
                  ],
                  "signature": {
                    "nodeCount": 3,
                    "depth": 3,
                    "hash": "03ee5e7959fb0031"
                  },
                  "representative": "An1",
                  "members": [
                    {
                      "id": "An1",
                      "label": "no",
                      "nodeIds": [
                        "An1",
                        "An2",
                        "An3"
                      ],
                      "count": 3
                    }
                  ],
                  "hidden": [],
                  "children": [
                    {
                      "kind": "tile",
                      "target": "slack_message",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "An1"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "add_notes",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "An2"
                      ]
                    },
                    {
                      "kind": "tile",
                      "target": "update_contact_field",
                      "count": 1,
                      "depth": 2,
                      "nodeIds": [
                        "An3"
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          "kind": "arm",
          "target": "webhook",
          "count": 2,
          "depth": 0,
          "nodeIds": [
            "e1",
            "e2",
            "e3",
            "e4",
            "e5",
            "e6",
            "e7",
            "e8",
            "e9",
            "e10",
            "f1",
            "f2",
            "f3",
            "f4",
            "f5",
            "f6",
            "f7",
            "f8",
            "f9",
            "f10"
          ],
          "signature": {
            "nodeCount": 10,
            "depth": 10,
            "hash": "91fe26e9f758de3b"
          },
          "representative": "e1",
          "members": [
            {
              "id": "e1",
              "label": "Passed to Setter",
              "nodeIds": [
                "e1",
                "e2",
                "e3",
                "e4",
                "e5",
                "e6",
                "e7",
                "e8",
                "e9",
                "e10"
              ],
              "count": 10
            },
            {
              "id": "f1",
              "label": "Fake or Duplicate",
              "nodeIds": [
                "f1",
                "f2",
                "f3",
                "f4",
                "f5",
                "f6",
                "f7",
                "f8",
                "f9",
                "f10"
              ],
              "count": 10
            }
          ],
          "hidden": [
            "f1",
            "f2",
            "f3",
            "f4",
            "f5",
            "f6",
            "f7",
            "f8",
            "f9",
            "f10"
          ],
          "children": [
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e1"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e2"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e3"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e4"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e5"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e6"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e7"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e8"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e9"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "e10"
              ]
            }
          ]
        },
        {
          "kind": "arm",
          "target": "slack_message",
          "count": 1,
          "depth": 0,
          "nodeIds": [
            "g1",
            "g2",
            "g3",
            "g4",
            "g5",
            "g6",
            "g7",
            "g8",
            "g9",
            "g10",
            "g11",
            "g12",
            "g13",
            "g14",
            "g15",
            "g16",
            "g17",
            "g18",
            "g19",
            "g20",
            "g21",
            "g22",
            "g23",
            "g24",
            "g25",
            "g26",
            "g27",
            "g28",
            "g29",
            "g30",
            "g31",
            "g32",
            "g33",
            "g34",
            "g35",
            "g36"
          ],
          "signature": {
            "nodeCount": 36,
            "depth": 36,
            "hash": "69668f27db298faf"
          },
          "representative": "g1",
          "members": [
            {
              "id": "g1",
              "label": "Payment = Yes",
              "nodeIds": [
                "g1",
                "g2",
                "g3",
                "g4",
                "g5",
                "g6",
                "g7",
                "g8",
                "g9",
                "g10",
                "g11",
                "g12",
                "g13",
                "g14",
                "g15",
                "g16",
                "g17",
                "g18",
                "g19",
                "g20",
                "g21",
                "g22",
                "g23",
                "g24",
                "g25",
                "g26",
                "g27",
                "g28",
                "g29",
                "g30",
                "g31",
                "g32",
                "g33",
                "g34",
                "g35",
                "g36"
              ],
              "count": 36
            }
          ],
          "hidden": [],
          "children": [
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g1"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g2"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g3"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g4"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g5"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g6"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g7"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g8"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g9"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g10"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g11"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g12"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g13"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g14"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g15"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g16"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g17"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g18"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g19"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g20"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g21"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g22"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g23"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g24"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g25"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g26"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g27"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g28"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g29"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g30"
              ]
            },
            {
              "kind": "tile",
              "target": "slack_message",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g31"
              ]
            },
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g32"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g33"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g34"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g35"
              ]
            },
            {
              "kind": "tile",
              "target": "webhook",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "g36"
              ]
            }
          ]
        },
        {
          "kind": "arm",
          "target": "add_notes",
          "count": 1,
          "depth": 0,
          "nodeIds": [
            "h1",
            "h2",
            "h3",
            "h4"
          ],
          "signature": {
            "nodeCount": 4,
            "depth": 4,
            "hash": "dc4c91e893cb5935"
          },
          "representative": "h1",
          "members": [
            {
              "id": "h1",
              "label": "Paste-Values Only Placeholder",
              "nodeIds": [
                "h1",
                "h2",
                "h3",
                "h4"
              ],
              "count": 4
            }
          ],
          "hidden": [],
          "children": [
            {
              "kind": "tile",
              "target": "add_notes",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "h1"
              ]
            },
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "h2"
              ]
            },
            {
              "kind": "tile",
              "target": "wait",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "h3"
              ]
            },
            {
              "kind": "tile",
              "target": "google_sheets",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "h4"
              ]
            }
          ]
        },
        {
          "kind": "arm",
          "target": "update_contact_field",
          "count": 1,
          "depth": 0,
          "nodeIds": [
            "i1"
          ],
          "signature": {
            "nodeCount": 1,
            "depth": 1,
            "hash": "437e6d455255487e"
          },
          "representative": "i1",
          "members": [
            {
              "id": "i1",
              "label": "None",
              "nodeIds": [
                "i1"
              ],
              "count": 1
            }
          ],
          "hidden": [],
          "children": [
            {
              "kind": "tile",
              "target": "update_contact_field",
              "count": 1,
              "depth": 1,
              "nodeIds": [
                "i1"
              ]
            }
          ]
        }
      ]
    }
  ],
  "nodeCount": 119,
  "fanOutCount": 5,
  "hiddenCount": 49,
  "distinctShapes": 14,
  "expanded": 74,
  "packedOnly": 118,
  "packAt": 3,
  "shapeFloor": 3,
  "shapeVersion": 5,
  "scope": "colocated"
}

