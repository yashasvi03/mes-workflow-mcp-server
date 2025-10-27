# Granulation Stage Implementation Plan

**Version:** 3.0.0 (Major update - new stage family)
**Date:** 2025-10-27
**Status:** Planning Phase - DO NOT IMPLEMENT YET

---

## Overview

Extending the MES Workflow MCP Server to support the **Granulation** stage family, adding 56 tasks and 34 decisions alongside the existing Dispensing workflow.

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

##### Option A: Stage-Specific Functions (RECOMMENDED)

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

## Phase 3: Testing & Validation

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

## Phase 4: Execution Checklist

### Pre-Implementation
- [ ] Get loop pairs from user (GRAN-L-xxx mappings)
- [ ] Clarify stage count: 6 or 8 unique stages?
- [ ] Confirm standalone workflow approach
- [ ] Create backups of data/tasks.json and data/decisions.json

### Implementation Order
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

## Open Questions (AWAITING USER INPUT)

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

## Files to Modify

| File | Changes | Lines Affected | Risk Level |
|------|---------|----------------|------------|
| `data/tasks.json` | Append 56 tasks | End of file | Low (append only) |
| `data/decisions.json` | Append 34 decisions | End of file | Low (append only) |
| `src/index.ts` | Multiple updates | ~7 locations | Medium |

**Estimated Total Changes:** ~500-700 new lines of code

---

## Rollback Plan

If issues arise:
1. Restore `data/tasks.json.backup`
2. Restore `data/decisions.json.backup`
3. Revert `src/index.ts` commits via git

---

## Status

**Current Phase:** Planning
**Blockers:**
- Loop pairs needed
- Stage count clarification needed

**Ready to Implement:** ❌ (awaiting user input)

---

*Last Updated: 2025-10-27*
*This document will be deleted after implementation.*
