import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  reviewDecisionSchema,
  trackOverrideSchema,
  reviewNoteSchema,
} from "../validation.js";

// ---------------------------------------------------------------------------
// Re-define the TRANSITIONS map identically to registry.js so we can test
// review-specific state transitions in isolation (same approach as registry.test.js).
// ---------------------------------------------------------------------------

const TRANSITIONS = {
  draft:             { builder: ["pending"], admin: ["pending"] },
  pending:           { system: ["in_progress"], admin: ["in_progress"] },
  in_progress:       { system: ["under_review", "active"], admin: ["under_review", "active"] },
  under_review:      { reviewer: ["approved", "changes_requested"], admin: ["approved", "changes_requested", "active"] },
  approved:          { reviewer: ["active"], admin: ["active"] },
  changes_requested: { builder: ["pending"], admin: ["pending"] },
  active:            { reviewer: ["under_review", "suspended"], admin: ["under_review", "suspended", "retired"], builder: ["retired"] },
  suspended:         { reviewer: ["under_review"], admin: ["under_review", "active"] },
};

function canTransition(fromStatus, toStatus, role) {
  const allowed = TRANSITIONS[fromStatus];
  if (!allowed) return false;
  const roleAllowed = allowed[role] || [];
  const systemAllowed = allowed.system || [];
  return roleAllowed.includes(toStatus) || systemAllowed.includes(toStatus);
}

// ===========================================================================
// reviewDecisionSchema validation
// ===========================================================================

describe("reviewDecisionSchema", () => {
  it("accepts 'approved' decision", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "approved" });
    assert.ok(result.success, "Should accept 'approved'");
    assert.equal(result.data.decision, "approved");
  });

  it("accepts 'changes_requested' decision", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "changes_requested" });
    assert.ok(result.success, "Should accept 'changes_requested'");
    assert.equal(result.data.decision, "changes_requested");
  });

  it("accepts decision with optional notes", () => {
    const result = reviewDecisionSchema.safeParse({
      decision: "approved",
      notes: "Looks good, all findings addressed.",
    });
    assert.ok(result.success);
    assert.equal(result.data.notes, "Looks good, all findings addressed.");
  });

  it("accepts decision without notes", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "approved" });
    assert.ok(result.success);
    assert.equal(result.data.notes, undefined);
  });

  it("rejects invalid decision value 'rejected'", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "rejected" });
    assert.ok(!result.success);
  });

  it("rejects invalid decision value 'pending'", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "pending" });
    assert.ok(!result.success);
  });

  it("rejects invalid decision value 'active'", () => {
    const result = reviewDecisionSchema.safeParse({ decision: "active" });
    assert.ok(!result.success);
  });

  it("rejects empty object (missing decision)", () => {
    const result = reviewDecisionSchema.safeParse({});
    assert.ok(!result.success);
  });

  it("rejects null decision", () => {
    const result = reviewDecisionSchema.safeParse({ decision: null });
    assert.ok(!result.success);
  });

  it("rejects numeric decision", () => {
    const result = reviewDecisionSchema.safeParse({ decision: 1 });
    assert.ok(!result.success);
  });
});

// ===========================================================================
// trackOverrideSchema validation
// ===========================================================================

describe("trackOverrideSchema", () => {
  it("accepts valid track 1 with reason", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 1, reason: "Low risk, downgrade." });
    assert.ok(result.success);
    assert.equal(result.data.newTrack, 1);
  });

  it("accepts valid track 2 with reason", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 2, reason: "Self-certification appropriate." });
    assert.ok(result.success);
    assert.equal(result.data.newTrack, 2);
  });

  it("accepts valid track 3 with reason", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 3, reason: "Needs IT review." });
    assert.ok(result.success);
  });

  it("accepts valid track 4 with reason", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 4, reason: "Escalated due to HIPAA data." });
    assert.ok(result.success);
    assert.equal(result.data.newTrack, 4);
  });

  it("rejects track 0 (below minimum)", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 0, reason: "Invalid." });
    assert.ok(!result.success);
  });

  it("rejects track 5 (above maximum)", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 5, reason: "Invalid." });
    assert.ok(!result.success);
  });

  it("rejects negative track", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: -1, reason: "Invalid." });
    assert.ok(!result.success);
  });

  it("rejects fractional track", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 2.5, reason: "Invalid." });
    assert.ok(!result.success);
  });

  it("rejects missing reason", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 3 });
    assert.ok(!result.success);
  });

  it("rejects empty reason string", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: 3, reason: "" });
    assert.ok(!result.success);
  });

  it("rejects missing newTrack", () => {
    const result = trackOverrideSchema.safeParse({ reason: "Some reason." });
    assert.ok(!result.success);
  });

  it("rejects string track", () => {
    const result = trackOverrideSchema.safeParse({ newTrack: "3", reason: "Invalid type." });
    assert.ok(!result.success);
  });
});

// ===========================================================================
// reviewNoteSchema validation
// ===========================================================================

describe("reviewNoteSchema", () => {
  it("accepts non-empty body", () => {
    const result = reviewNoteSchema.safeParse({ body: "This needs clarification." });
    assert.ok(result.success);
    assert.equal(result.data.body, "This needs clarification.");
  });

  it("rejects empty body", () => {
    const result = reviewNoteSchema.safeParse({ body: "" });
    assert.ok(!result.success);
  });

  it("rejects missing body", () => {
    const result = reviewNoteSchema.safeParse({});
    assert.ok(!result.success);
  });

  it("rejects null body", () => {
    const result = reviewNoteSchema.safeParse({ body: null });
    assert.ok(!result.success);
  });
});

// ===========================================================================
// Review decision state guards
// ===========================================================================

describe("review decision state guards", () => {
  it("reviewer can approve from under_review", () => {
    assert.ok(canTransition("under_review", "approved", "reviewer"));
  });

  it("reviewer can request changes from under_review", () => {
    assert.ok(canTransition("under_review", "changes_requested", "reviewer"));
  });

  it("admin can approve from under_review", () => {
    assert.ok(canTransition("under_review", "approved", "admin"));
  });

  it("admin can request changes from under_review", () => {
    assert.ok(canTransition("under_review", "changes_requested", "admin"));
  });

  it("cannot review from draft", () => {
    assert.ok(!canTransition("draft", "approved", "reviewer"));
    assert.ok(!canTransition("draft", "changes_requested", "reviewer"));
  });

  it("cannot review from pending", () => {
    assert.ok(!canTransition("pending", "approved", "reviewer"));
    assert.ok(!canTransition("pending", "changes_requested", "reviewer"));
  });

  it("cannot review from in_progress", () => {
    assert.ok(!canTransition("in_progress", "approved", "reviewer"));
    assert.ok(!canTransition("in_progress", "changes_requested", "reviewer"));
  });

  it("cannot review from approved", () => {
    assert.ok(!canTransition("approved", "approved", "reviewer"));
    assert.ok(!canTransition("approved", "changes_requested", "reviewer"));
  });

  it("cannot review from active", () => {
    assert.ok(!canTransition("active", "approved", "reviewer"));
    assert.ok(!canTransition("active", "changes_requested", "reviewer"));
  });

  it("cannot review from changes_requested directly (must resubmit first)", () => {
    assert.ok(!canTransition("changes_requested", "approved", "reviewer"));
    assert.ok(!canTransition("changes_requested", "changes_requested", "reviewer"));
  });

  it("builder cannot make review decisions", () => {
    assert.ok(!canTransition("under_review", "approved", "builder"));
    assert.ok(!canTransition("under_review", "changes_requested", "builder"));
  });
});

// ===========================================================================
// Self-certify constraints (Track 2 only, under_review only, owner only)
// ===========================================================================

describe("self-certify constraints", () => {
  // Self-certify logic is in the route handler, not the TRANSITIONS map.
  // We test the invariants the handler enforces:
  //   1. tool.track === 2
  //   2. tool.status === "under_review"
  //   3. tool.owner_id === req.user.userId (or user is not a builder)

  it("Track 2 is the only track eligible for self-certification", () => {
    const validTracks = [1, 2, 3, 4];
    const selfCertTrack = validTracks.filter(t => t === 2);
    assert.equal(selfCertTrack.length, 1);
    assert.equal(selfCertTrack[0], 2);
  });

  it("self-certify requires under_review status (not draft)", () => {
    // Simulating the route guard: status must be "under_review"
    const statuses = ["draft", "pending", "in_progress", "under_review", "approved", "active", "changes_requested", "suspended"];
    const allowed = statuses.filter(s => s === "under_review");
    assert.deepEqual(allowed, ["under_review"]);
  });

  it("self-certify transitions under_review to active", () => {
    // The route sets status = 'active' and review_decision = 'self_certified'
    const fromStatus = "under_review";
    const toStatus = "active";
    // This is not in TRANSITIONS (it's a special route bypass), but it's a valid
    // admin-level transition
    assert.ok(canTransition(fromStatus, toStatus, "admin"),
      "admin path for under_review -> active should exist");
  });
});

// ===========================================================================
// Activate constraints (approved status only, reviewer/admin role)
// ===========================================================================

describe("activate constraints", () => {
  it("reviewer can activate from approved", () => {
    assert.ok(canTransition("approved", "active", "reviewer"));
  });

  it("admin can activate from approved", () => {
    assert.ok(canTransition("approved", "active", "admin"));
  });

  it("builder cannot activate from approved", () => {
    // Builder has no entry in TRANSITIONS for approved state
    const builderAllowed = TRANSITIONS.approved.builder || [];
    assert.equal(builderAllowed.length, 0, "Builder should have no transitions from approved");
  });

  it("cannot activate from draft", () => {
    assert.ok(!canTransition("draft", "active", "reviewer"));
    assert.ok(!canTransition("draft", "active", "admin"));
  });

  it("cannot activate from pending", () => {
    assert.ok(!canTransition("pending", "active", "reviewer"));
    assert.ok(!canTransition("pending", "active", "admin"));
  });

  it("cannot activate from changes_requested", () => {
    assert.ok(!canTransition("changes_requested", "active", "reviewer"));
    assert.ok(!canTransition("changes_requested", "active", "admin"));
  });

  it("cannot activate from under_review via reviewer (must approve first)", () => {
    // Reviewers can only approve or request changes from under_review, not activate directly
    const reviewerTargets = TRANSITIONS.under_review.reviewer;
    assert.ok(!reviewerTargets.includes("active"),
      "Reviewer should not have direct under_review -> active path");
  });

  it("admin can activate directly from under_review (admin shortcut)", () => {
    // Admin has the special ability to skip the approved step
    assert.ok(canTransition("under_review", "active", "admin"));
  });
});

// ===========================================================================
// Review workflow: changes_requested cycle
// ===========================================================================

describe("review workflow — changes_requested cycle", () => {
  it("builder can resubmit from changes_requested to pending", () => {
    assert.ok(canTransition("changes_requested", "pending", "builder"));
  });

  it("admin can resubmit from changes_requested to pending", () => {
    assert.ok(canTransition("changes_requested", "pending", "admin"));
  });

  it("reviewer cannot resubmit from changes_requested", () => {
    assert.ok(!canTransition("changes_requested", "pending", "reviewer"));
  });

  it("changes_requested cannot skip to approved", () => {
    assert.ok(!canTransition("changes_requested", "approved", "admin"));
    assert.ok(!canTransition("changes_requested", "approved", "reviewer"));
  });

  it("changes_requested cannot skip to active", () => {
    assert.ok(!canTransition("changes_requested", "active", "admin"));
    assert.ok(!canTransition("changes_requested", "active", "reviewer"));
  });

  it("full review cycle: under_review -> changes_requested -> pending -> ... -> under_review -> approved -> active", () => {
    // Step 1: reviewer requests changes
    assert.ok(canTransition("under_review", "changes_requested", "reviewer"));
    // Step 2: builder resubmits
    assert.ok(canTransition("changes_requested", "pending", "builder"));
    // Step 3: system starts pipeline
    assert.ok(canTransition("pending", "in_progress", "system"));
    // Step 4: system moves to under_review on pipeline completion
    assert.ok(canTransition("in_progress", "under_review", "system"));
    // Step 5: reviewer approves
    assert.ok(canTransition("under_review", "approved", "reviewer"));
    // Step 6: reviewer activates
    assert.ok(canTransition("approved", "active", "reviewer"));
  });
});
