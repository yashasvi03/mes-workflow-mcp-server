# MES Workflow Builder - Implementation Plan v3.0+

**Version:** 3.0+ (Major architectural evolution)
**Date:** 2025-10-27
**Status:** Planning Phase - DO NOT IMPLEMENT YET

---

## Overview

This document outlines a two-part evolution of the MES Workflow MCP Server:

1. **Part A (v3.0)**: Extend to support **Granulation** stage family (56 tasks, 34 decisions)
2. **Part B (v3.1+)**: Add **LLM-augmented workflow builder** for client-specific customizations

Both parts work together to create a system that is:
- ✅ **Structured** with base library of validated tasks/decisions
- ✅ **Flexible** with LLM-powered customizations
- ✅ **Auditable** with full traceability and version control
- ✅ **Scalable** with promotion pathway for validated customs

---

# PART A: Granulation Stage Extension (v3.0)

## Objective

Extend the MES Workflow MCP Server to support the **Granulation** stage family, adding 56 tasks and 34 decisions alongside the existing Dispensing workflow.

---

## Phase 1: Data File Extensions

### 1.1 tasks.json Extension

**File:** `data/tasks.json`
**Current:** 134 Dispensing tasks (6 macros + micro tasks)
**Adding:** 56 Granulation tasks (8 macros + 48 micros)

#### Task Structure Mapping
```
Source Column          → JSON Field
─────────────────────────────────────
ID                     → id
ParentID               → parent_id
Name                   → name
Type                   → type
Stage                  → stage
Actor                  → actor
Integration            → integration
Inputs                 → inputs
Outputs                → outputs
Predecessors (CSV)     → predecessors (array)
Edge Type              → edge_type
Guard/Condition        → guard_condition
Decision ID            → decision_id
Outcome                → decision_outcome
Loop Key               → loop_key
Loop Exit Condition    → loop_exit_condition
Logs/Records           → logs
Controls               → controls
```

#### Data Transformation Notes
- **Predecessors**: Split comma-separated string into array
- **Null handling**: Empty cells → `null` or `""` based on field type
- **Array fields**: Ensure `predecessors` is always an array (empty array if none)

---

### 1.2 decisions.json Extension

**File:** `data/decisions.json`
**Current:** 48 Dispensing decisions
**Adding:** 34 Granulation decisions

#### Decision Structure Mapping
```
Source Column          → JSON Field
─────────────────────────────────────
Decision ID            → id
Category               → category
Question               → question
Outcomes (pipe-sep)    → outcomes (array)
Stage                  → stage
Affects                → affects
Notes                  → notes
```

#### Data Transformation Notes
- **Outcomes**: Split `"approved | rework_required"` by `|`, trim whitespace
- **Categories**: "Runtime" or "Practice"
- **Stage mapping**: Map full stage names to short names if needed

---

## Phase 2: index.ts Modifications

### 2.1 Stage Enum Updates

#### Location: `generateMermaidDiagram()` - Line 249-255

**Current:**
```typescript
const stageOrder = [
  'Pre-Dispensing',
  'Material Allocation',
  'Weighing & Dispensing',
  'Labeling & Documentation',
  'Post-Dispensing',
];
```

**Updated:**
```typescript
const stageOrder = [
  // Dispensing stages
  'Pre-Dispensing',
  'Material Allocation',
  'Weighing & Dispensing',
  'Labeling & Documentation',
  'Post-Dispensing',
  // Granulation stages
  'Pre-Granulation',
  'Material Transfer & Verification',
  'Binder Preparation',
  'Granulation',
  'Post-Granulation',
  'Closeout',
];
```

**Question:** Clarify 8 stages vs 6 unique stage names from data.

---

### 2.2 Loop Detection Logic

#### Location: `findLoopStart()` - Lines 207-211

**Current:**
```typescript
function findLoopStart(loopEndId: string): string {
  if (loopEndId === 'DISP-L-002') return 'DISP-L-001';
  if (loopEndId === 'DISP-SL-006') return 'DISP-SL-001';
  return loopEndId;
}
```

**Update Required:**
```typescript
function findLoopStart(loopEndId: string): string {
  // Dispensing loops
  if (loopEndId === 'DISP-L-002') return 'DISP-L-001';
  if (loopEndId === 'DISP-SL-006') return 'DISP-SL-001';

  // Granulation loops - AWAITING USER INPUT
  // if (loopEndId === 'GRAN-L-XXX') return 'GRAN-L-YYY';

  return loopEndId;
}
```

**TODO:** Get Granulation loop pairs from user.

---

### 2.3 Tool Description Updates

#### Location 1: `get_decisions` tool - Line 762
Update description:
```typescript
stage: {
  type: 'string',
  description: 'Stage name: "Pre-Dispensing", "Material Allocation", "Weighing & Dispensing", "Labeling & Documentation", "Post-Dispensing", "Pre-Granulation", "Material Transfer & Verification", "Binder Preparation", "Granulation", "Post-Granulation", "Closeout", or "All" for all stages',
}
```

#### Location 2: `generate_workflow` tool - Line 845
Same update as above.

---

### 2.4 Beautiful Diagram Generator Extension

#### Current Structure
- **Function:** `generateBeautifulMermaidDiagram()` (lines 393-736)
- **Status:** Hardcoded for Dispensing workflow only
- **Challenge:** Need to extend for Granulation without breaking existing

#### Proposed Architecture

```typescript
// 1. Rename existing function
function generateBeautifulDispensingDiagram(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision },
  clientName: string
): string {
  // Current implementation (lines 393-736)
}

// 2. Create new Granulation function
function generateBeautifulGranulationDiagram(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision },
  clientName: string
): string {
  let mermaid = `%%{init: {'theme':'base', ...}}%%\n`;
  mermaid += `graph TB\n`;
  // Add styling classes
  // Add START node
  // Add 8 Granulation macro stages with routing logic
  // Add decision diamonds for key decisions
  // Add loops
  // Add COMPLETE node
  return mermaid;
}

// 3. Create router function
function generateBeautifulMermaidDiagram(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision },
  clientName: string
): string {
  const stages = [...new Set(filteredTasks.map(t => t.stage))];

  // Detect which workflow family
  if (stages.some(s => s.includes('Dispensing'))) {
    return generateBeautifulDispensingDiagram(filteredTasks, allTasks, decisions, clientName);
  } else if (stages.some(s => s.includes('Granulation')) ||
             stages.some(s => s.includes('Binder')) ||
             stages.some(s => s.includes('Closeout'))) {
    return generateBeautifulGranulationDiagram(filteredTasks, allTasks, decisions, clientName);
  } else {
    // Fallback to generic generator
    return generateMermaidDiagram(filteredTasks, allTasks, decisions);
  }
}
```

#### Granulation Beautiful Diagram Design

**Visual Flow:**
```
🏁 START GRANULATION
   ↓
📋 M1: Pre-Granulation (Room & Equipment Readiness)
   ├─→ Line clearance
   ├─→ Environmental checks
   └─→ Equipment status validation
   ↓
📦 M2: Material Transfer & Verification
   ├─→ Staging
   ├─→ Label verification
   └─→ Weighing balance checks
   ↓
🔀 DECISION: Granulation Method? (GRAN-D-METHOD-001)
   ├─→ WET ────→ 🧪 M3: Binder Preparation
   │              ├─→ Sift/Mill
   │              ├─→ Prepare solution
   │              └─→ QA verify
   │              ↓
   │            ⚗️ M4: Wet Granulation
   │              ├─→ Charge powders
   │              ├─→ Add binder
   │              └─→ Mix to endpoint
   │
   ├─→ DRY ────→ ⚗️ M4: Dry Granulation
   │              ├─→ Set compaction params
   │              └─→ Mill ribbons
   │
   └─→ MELT ───→ ⚗️ M4: Melt Granulation
                  ├─→ Heat binder
                  └─→ Mix
   ↓
📊 M5: Process Parameters & Data Capture
   ├─→ Configure data capture mode
   ├─→ Acquire sensor data
   └─→ Record in-process QC
   ↓
⚠️ M6: Variability, Exceptions & Deviations
   ├─→ Monitor tolerances
   ├─→ Handle deviations
   └─→ Fallback modes
   ↓
📤 M7: Post-Granulation & Transfer
   ├─→ Container labeling
   ├─→ Yield reconciliation
   ├─→ Sampling
   └─→ Route to next operation
   ↓
✅ M8: Systems Integration & Closeout
   ├─→ ERP posting
   ├─→ LIMS integration
   └─→ Archive records
   ↓
🎉 GRANULATION COMPLETE
```

**Key Decision Branches to Visualize:**
1. **GRAN-D-METHOD-001**: Wet/Dry/Melt routing (tri-path split)
2. **GRAN-D-WEIGH-METHOD-001**: Auto/Manual weighing
3. **GRAN-D-BIND-MILL-001**: Skip/perform binder milling
4. **GRAN-D-ENDPOINT-001**: Endpoint reached loops
5. **GRAN-D-NEXT-OP-001**: Route to Dryer/Mill/Blend

**Style Classes:**
- Macros: Blue with bold text
- Micros: Yellow/cream
- Loops: Purple with thick border
- Exceptions: Red dashed boxes
- Decisions: Orange diamonds
- Convergence: Green

---

### 2.5 Version Number Update

#### Locations:
1. Line 742: Server initialization
2. Line 1572: Console log message

**Change:**
```typescript
// From
version: '2.3.0'

// To
version: '3.0.0'
```

**Rationale:** Major version bump for new stage family addition.

---

## Phase 3: Testing & Validation (v3.0)

### 3.1 Data Integrity Checks

**Pre-implementation validation:**
- [ ] All Granulation task `predecessors` reference valid task IDs
- [ ] All Granulation task `decision_id` values exist in decisions.json
- [ ] All task `decision_outcome` values match decision `outcomes` options
- [ ] No duplicate task IDs between Dispensing and Granulation
- [ ] No duplicate decision IDs

### 3.2 Workflow Isolation

**Decision:** Granulation is **standalone** (no cross-stage links to Dispensing)
- Granulation tasks do NOT reference Dispensing task IDs in predecessors
- Can generate "Dispensing" workflow OR "Granulation" workflow independently
- Future enhancement: Support "All" stages with proper inter-stage linking

### 3.3 Test Scenarios

1. **Test Client 1:** Configure only Dispensing decisions → Generate Dispensing workflow
2. **Test Client 2:** Configure only Granulation decisions → Generate Granulation workflow
3. **Test Client 3:** Configure both → Generate each separately
4. **Validation:** Run `validate_workflow` tool on generated workflows

---

# PART B: LLM-Augmented Architecture (v3.1+)

## Objective

Enable **client-specific workflow customizations** using LLM intelligence while maintaining the structured base library as the foundation.

---

## User Requirements Summary

Based on user questionnaire responses:
- ✅ **Primary Use Case**: Handle client-specific variations (e.g., nitrogen purging for HPAPI)
- ✅ **Control Level**: Medium - Auto-approve minor additions, review major changes
- ✅ **Task Scope**: Hybrid - Client-specific by default, promotable to base library
- ✅ **Versioning**: Lock client workflows after generation (immutable)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                    Base Library (Source of Truth)            │
│  • tasks.json (Dispensing, Granulation, etc.)                │
│  • decisions.json (Practice & Runtime)                       │
└────────────────────────┬─────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│              Client Configuration Layer                      │
│  • client_decisions.json (existing)                          │
│  • client_custom.json (NEW - custom tasks/decisions)        │
│  • client_workflows.json (existing - now versioned)          │
└────────────────────────┬─────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│                  Generation Engine                           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Base Workflow Generation (Deterministic)         │   │
│  │    • Use base library + client decisions            │   │
│  │    • Existing logic (fast, predictable)             │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      ↓                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. LLM Augmentation (Conditional)                   │   │
│  │    • Analyze client context                         │   │
│  │    • Suggest custom tasks                           │   │
│  │    • Classify as "minor" or "major"                 │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      ↓                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. Auto-Approval / Review Gate                      │   │
│  │    • Minor: Auto-add (e.g., "add photo step")      │   │
│  │    • Major: Show diff, require approval             │   │
│  └───────────────────┬─────────────────────────────────┘   │
│                      ↓                                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 4. Finalize & Lock Workflow                         │   │
│  │    • Generate Mermaid diagram                       │   │
│  │    • Version & timestamp                            │   │
│  │    • Store with metadata                            │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## New Data Structures

### 1. client_custom.json (NEW)

```json
{
  "TechPharma": {
    "custom_tasks": [
      {
        "id": "DISP-CUSTOM-001",
        "name": "Perform nitrogen purging for HPAPI",
        "type": "Micro",
        "stage": "Weighing & Dispensing",
        "parent_id": "DISP-M-003",
        "insert_after": "DISP-024",
        "actor": "Operator",
        "integration": "MES",
        "metadata": {
          "source": "llm_suggested",
          "reason": "Client handles HPAPI requiring inert atmosphere",
          "severity": "minor",
          "auto_approved": true,
          "created_by": "system",
          "created_date": "2025-10-27T10:30:00Z",
          "approved_by": null,
          "approved_date": null,
          "promotion_candidate": false
        },
        "inputs": "Nitrogen supply; Purge SOP",
        "outputs": "Purge completion log",
        "predecessors": ["DISP-024"],
        "edge_type": "control",
        "logs": "Purge Log",
        "controls": "Timer & flow meter verification"
      }
    ],
    "custom_decisions": [
      {
        "id": "TECH-Q-01",
        "category": "Practice",
        "question": "Nitrogen purging required for HPAPIs?",
        "outcomes": ["Yes", "No"],
        "stage": "Weighing & Dispensing",
        "affects": "Adds purging step after tare",
        "notes": "Client-specific for HPAPI handling",
        "metadata": {
          "source": "client_requested",
          "severity": "major",
          "auto_approved": false,
          "approved_by": "user@techpharma.com",
          "approved_date": "2025-10-27T11:00:00Z"
        }
      }
    ]
  }
}
```

### 2. Enhanced client_workflows.json

```json
{
  "TechPharma": {
    "versions": [
      {
        "version": 1,
        "last_generated": "2025-10-15T10:00:00Z",
        "stage": "All",
        "base_library_version": "3.0.0",
        "custom_tasks_count": 2,
        "custom_decisions_count": 1,
        "mermaid_code": "...",
        "metadata": {
          "task_count": 138,
          "decision_count": 49,
          "macro_count": 6,
          "loop_count": 4,
          "augmentation_summary": {
            "added_tasks": ["DISP-CUSTOM-001", "DISP-CUSTOM-002"],
            "added_decisions": ["TECH-Q-01"],
            "llm_reasoning": "Added nitrogen purging and additional photo documentation for HPAPI compliance",
            "auto_approved_count": 1,
            "user_approved_count": 1
          }
        },
        "locked": true,
        "exported": true,
        "export_path": "exports/TechPharma/workflow_v1.png"
      }
    ],
    "current_version": 1
  }
}
```

---

## New MCP Tools (v3.1+)

### Tool 1: `add_custom_task`

Add a client-specific custom task that extends the base workflow library.

```typescript
{
  name: 'add_custom_task',
  description: 'Add a client-specific custom task that extends the base workflow library.',
  inputSchema: {
    client_name: 'string',
    task: {
      id: 'string', // e.g., "DISP-CUSTOM-001"
      name: 'string',
      type: '"Micro" | "Macro"',
      stage: 'string',
      parent_id: 'string',
      insert_after: 'string', // Task ID to insert after
      actor: 'string',
      // ... other task fields
    },
    source: '"client_requested" | "llm_suggested"',
    rationale: 'string' // Why is this task needed?
  }
}
```

### Tool 2: `analyze_client_context`

Use LLM to analyze client context and suggest custom tasks/decisions.

```typescript
{
  name: 'analyze_client_context',
  description: 'Use LLM to analyze client context and suggest custom tasks/decisions. Returns suggestions classified by severity.',
  inputSchema: {
    client_name: 'string',
    stage: 'string',
    context: 'string', // e.g., "HPAPI manufacturing, EU GMP, nitrogen blanketing required"
    existing_decisions: 'object'
  }
}

// Returns:
{
  suggestions: [
    {
      type: 'task',
      id: 'DISP-CUSTOM-001',
      name: 'Perform nitrogen purging',
      severity: 'minor', // Auto-approvable
      reasoning: 'HPAPI context requires inert atmosphere per EU GMP Annex 15',
      insert_after: 'DISP-024',
      confidence: 0.92
    },
    {
      type: 'decision',
      id: 'TECH-Q-01',
      question: 'Nitrogen purging required?',
      severity: 'major', // Requires approval
      reasoning: 'Fundamental process change affecting material safety',
      confidence: 0.88
    }
  ]
}
```

### Tool 3: `generate_augmented_workflow`

Generate workflow with LLM-suggested customizations.

```typescript
{
  name: 'generate_augmented_workflow',
  description: 'Generate workflow with LLM-suggested customizations. Minor changes auto-approved, major changes presented for review.',
  inputSchema: {
    client_name: 'string',
    stage: 'string',
    context: 'string', // Optional client context for LLM analysis
    mode: '"strict" | "augmented"', // strict = base only, augmented = with LLM
    auto_approve_minor: 'boolean' // Default true
  }
}
```

### Tool 4: `promote_custom_task`

Promote a validated custom task to the base library.

```typescript
{
  name: 'promote_custom_task',
  description: 'Promote a validated custom task to the base library for use by all clients.',
  inputSchema: {
    client_name: 'string',
    custom_task_id: 'string', // e.g., "DISP-CUSTOM-001"
    new_base_id: 'string', // e.g., "DISP-056" (next available)
    rationale: 'string'
  }
}
```

### Tool 5: `list_custom_tasks`

List all custom tasks/decisions for a client.

```typescript
{
  name: 'list_custom_tasks',
  description: 'List all custom tasks/decisions for a client, with promotion candidates highlighted.',
  inputSchema: {
    client_name: 'string',
    show_promotion_candidates: 'boolean'
  }
}
```

---

## LLM Classification Logic

### Minor vs Major Determination

```typescript
function classifySuggestion(suggestion: Suggestion): 'minor' | 'major' {
  // AUTO-APPROVE (minor) if:
  // - Adds documentation step (photo, attachment, comment)
  // - Adds logging step (no process change)
  // - Adds verification step (scan, check) without new decision
  // - Inserts after leaf node (no downstream impact)

  // REQUIRE APPROVAL (major) if:
  // - Adds new decision point (branching logic)
  // - Modifies critical path (QA gates, release steps)
  // - Adds integration point (ERP, LIMS)
  // - Changes loop structure
  // - Affects regulatory compliance (GMP, 21 CFR Part 11)

  const minorKeywords = ['photo', 'attach', 'log', 'verify scan', 'comment'];
  const majorKeywords = ['decision', 'approve', 'integrate', 'post to', 'release'];

  if (majorKeywords.some(kw => suggestion.name.toLowerCase().includes(kw))) {
    return 'major';
  }

  if (minorKeywords.some(kw => suggestion.name.toLowerCase().includes(kw))) {
    return 'minor';
  }

  // Default to major for safety
  return 'major';
}
```

---

## Example User Flow

```typescript
// 1. User configures client with context
save_client_decision({
  client_name: "TechPharma",
  decision_id: "Q-HSE-01",
  selected_outcome: "HPAPI"
})

// 2. User requests augmented workflow
generate_augmented_workflow({
  client_name: "TechPharma",
  stage: "All",
  context: "HPAPI manufacturing, nitrogen blanketing required, EU GMP Annex 15 compliance",
  mode: "augmented",
  auto_approve_minor: true
})

// Response:
// ✅ Base workflow generated (136 tasks, 48 decisions)
// 🤖 LLM Analysis: Found 3 suggestions
//    ✅ AUTO-APPROVED (minor): Add photo attachment after nitrogen purge
//    ✅ AUTO-APPROVED (minor): Add secondary verification log
//    ⚠️  REVIEW REQUIRED (major): Add decision point "Nitrogen purity check passed?"
//
// Please review major change:
//   Decision: TECH-Q-02 "Nitrogen purity check passed?"
//   Outcomes: Yes (proceed) | No (re-purge)
//   Insert after: DISP-CUSTOM-001
//   Reasoning: EU GMP Annex 15 requires documented verification of inert atmosphere
//
// Approve? [Yes/No/Edit]

// 3. User approves
approve_suggestion({
  client_name: "TechPharma",
  suggestion_id: "TECH-Q-02"
})

// 4. Workflow regenerated with all approved customs
// 5. Workflow locked and versioned (v1)
// 6. Exported to PNG

// 7. Later, user promotes valuable task
promote_custom_task({
  client_name: "TechPharma",
  custom_task_id: "DISP-CUSTOM-001",
  new_base_id: "DISP-056",
  rationale: "Nitrogen purging is common for HPAPI clients, should be in base library"
})
// Now DISP-056 available for all future clients with Q-HSE-01='HPAPI'
```

---

# Combined Implementation Timeline

## Phase 1: Granulation Foundation (v3.0) - Week 1-2

### Pre-Implementation
- [ ] Get loop pairs from user (GRAN-L-xxx mappings)
- [ ] Clarify stage count: 6 or 8 unique stages?
- [ ] Confirm standalone workflow approach
- [ ] Create backups of data/tasks.json and data/decisions.json

### Implementation
1. [ ] **Backup:** Copy tasks.json → tasks.json.backup
2. [ ] **Backup:** Copy decisions.json → decisions.json.backup
3. [ ] **Data:** Transform and append 56 Granulation tasks to tasks.json
4. [ ] **Data:** Transform and append 34 Granulation decisions to decisions.json
5. [ ] **Code:** Update stageOrder array (line 249)
6. [ ] **Code:** Add Granulation loop mappings (line 207)
7. [ ] **Code:** Update tool descriptions (lines 762, 845)
8. [ ] **Code:** Rename generateBeautifulMermaidDiagram → generateBeautifulDispensingDiagram
9. [ ] **Code:** Create generateBeautifulGranulationDiagram function
10. [ ] **Code:** Create router function (new generateBeautifulMermaidDiagram)
11. [ ] **Code:** Update version to 3.0.0 (lines 742, 1572)
12. [ ] **Test:** Generate Granulation workflow for test client
13. [ ] **Test:** Validate workflow structure
14. [ ] **Test:** Export workflow to PNG

### Post-Implementation
- [ ] Verify no regression in Dispensing workflow generation
- [ ] Update README.md with Granulation stage documentation
- [ ] Document new decision IDs and their purposes

---

## Phase 2: LLM Foundation (v3.1) - Week 3

### Implementation
1. [ ] Create `client_custom.json` schema and storage
2. [ ] Update `client_workflows.json` to support versioning
3. [ ] Implement `add_custom_task` tool (manual mode)
4. [ ] Implement `add_custom_decision` tool (manual mode)
5. [ ] Implement `list_custom_tasks` tool
6. [ ] Test adding custom tasks manually for TechPharma
7. [ ] Update version to 3.1.0

---

## Phase 3: LLM Integration (v3.2) - Week 4

### Implementation
1. [ ] Implement `analyze_client_context` tool
2. [ ] Add LLM prompt engineering for workflow analysis
3. [ ] Implement classification logic (minor vs major)
4. [ ] Add approval workflow (show diff, confirm major changes)
5. [ ] Test LLM suggestions with sample clients
6. [ ] Update version to 3.2.0

---

## Phase 4: Augmented Generation (v3.3) - Week 5

### Implementation
1. [ ] Extend `generate_workflow` to support `mode: 'augmented'`
2. [ ] Integrate LLM suggestions into workflow generation
3. [ ] Add metadata tracking (what was added by LLM, what was approved)
4. [ ] Implement workflow locking and versioning
5. [ ] Test full augmented workflow generation
6. [ ] Update version to 3.3.0

---

## Phase 5: Promotion & Maintenance (v3.4) - Week 6

### Implementation
1. [ ] Implement `promote_custom_task` tool
2. [ ] Create workflow diff viewer (base vs augmented)
3. [ ] Add promotion candidate detection
4. [ ] Test promotion workflow
5. [ ] Documentation and user guides
6. [ ] Update version to 3.4.0

---

# Open Questions (AWAITING USER INPUT)

## Granulation-Specific

### 1. Loop Pairs
**Question:** What are the Loop-Start and Loop-End task ID pairs for Granulation?

**Expected format:**
```
Loop 1: GRAN-L-001 (start) → GRAN-L-002 (end)
Loop 2: GRAN-XXX-001 (start) → GRAN-XXX-002 (end)
```

### 2. Stage Count Clarification
**Question:** You mentioned 8 stages, but the data shows 6 unique stage names:
1. Pre-Granulation
2. Material Transfer & Verification
3. Binder Preparation
4. Granulation
5. Post-Granulation
6. Closeout

Are there 2 additional stages, or are some macro names mapped to the same stage?

### 3. Workflow Connectivity
**Confirm:** Granulation should be a standalone workflow (no predecessors linking to DISP-xxx tasks)?

---

# Files to Modify

| File | Changes | Version | Risk Level |
|------|---------|---------|------------|
| `data/tasks.json` | Append 56 Granulation tasks | v3.0 | Low (append only) |
| `data/decisions.json` | Append 34 Granulation decisions | v3.0 | Low (append only) |
| `data/client_custom.json` | NEW - Custom tasks/decisions storage | v3.1 | Low (new file) |
| `src/index.ts` | Multiple updates across all phases | v3.0-3.4 | Medium-High |

**Estimated Total Changes:** ~1500-2000 new lines of code across all phases

---

# Rollback Plan

If issues arise at any phase:
1. Restore `data/tasks.json.backup`
2. Restore `data/decisions.json.backup`
3. Revert `src/index.ts` commits via git
4. Remove `data/client_custom.json` if created

---

# Success Criteria

## v3.0 (Granulation)
- ✅ Granulation workflows generate correctly
- ✅ Beautiful diagram with tri-path routing
- ✅ No regression in Dispensing workflows
- ✅ All validation checks pass

## v3.1+ (LLM Augmentation)
- ✅ Custom tasks can be added manually
- ✅ LLM suggestions are classified correctly (minor vs major)
- ✅ Augmented workflows maintain audit trail
- ✅ Promotion pathway works end-to-end
- ✅ Workflows are properly versioned and locked

---

# Status

**Current Phase:** Planning
**Blockers:**
- Loop pairs needed (Granulation)
- Stage count clarification needed (Granulation)

**Ready to Implement v3.0:** ❌ (awaiting user input)
**Ready to Implement v3.1+:** ✅ (design approved, can start after v3.0)

---

*Last Updated: 2025-10-27*
*This document will be deleted after implementation.*
