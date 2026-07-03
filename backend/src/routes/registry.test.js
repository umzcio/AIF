import { describe, it } from "node:test";
import assert from "node:assert";
import { TRANSITIONS, canTransition } from "./registry-transitions.js";

// TRANSITIONS/canTransition are re-exported from registry.js but sourced from
// registry-transitions.js (a zero-import module) — importing registry.js
// directly here would trigger auth/jwt.js's import-time process.exit(1) when
// JWT_SECRET is unset. Importing from registry-transitions.js exercises the
// exact same production code that registry.js re-exports.

// All valid statuses
const ALL_STATUSES = Object.keys(TRANSITIONS);
const ROLES = ["builder", "reviewer", "admin", "system"];

// ===========================================================================
// Valid transitions
// ===========================================================================

describe("state machine — valid transitions", () => {
  it("builder can transition draft → pending", () => {
    assert.ok(canTransition("draft", "pending", "builder"));
  });

  it("admin can transition draft → pending", () => {
    assert.ok(canTransition("draft", "pending", "admin"));
  });

  it("system can transition pending → in_progress", () => {
    assert.ok(canTransition("pending", "in_progress", "system"));
  });

  it("admin can transition pending → in_progress", () => {
    assert.ok(canTransition("pending", "in_progress", "admin"));
  });

  it("system can transition in_progress → under_review", () => {
    assert.ok(canTransition("in_progress", "under_review", "system"));
  });

  it("system can transition in_progress → active (Track 1 auto-activate)", () => {
    assert.ok(canTransition("in_progress", "active", "system"));
  });

  it("reviewer can transition under_review → approved", () => {
    assert.ok(canTransition("under_review", "approved", "reviewer"));
  });

  it("reviewer can transition under_review → changes_requested", () => {
    assert.ok(canTransition("under_review", "changes_requested", "reviewer"));
  });

  it("admin can transition under_review → active directly", () => {
    assert.ok(canTransition("under_review", "active", "admin"));
  });

  it("reviewer can transition approved → active", () => {
    assert.ok(canTransition("approved", "active", "reviewer"));
  });

  it("admin can transition approved → active", () => {
    assert.ok(canTransition("approved", "active", "admin"));
  });

  it("builder can transition changes_requested → pending (resubmit)", () => {
    assert.ok(canTransition("changes_requested", "pending", "builder"));
  });

  it("admin can transition changes_requested → pending", () => {
    assert.ok(canTransition("changes_requested", "pending", "admin"));
  });

  it("reviewer can transition active → under_review", () => {
    assert.ok(canTransition("active", "under_review", "reviewer"));
  });

  it("reviewer can transition active → suspended", () => {
    assert.ok(canTransition("active", "suspended", "reviewer"));
  });

  it("admin can transition active → retired", () => {
    assert.ok(canTransition("active", "retired", "admin"));
  });

  it("builder can transition active → retired", () => {
    assert.ok(canTransition("active", "retired", "builder"));
  });

  it("reviewer can transition suspended → under_review", () => {
    assert.ok(canTransition("suspended", "under_review", "reviewer"));
  });

  it("admin can transition suspended → active", () => {
    assert.ok(canTransition("suspended", "active", "admin"));
  });

  it("admin can transition suspended → under_review", () => {
    assert.ok(canTransition("suspended", "under_review", "admin"));
  });
});

// ===========================================================================
// Invalid transitions
// ===========================================================================

describe("state machine — invalid transitions", () => {
  it("cannot skip draft → active", () => {
    assert.ok(!canTransition("draft", "active", "admin"));
    assert.ok(!canTransition("draft", "active", "builder"));
    assert.ok(!canTransition("draft", "active", "reviewer"));
  });

  it("cannot skip draft → under_review", () => {
    assert.ok(!canTransition("draft", "under_review", "admin"));
  });

  it("cannot skip draft → approved", () => {
    assert.ok(!canTransition("draft", "approved", "admin"));
  });

  it("cannot go backwards: pending → draft", () => {
    assert.ok(!canTransition("pending", "draft", "admin"));
    assert.ok(!canTransition("pending", "draft", "builder"));
  });

  it("cannot go backwards: active → approved", () => {
    assert.ok(!canTransition("active", "approved", "admin"));
  });

  it("cannot go backwards: under_review → in_progress", () => {
    assert.ok(!canTransition("under_review", "in_progress", "admin"));
  });

  it("cannot transition from an unknown status", () => {
    assert.ok(!canTransition("nonexistent", "pending", "admin"));
  });

  it("cannot transition to an invalid status from a valid one", () => {
    assert.ok(!canTransition("draft", "nonexistent", "admin"));
  });
});

// ===========================================================================
// Role-based restrictions
// ===========================================================================

describe("state machine — role restrictions", () => {
  it("builder cannot approve (under_review → approved)", () => {
    assert.ok(!canTransition("under_review", "approved", "builder"));
  });

  it("builder cannot request changes (under_review → changes_requested)", () => {
    assert.ok(!canTransition("under_review", "changes_requested", "builder"));
  });

  it("builder cannot suspend (active → suspended)", () => {
    assert.ok(!canTransition("active", "suspended", "builder"));
  });

  it("reviewer cannot submit draft (draft → pending)", () => {
    assert.ok(!canTransition("draft", "pending", "reviewer"));
  });

  it("reviewer cannot resubmit (changes_requested → pending)", () => {
    assert.ok(!canTransition("changes_requested", "pending", "reviewer"));
  });

  it("reviewer cannot retire active tools", () => {
    assert.ok(!canTransition("active", "retired", "reviewer"));
  });

  it("builder cannot start pipeline (pending → in_progress) directly via role", () => {
    // "system" transitions (pending → in_progress) are performed by the
    // pipeline via direct SQL (queue.js), never through canTransition/the HTTP
    // route. canTransition() only honors the caller's actual role — a builder
    // has no "pending" entry in TRANSITIONS.pending, so this must be false.
    assert.ok(!canTransition("pending", "in_progress", "builder"));
  });

  it("builder cannot transition under_review → active", () => {
    assert.ok(!canTransition("under_review", "active", "builder"));
  });
});

// ===========================================================================
// Comprehensive: every explicit entry in TRANSITIONS is valid
// ===========================================================================

describe("state machine — exhaustive validation of TRANSITIONS map", () => {
  for (const [fromStatus, roleMap] of Object.entries(TRANSITIONS)) {
    for (const [role, toStatuses] of Object.entries(roleMap)) {
      for (const toStatus of toStatuses) {
        it(`${role} can: ${fromStatus} → ${toStatus}`, () => {
          assert.ok(
            canTransition(fromStatus, toStatus, role),
            `Expected canTransition("${fromStatus}", "${toStatus}", "${role}") to be true`,
          );
        });
      }
    }
  }
});

// ===========================================================================
// Every status that appears as a target also exists as a source (or is terminal)
// ===========================================================================

describe("state machine — structural integrity", () => {
  it("all target statuses exist as source statuses (no dangling transitions)", () => {
    const sourceStatuses = new Set(Object.keys(TRANSITIONS));
    // retired is a terminal state — it's okay if it has no outgoing transitions
    const terminalStatuses = new Set(["retired"]);

    for (const [fromStatus, roleMap] of Object.entries(TRANSITIONS)) {
      for (const [, toStatuses] of Object.entries(roleMap)) {
        for (const toStatus of toStatuses) {
          if (!terminalStatuses.has(toStatus)) {
            assert.ok(
              sourceStatuses.has(toStatus),
              `Target status "${toStatus}" (from "${fromStatus}") has no outgoing transitions and is not a known terminal state`,
            );
          }
        }
      }
    }
  });

  it("all known statuses have at least one outgoing transition or are terminal", () => {
    const terminalStatuses = new Set(["retired"]);
    for (const status of ALL_STATUSES) {
      if (terminalStatuses.has(status)) continue;
      const roleMap = TRANSITIONS[status];
      const totalTargets = Object.values(roleMap).flat().length;
      assert.ok(totalTargets > 0, `Status "${status}" has no outgoing transitions`);
    }
  });

  it("no role has an empty target array", () => {
    for (const [status, roleMap] of Object.entries(TRANSITIONS)) {
      for (const [role, targets] of Object.entries(roleMap)) {
        assert.ok(
          Array.isArray(targets) && targets.length > 0,
          `TRANSITIONS["${status}"]["${role}"] is empty or not an array`,
        );
      }
    }
  });
});

// ===========================================================================
// System transitions are NOT reachable via any HTTP-facing role
//
// Previously canTransition() fell through to TRANSITIONS[fromStatus].system
// for ANY role, so any authenticated builder/reviewer could drive
// pending→in_progress or in_progress→active (the latter bypassing review
// entirely) via PATCH /registry/:id/status. "system" transitions are
// performed by the pipeline via direct SQL (queue.js) and must never be
// reachable through canTransition()/the HTTP route. See registry-transitions.js.
// ===========================================================================

describe("state machine — system transitions are not grantable to HTTP roles", () => {
  it("builder cannot use system transitions (pending → in_progress)", () => {
    assert.ok(!canTransition("pending", "in_progress", "builder"));
  });

  it("reviewer cannot use system transitions (pending → in_progress)", () => {
    assert.ok(!canTransition("pending", "in_progress", "reviewer"));
  });

  it("builder cannot reach in_progress → active (would bypass review)", () => {
    assert.ok(!canTransition("in_progress", "active", "builder"));
  });

  it("builder cannot reach in_progress → under_review", () => {
    assert.ok(!canTransition("in_progress", "under_review", "builder"));
  });

  it("reviewer cannot reach in_progress → active (would bypass review)", () => {
    assert.ok(!canTransition("in_progress", "active", "reviewer"));
  });

  it("reviewer cannot reach in_progress → under_review", () => {
    assert.ok(!canTransition("in_progress", "under_review", "reviewer"));
  });

  it("admin retains explicit (non-system) access to in_progress → active", () => {
    // admin has its own explicit key in TRANSITIONS.in_progress, independent
    // of the (now HTTP-unreachable) system key — so admin access is unaffected.
    assert.ok(canTransition("in_progress", "active", "admin"));
    assert.ok(canTransition("in_progress", "under_review", "admin"));
  });

  it("admin retains explicit (non-system) access to pending → in_progress", () => {
    assert.ok(canTransition("pending", "in_progress", "admin"));
  });
});

// ===========================================================================
// PATCH /:id/status ownership gate (review-bypass fix)
//
// canTransition() is role-scoped only — it can't tell one builder's tool from
// another's. The route (registry.js PATCH /:id/status) therefore applies a
// second, explicit gate: builder-keyed transitions additionally require
// isOwner. Reviewer/admin transitions are role-wide by design (no ownership
// gate). This predicate models that in-handler check identically; there is
// no HTTP test harness in this suite, so it plus manual code reading is the
// coverage for the full route.
// ===========================================================================

function canPatchStatus(role, isOwner, fromStatus, toStatus) {
  if (!canTransition(fromStatus, toStatus, role)) return false;
  if (role === "builder" && !isOwner) return false;
  return true;
}

describe("PATCH /:id/status — ownership gate on builder-keyed transitions", () => {
  it("builder can move their OWN tool draft → pending", () => {
    assert.ok(canPatchStatus("builder", true, "draft", "pending"));
  });

  it("builder CANNOT move ANOTHER builder's tool draft → pending", () => {
    assert.ok(!canPatchStatus("builder", false, "draft", "pending"));
  });

  it("builder can move their OWN tool changes_requested → pending", () => {
    assert.ok(canPatchStatus("builder", true, "changes_requested", "pending"));
  });

  it("builder CANNOT move ANOTHER builder's tool changes_requested → pending", () => {
    assert.ok(!canPatchStatus("builder", false, "changes_requested", "pending"));
  });

  it("builder can retire their OWN active tool", () => {
    assert.ok(canPatchStatus("builder", true, "active", "retired"));
  });

  it("builder CANNOT retire ANOTHER builder's active tool", () => {
    assert.ok(!canPatchStatus("builder", false, "active", "retired"));
  });

  it("reviewer is not ownership-gated (role-wide by design)", () => {
    assert.ok(canPatchStatus("reviewer", false, "under_review", "approved"));
  });

  it("admin is not ownership-gated (role-wide by design)", () => {
    assert.ok(canPatchStatus("admin", false, "draft", "pending"));
  });

  it("no role/ownership combination reaches in_progress → active (system-only, HTTP-unreachable except admin's explicit key)", () => {
    assert.ok(!canPatchStatus("builder", true, "in_progress", "active"));
    assert.ok(!canPatchStatus("reviewer", false, "in_progress", "active"));
    assert.ok(canPatchStatus("admin", false, "in_progress", "active")); // admin's explicit key, not system fallthrough
  });
});

// ===========================================================================
// DELETE authorization gate (PRAC-03)
//
// canDeleteTool models only the in-handler status check added to the
// DELETE /:id handler; it is not exported from registry.js (module-scoped
// inline logic), so it is re-defined here identically. It assumes the
// caller already passed requireOwnerOrRole("admin") — i.e. `role` is the
// role of either the tool's owner or an admin — since that middleware
// gates route access (and sets req.tool) before this predicate ever runs.
// There is no HTTP test harness in this suite, so the full route
// (ownership/role gate in middleware.js + this status gate) is covered
// only by this predicate test plus manual code reading, not an
// end-to-end request test.
// ===========================================================================

const PRE_REVIEW_STATUSES = ["draft", "pending"];

function canDeleteTool(role, toolStatus) {
  if (role === "admin") return true;
  return PRE_REVIEW_STATUSES.includes(toolStatus);
}

describe("DELETE /:id — deletion authorization gate", () => {
  it("owner (builder) can delete a draft tool", () => {
    assert.ok(canDeleteTool("builder", "draft"));
  });

  it("owner (builder) can delete a pending tool", () => {
    assert.ok(canDeleteTool("builder", "pending"));
  });

  it("owner (builder) cannot delete an under_review tool", () => {
    assert.ok(!canDeleteTool("builder", "under_review"));
  });

  it("owner (builder) cannot delete an approved tool", () => {
    assert.ok(!canDeleteTool("builder", "approved"));
  });

  it("owner (builder) cannot delete an active tool", () => {
    assert.ok(!canDeleteTool("builder", "active"));
  });

  it("owner (builder) cannot delete a changes_requested tool", () => {
    assert.ok(!canDeleteTool("builder", "changes_requested"));
  });

  it("owner (builder) cannot delete a suspended tool", () => {
    assert.ok(!canDeleteTool("builder", "suspended"));
  });

  it("admin can delete a tool at any status", () => {
    for (const status of ALL_STATUSES) {
      assert.ok(canDeleteTool("admin", status), `admin should be able to delete a ${status} tool`);
    }
  });
});
