#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execFile } from 'child_process';  
import { promisify } from 'util';          


// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory path
const DATA_DIR = path.join(__dirname, '../data');
const EXPORTS_DIR = path.join(__dirname, '../exports');

// Type definitions
interface Decision {
  id: string;
  category: string;
  question: string;
  outcomes: string[];
  stage: string;
  affects: string;
  notes: string;
}

interface Task {
  id: string;
  parent_id: string | null;
  name: string;
  type: string;
  stage: string;
  actor: string;
  integration: string;
  inputs: string;
  outputs: string;
  predecessors: string[];
  edge_type: string;
  guard_condition: string;
  decision_id: string | null;
  decision_outcome: string | null;
  loop_key: string;
  loop_exit_condition: string;
  logs: string;
  controls: string;
}

interface ClientDecision {
  selected_outcome: string;
  rationale: string;
  timestamp: string;
}

interface ClientDecisions {
  [clientName: string]: {
    [decisionId: string]: ClientDecision;
  };
}

interface WorkflowMetadata {
  task_count: number;
  decision_count: number;
  macro_count: number;
  loop_count: number;
}

interface SavedWorkflow {
  last_generated: string;
  stage: string;
  version: number;
  mermaid_code: string;
  metadata: WorkflowMetadata;
}

interface ClientWorkflows {
  [clientName: string]: SavedWorkflow;
}

// Data loading functions
async function loadDecisions(): Promise<Decision[]> {
  const data = await fs.readFile(path.join(DATA_DIR, 'decisions.json'), 'utf-8');
  return JSON.parse(data);
}

async function loadTasks(): Promise<Task[]> {
  const data = await fs.readFile(path.join(DATA_DIR, 'tasks.json'), 'utf-8');
  return JSON.parse(data);
}

async function loadClientDecisions(): Promise<ClientDecisions> {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, 'client_decisions.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveClientDecisions(data: ClientDecisions): Promise<void> {
  await fs.writeFile(
    path.join(DATA_DIR, 'client_decisions.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
}

async function loadClientWorkflows(): Promise<ClientWorkflows> {
  try {
    const data = await fs.readFile(path.join(DATA_DIR, 'client_workflows.json'), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveClientWorkflows(data: ClientWorkflows): Promise<void> {
  await fs.writeFile(
    path.join(DATA_DIR, 'client_workflows.json'),
    JSON.stringify(data, null, 2),
    'utf-8'
  );
}

// Ensure exports directory exists
async function ensureExportsDir(): Promise<void> {
  if (!existsSync(EXPORTS_DIR)) {
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
  }
}

// Ensure client export directory exists
async function ensureClientExportDir(clientName: string): Promise<string> {
  await ensureExportsDir();
  const clientDir = path.join(EXPORTS_DIR, clientName);
  if (!existsSync(clientDir)) {
    await fs.mkdir(clientDir, { recursive: true });
  }
  return clientDir;
}

// Helper function to check if task should be included based on decision
function shouldIncludeTask(
  task: Task,
  decisions: { [key: string]: ClientDecision }
): boolean {
  if (!task.decision_id) {
    return true;
  }

  // Runtime conditions are always included
  if (task.decision_id.startsWith('C-')) {
    return true;
  }

  const clientChoice = decisions[task.decision_id]?.selected_outcome;
  if (!clientChoice) {
    return false;
  }

  // Handle multiple valid outcomes (comma-separated in decision_outcome)
  if (task.decision_outcome && task.decision_outcome.includes(',')) {
    const validOutcomes = task.decision_outcome.split(',').map((o) => o.trim());
    return validOutcomes.includes(clientChoice);
  }

  return clientChoice === task.decision_outcome;
}

// Helper function to find closest included ancestor
function findClosestIncludedAncestor(
  task: Task,
  allTasks: Task[],
  includedTaskIds: Set<string>
): string | null {
  const visited = new Set<string>();
  const queue = [...task.predecessors];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (visited.has(currentId)) continue;
    visited.add(currentId);

    if (includedTaskIds.has(currentId)) {
      return currentId;
    }

    const currentTask = allTasks.find((t) => t.id === currentId);
    if (currentTask && currentTask.predecessors) {
      queue.push(...currentTask.predecessors);
    }
  }

  return null;
}

// Helper function to find loop start for a loop end
function findLoopStart(loopEndId: string): string {
  if (loopEndId === 'DISP-L-002') return 'DISP-L-001';
  if (loopEndId === 'DISP-SL-006') return 'DISP-SL-001';
  if (loopEndId === 'GRAN-L-002') return 'GRAN-L-001';
  return loopEndId;
}

// Helper function to find first task in loop body
function findLoopBodyStart(loopStartId: string, tasks: Task[]): string | null {
  const firstInLoop = tasks.find((t) => t.predecessors.includes(loopStartId));
  return firstInLoop ? firstInLoop.id : null;
}

// Generate improved Mermaid diagram
function generateMermaidDiagram(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision }
): string {
  let mermaid = 'graph TD\n';

  // Add styling
  mermaid += '  classDef macroStyle fill:#e1f5ff,stroke:#0288d1,stroke-width:3px\n';
  mermaid += '  classDef microStyle fill:#fff9e1,stroke:#fbc02d,stroke-width:2px\n';
  mermaid += '  classDef loopStyle fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px\n';
  mermaid += '  classDef exceptionStyle fill:#ffebee,stroke:#d32f2f,stroke-width:2px,stroke-dasharray: 5 5\n';
  mermaid += '  classDef decisionStyle fill:#fff3e0,stroke:#f57c00,stroke-width:2px\n\n';

  const includedTaskIds = new Set(filteredTasks.map((t) => t.id));

  // Group tasks by stage for subgraphs
  const tasksByStage: { [stage: string]: Task[] } = {};
  for (const task of filteredTasks) {
    if (!tasksByStage[task.stage]) {
      tasksByStage[task.stage] = [];
    }
    tasksByStage[task.stage].push(task);
  }

  // Track decision nodes we've created
  const createdDecisionNodes = new Set<string>();

  // Generate nodes with subgraphs
  const stageOrder = [
    'Pre-Dispensing',
    'Material Allocation',
    'Weighing & Dispensing',
    'Labeling & Documentation',
    'Post-Dispensing',
    'Pre-Granulation',
    'Material Transfer & Verification',
    'Binder Preparation',
    'Granulation',
    'Post-Granulation',
    'Closeout',
  ];

  for (const stage of stageOrder) {
    if (!tasksByStage[stage]) continue;

    const stageId = stage.replace(/\s+/g, '_').replace(/&/g, 'and');
    mermaid += `\n  subgraph ${stageId}["${stage}"]\n`;

    for (const task of tasksByStage[stage]) {
      const nodeId = task.id.replace(/-/g, '_');
      const label = `${task.id}:<br/>${task.name}`;

      let nodeShape = '';
      let styleClass = '';

      if (task.type === 'Macro') {
        nodeShape = `${nodeId}[["${label}"]]`;
        styleClass = 'macroStyle';
      } else if (task.type === 'Loop-Start' || task.type === 'Loop-End') {
        nodeShape = `${nodeId}(("${label}"))`;
        styleClass = 'loopStyle';
      } else {
        nodeShape = `${nodeId}["${label}"]`;
        styleClass = task.edge_type === 'exception' ? 'exceptionStyle' : 'microStyle';
      }

      mermaid += `    ${nodeShape}\n`;
      if (styleClass) {
        mermaid += `    class ${nodeId} ${styleClass}\n`;
      }
    }

    mermaid += `  end\n`;
  }

  mermaid += '\n';

  // Check if Q-SEC-01 is set to "Both (material-dependent)"
  const secDecision = decisions['Q-SEC-01'];
  const isBothPaths = secDecision?.selected_outcome === 'Both (material-dependent)';

  // Special handling for DISP-017 routing when "Both" is selected
  if (isBothPaths && includedTaskIds.has('DISP-017')) {
    const disp017NodeId = 'DISP_017';
    const decisionNodeId = 'DEC_C_SEC_01';

    // Add C-SEC-01 decision diamond
    mermaid += `  ${decisionNodeId}{Is container sealed?}\n`;
    mermaid += `  class ${decisionNodeId} decisionStyle\n`;
    mermaid += `  ${disp017NodeId} --> ${decisionNodeId}\n`;

    // Route to sealed path
    if (includedTaskIds.has('DISP-SL-001')) {
      mermaid += `  ${decisionNodeId} -->|Yes → Sealed| DISP_SL_001\n`;
    }

    // Route to weighing path
    if (includedTaskIds.has('DISP-L-001')) {
      mermaid += `  ${decisionNodeId} -->|No → Weighing| DISP_L_001\n`;
    }

    createdDecisionNodes.add(decisionNodeId);
  }

  // Generate edges with smart linking
  for (const task of filteredTasks) {
    const nodeId = task.id.replace(/-/g, '_');

    // Skip DISP-L-001 and DISP-SL-001 predecessors if "Both" path - already handled above
    if (isBothPaths && (task.id === 'DISP-L-001' || task.id === 'DISP-SL-001')) {
      continue;
    }

    if (task.predecessors && task.predecessors.length > 0) {
      // Filter predecessors to only those in the workflow
      let validPredecessors = task.predecessors.filter((pred) => includedTaskIds.has(pred));

      // If NO valid predecessors, find closest ancestor
      if (validPredecessors.length === 0) {
        const closestAncestor = findClosestIncludedAncestor(task, allTasks, includedTaskIds);
        if (closestAncestor) {
          validPredecessors = [closestAncestor];
        }
      }

      // Add edges from valid predecessors
      for (const pred of validPredecessors) {
        const predId = pred.replace(/-/g, '_');

        // Check if this edge needs a decision node
        if (task.guard_condition && task.decision_id && task.decision_id.startsWith('C-')) {
          // Runtime condition - create decision diamond
          const decisionNodeId = `DEC_${task.id.replace(/-/g, '_')}`;

          if (!createdDecisionNodes.has(decisionNodeId)) {
            // Extract simple condition label
            let conditionLabel = task.guard_condition;
            if (conditionLabel.length > 40) {
              conditionLabel = task.decision_id; // Use decision ID if too long
            }

            mermaid += `  ${decisionNodeId}{${conditionLabel}}\n`;
            mermaid += `  class ${decisionNodeId} decisionStyle\n`;
            mermaid += `  ${predId} --> ${decisionNodeId}\n`;

            createdDecisionNodes.add(decisionNodeId);
          }

          // Determine edge label based on outcome
          const edgeLabel = task.decision_outcome || 'Yes';
          const edgeStyle = task.edge_type === 'exception' ? '-.->' : '-->';
          mermaid += `  ${decisionNodeId} ${edgeStyle}|${edgeLabel}| ${nodeId}\n`;
        } else {
          // Regular edge
          const edgeStyle = task.edge_type === 'exception' ? '-.->|exception|' : '-->';
          mermaid += `  ${predId} ${edgeStyle} ${nodeId}\n`;
        }
      }
    }

    // Handle loop back edges
    if (task.type === 'Loop-End' && task.loop_exit_condition) {
      const loopStartId = findLoopStart(task.id);
      const loopBodyStartId = findLoopBodyStart(loopStartId, filteredTasks);

      if (loopBodyStartId) {
        const bodyStartNodeId = loopBodyStartId.replace(/-/g, '_');
        const loopCondition = task.loop_exit_condition.replace(/RunningTotal >= Target/gi, 'Target not reached');

        mermaid += `  ${nodeId} -.->|${loopCondition}| ${bodyStartNodeId}\n`;
      }
    }
  }

  return mermaid;
}

// Generate beautiful Mermaid diagram with enhanced UI
// Generate beautiful Mermaid diagram with enhanced UI
function generateBeautifulMermaidDiagram(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision },
  clientName: string
): string {
  const secDecision = decisions['Q-SEC-01'];
  const isBothPaths = secDecision?.selected_outcome === 'Both (material-dependent)';
  const isWeighingOnly = secDecision?.selected_outcome === 'Weighing only';
  const isSealedOnly = secDecision?.selected_outcome === 'Sealed only';
  
  // Determine if using SAP or MES allocation
  const erpDecision = decisions['Q-ERP-01'];
  const usesSAP = erpDecision?.selected_outcome === 'SAP';

  let mermaid = `%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#e1f5ff','primaryTextColor':'#01579b','primaryBorderColor':'#0288d1','lineColor':'#546e7a','secondaryColor':'#fff9e1','tertiaryColor':'#f3e5f5'}}}%%\n`;
  mermaid += `graph TB\n`;
  mermaid += `  classDef macroStyle fill:#0288d1,stroke:#01579b,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:16px\n`;
  mermaid += `  classDef microStyle fill:#fff9e1,stroke:#f9a825,stroke-width:2px,color:#3e2723,font-size:14px\n`;
  mermaid += `  classDef loopStyle fill:#8e24aa,stroke:#4a148c,stroke-width:3px,color:#ffffff,font-weight:bold,font-size:14px\n`;
  mermaid += `  classDef exceptionStyle fill:#ffcdd2,stroke:#c62828,stroke-width:3px,stroke-dasharray:8 4,color:#b71c1c,font-weight:bold\n`;
  mermaid += `  classDef decisionStyle fill:#fff3e0,stroke:#e65100,stroke-width:3px,color:#e65100,font-weight:bold\n`;
  mermaid += `  classDef convergeStyle fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px,color:#1b5e20,font-weight:bold\n`;
  mermaid += `  classDef dualPathStyle fill:#e1bee7,stroke:#6a1b9a,stroke-width:3px,color:#4a148c,font-weight:bold\n\n`;

  // ========================================
  // START NODE
  // ========================================
  mermaid += `  START([🏁 START DISPENSING])\n`;
  mermaid += `  style START fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n\n`;

  // ========================================
  // STAGE 1: PRE-DISPENSING
  // ========================================
  mermaid += `  M1["📋 PRE-DISPENSING &<br/>ROOM READINESS"]\n`;
  mermaid += `  class M1 macroStyle\n`;
  mermaid += `  START --> M1\n\n`;

  mermaid += `  T001["👤 Training & Role Gate"]\n`;
  mermaid += `  T002["📝 Line Clearance Request"]\n`;
  mermaid += `  T003["🧹 Verify Batch Clearance<br/>& Remove Residuals"]\n`;
  mermaid += `  class T001,T002,T003 microStyle\n\n`;

  mermaid += `  M1 --> T001\n`;
  mermaid += `  T001 --> T002\n`;
  mermaid += `  T002 --> T003\n\n`;

  // Cleaning Decision
  mermaid += `  D004{"⏰ Cleaning<br/>Hold-Time Valid?"}\n`;
  mermaid += `  T004["✓ Hold-Time Check"]\n`;
  mermaid += `  T005["⚠️ RE-CLEAN ROOM<br/>& Record"]\n`;
  mermaid += `  class D004 decisionStyle\n`;
  mermaid += `  class T004 microStyle\n`;
  mermaid += `  class T005 exceptionStyle\n\n`;

  mermaid += `  T003 --> D004\n`;
  mermaid += `  D004 -->|YES| T004\n`;
  mermaid += `  D004 -.->|NO - Expired| T005\n`;
  mermaid += `  T005 -.-> T004\n\n`;

  // Parallel Checks
  mermaid += `  T006["🌡️ Capture Environment<br/>RT/RH/DP"]\n`;
  mermaid += `  T008["⚖️ Balance Calibration<br/>Verification"]\n`;
  mermaid += `  class T006,T008 microStyle\n\n`;

  mermaid += `  T003 --> T006\n`;
  mermaid += `  T003 --> T008\n\n`;

  // QA Gate
  mermaid += `  T009["✅ QA Room Readiness<br/>Inspection & E-Sign"]\n`;
  mermaid += `  class T009 convergeStyle\n\n`;

  mermaid += `  T004 --> T009\n`;
  mermaid += `  T006 --> T009\n`;
  mermaid += `  T008 --> T009\n\n`;

  // ========================================
  // STAGE 2: MATERIAL ALLOCATION
  // ========================================
  mermaid += `  M2["📦 MATERIAL IDENTIFICATION<br/>ALLOCATION & STAGING"]\n`;
  mermaid += `  class M2 macroStyle\n`;
  mermaid += `  T009 ==> M2\n\n`;

  mermaid += `  T010["📄 Retrieve Production<br/>Order & BOM"]\n`;
  mermaid += `  T011["🔄 Sync Material Master<br/>Data"]\n`;
  mermaid += `  T012["📊 Fetch Available<br/>Inventory Lots"]\n`;
  mermaid += `  T013["🔍 Filter by Status<br/>& Retest Validity"]\n`;
  mermaid += `  class T010,T011,T012,T013 microStyle\n\n`;

  mermaid += `  M2 --> T010\n`;
  mermaid += `  T010 --> T011\n`;
  mermaid += `  T011 --> T012\n`;
  mermaid += `  T012 --> T013\n\n`;

  // SAP or MES Allocation
  if (usesSAP) {
    mermaid += `  T014["🎯 SAP/ERP BATCH<br/>DETERMINATION"]\n`;
    mermaid += `  style T014 fill:#bbdefb,stroke:#1565c0,stroke-width:3px,color:#0d47a1,font-weight:bold\n`;
    mermaid += `  T013 --> T014\n\n`;
    mermaid += `  T016["📍 Reserve & Stage<br/>to Dispensing Area"]\n`;
    mermaid += `  T017["🔎 Identify Container<br/>& Verify Allocation"]\n`;
    mermaid += `  class T016,T017 microStyle\n`;
    mermaid += `  T014 --> T016\n`;
  } else {
    mermaid += `  T015["🎯 MES LOT ALLOCATION<br/>with FIFO/FEFO Policy"]\n`;
    mermaid += `  style T015 fill:#e3f2fd,stroke:#1565c0,stroke-width:3px,color:#0d47a1,font-weight:bold\n`;
    mermaid += `  T013 --> T015\n\n`;
    mermaid += `  T016["📍 Reserve & Stage<br/>to Dispensing Area"]\n`;
    mermaid += `  T017["🔎 Identify Container<br/>& Verify Allocation"]\n`;
    mermaid += `  class T016,T017 microStyle\n`;
    mermaid += `  T015 --> T016\n`;
  }

  mermaid += `  T016 --> T017\n\n`;

  // ========================================
  // STAGE 3: WEIGHING & DISPENSING
  // ========================================
  mermaid += `  M3["⚖️ WEIGHING &<br/>DISPENSING"]\n`;
  mermaid += `  class M3 macroStyle\n`;
  mermaid += `  T017 ==> M3\n\n`;

  if (isBothPaths) {
    // Dual-path routing
    mermaid += `  ROUTE{"🔀 CONTAINER<br/>SEALED?<br/>(Material-Dependent)"}\n`;
    mermaid += `  class ROUTE dualPathStyle\n`;
    mermaid += `  M3 --> ROUTE\n\n`;

    // Weighing Path
    mermaid += `  LOOP_W_START(("🔄 START<br/>WEIGHING<br/>LOOP"))\n`;
    mermaid += `  class LOOP_W_START loopStyle\n`;
    mermaid += `  ROUTE -->|NO - Weigh| LOOP_W_START\n\n`;

    mermaid += `  T020["📦 Select Next<br/>Container"]\n`;
    mermaid += `  class T020 microStyle\n`;
    mermaid += `  LOOP_W_START --> T020\n\n`;

    mermaid += `  D021{"🔍 Container<br/>Damaged?"}\n`;
    mermaid += `  T021["⛔ QUARANTINE<br/>& Replace"]\n`;
    mermaid += `  class D021 decisionStyle\n`;
    mermaid += `  class T021 exceptionStyle\n`;
    mermaid += `  T020 --> D021\n`;
    mermaid += `  D021 -.->|YES| T021\n`;
    mermaid += `  D021 -->|NO| T022\n\n`;

    mermaid += `  T022["⚖️ Balance Suitability<br/>Check"]\n`;
    mermaid += `  T023["📝 Select Weighing<br/>Method"]\n`;
    mermaid += `  T024["⚖️ Tare Container"]\n`;
    mermaid += `  T025["🧪 Pull Assay & CoA<br/>Compute Adjusted Qty"]\n`;
    mermaid += `  T026["🔢 Apply UoM Conversion<br/>& Rounding"]\n`;
    mermaid += `  class T022,T023,T024,T025,T026 microStyle\n\n`;

    mermaid += `  T022 --> T023\n`;
    mermaid += `  T023 --> T024\n`;
    mermaid += `  T024 --> T025\n`;
    mermaid += `  T025 --> T026\n\n`;

    mermaid += `  T027["⚖️ WEIGH MATERIAL"]\n`;
    mermaid += `  style T027 fill:#fff59d,stroke:#f57f17,stroke-width:3px,color:#f57f17,font-weight:bold,font-size:15px\n`;
    mermaid += `  T026 --> T027\n\n`;

    mermaid += `  D027S{"💧 Spill<br/>Detected?"}\n`;
    mermaid += `  T027S["⚠️ SPILL WORKFLOW<br/>Cleanup & Log"]\n`;
    mermaid += `  class D027S decisionStyle\n`;
    mermaid += `  class T027S exceptionStyle\n`;
    mermaid += `  T027 --> D027S\n`;
    mermaid += `  D027S -.->|YES| T027S\n`;
    mermaid += `  D027S -->|NO| T029\n\n`;

    mermaid += `  D029{"📏 Within<br/>Tolerance?"}\n`;
    mermaid += `  T029["⚠️ DEVIATION<br/>Handle per Policy"]\n`;
    mermaid += `  class D029 decisionStyle\n`;
    mermaid += `  class T029 exceptionStyle\n`;
    mermaid += `  D029 -.->|NO| T029\n`;
    mermaid += `  D029 -->|YES| T030W\n\n`;

    mermaid += `  T030W["🏷️ Print & Affix<br/>Container Label"]\n`;
    mermaid += `  T030VW["✓ Label Scanback<br/>Verification"]\n`;
    mermaid += `  class T030W,T030VW microStyle\n`;
    mermaid += `  T030W --> T030VW\n\n`;

    mermaid += `  T031W["➕ Update Running Total"]\n`;
    mermaid += `  class T031W microStyle\n`;
    mermaid += `  T030VW --> T031W\n\n`;

    mermaid += `  D031W{"🎯 Target<br/>Reached?"}\n`;
    mermaid += `  class D031W decisionStyle\n`;
    mermaid += `  T031W --> D031W\n\n`;

    mermaid += `  LOOP_W_END(("🔄 END<br/>WEIGHING<br/>LOOP"))\n`;
    mermaid += `  class LOOP_W_END loopStyle\n`;
    mermaid += `  D031W -.->|NO| T020\n`;
    mermaid += `  D031W -->|YES| LOOP_W_END\n\n`;

    // Sealed Path
    mermaid += `  LOOP_S_START(("🔄 START<br/>SEALED<br/>LOOP"))\n`;
    mermaid += `  class LOOP_S_START loopStyle\n`;
    mermaid += `  ROUTE -->|YES - Sealed| LOOP_S_START\n\n`;

    mermaid += `  T_S_002["📦 Scan Sealed Container<br/>Capture Declared Mass"]\n`;
    mermaid += `  T_S_003["🔍 Verify Integrity<br/>& Eligibility"]\n`;
    mermaid += `  T_S_004["🏷️ Print Dispensed<br/>Container Label"]\n`;
    mermaid += `  T_S_005["➕ Update Running Total"]\n`;
    mermaid += `  class T_S_002,T_S_003,T_S_004,T_S_005 microStyle\n\n`;

    mermaid += `  LOOP_S_START --> T_S_002\n`;
    mermaid += `  T_S_002 --> T_S_003\n`;
    mermaid += `  T_S_003 --> T_S_004\n`;
    mermaid += `  T_S_004 --> T_S_005\n\n`;

    mermaid += `  D_S_005{"🎯 Target<br/>Reached?"}\n`;
    mermaid += `  class D_S_005 decisionStyle\n`;
    mermaid += `  T_S_005 --> D_S_005\n\n`;

    mermaid += `  LOOP_S_END(("🔄 END<br/>SEALED<br/>LOOP"))\n`;
    mermaid += `  class LOOP_S_END loopStyle\n`;
    mermaid += `  D_S_005 -.->|NO| T_S_002\n`;
    mermaid += `  D_S_005 -->|YES| LOOP_S_END\n\n`;

    // Convergence
    mermaid += `  CONVERGE["🔗 PATHS CONVERGE"]\n`;
    mermaid += `  class CONVERGE convergeStyle\n`;
    mermaid += `  LOOP_W_END --> CONVERGE\n`;
    mermaid += `  LOOP_S_END --> CONVERGE\n\n`;
  } else if (isWeighingOnly) {
    // Weighing only path (TechPharma style)
    mermaid += `  LOOP_W_START(("🔄 START<br/>WEIGHING<br/>LOOP"))\n`;
    mermaid += `  class LOOP_W_START loopStyle\n`;
    mermaid += `  M3 --> LOOP_W_START\n\n`;

    mermaid += `  T020["📦 Select Next<br/>Container"]\n`;
    mermaid += `  class T020 microStyle\n`;
    mermaid += `  LOOP_W_START --> T020\n\n`;

    mermaid += `  D021{"🔍 Container<br/>Damaged?"}\n`;
    mermaid += `  T021["⛔ QUARANTINE<br/>& Replace"]\n`;
    mermaid += `  class D021 decisionStyle\n`;
    mermaid += `  class T021 exceptionStyle\n`;
    mermaid += `  T020 --> D021\n`;
    mermaid += `  D021 -.->|YES| T021\n`;
    mermaid += `  D021 -->|NO| T022\n\n`;

    mermaid += `  T022["⚖️ Balance Suitability<br/>Check"]\n`;
    mermaid += `  T023["📝 Select Weighing<br/>Method"]\n`;
    mermaid += `  T024["⚖️ Tare Container"]\n`;
    mermaid += `  T025["🧪 Pull Assay & CoA<br/>Compute Adjusted Qty"]\n`;
    mermaid += `  T026["🔢 Apply UoM Conversion<br/>& Rounding"]\n`;
    mermaid += `  class T022,T023,T024,T025,T026 microStyle\n\n`;

    mermaid += `  T022 --> T023\n`;
    mermaid += `  T023 --> T024\n`;
    mermaid += `  T024 --> T025\n`;
    mermaid += `  T025 --> T026\n\n`;

    mermaid += `  T027["⚖️ WEIGH MATERIAL"]\n`;
    mermaid += `  style T027 fill:#fff59d,stroke:#f57f17,stroke-width:3px,color:#f57f17,font-weight:bold,font-size:15px\n`;
    mermaid += `  T026 --> T027\n\n`;

    mermaid += `  D027S{"💧 Spill<br/>Detected?"}\n`;
    mermaid += `  T027S["⚠️ SPILL WORKFLOW<br/>Cleanup & Log"]\n`;
    mermaid += `  class D027S decisionStyle\n`;
    mermaid += `  class T027S exceptionStyle\n`;
    mermaid += `  T027 --> D027S\n`;
    mermaid += `  D027S -.->|YES| T027S\n`;
    mermaid += `  D027S -->|NO| T029\n\n`;

    mermaid += `  D029{"📏 Within<br/>Tolerance?"}\n`;
    mermaid += `  T029["⚠️ DEVIATION<br/>Handle per Policy"]\n`;
    mermaid += `  class D029 decisionStyle\n`;
    mermaid += `  class T029 exceptionStyle\n`;
    mermaid += `  D029 -.->|NO| T029\n`;
    mermaid += `  D029 -->|YES| T030W\n\n`;

    mermaid += `  T030W["🏷️ Print & Affix<br/>Container Label"]\n`;
    mermaid += `  T030VW["✓ Label Scanback<br/>Verification"]\n`;
    mermaid += `  class T030W,T030VW microStyle\n`;
    mermaid += `  T030W --> T030VW\n\n`;

    mermaid += `  T031W["➕ Update Running Total"]\n`;
    mermaid += `  class T031W microStyle\n`;
    mermaid += `  T030VW --> T031W\n\n`;

    mermaid += `  D031W{"🎯 Target<br/>Reached?"}\n`;
    mermaid += `  class D031W decisionStyle\n`;
    mermaid += `  T031W --> D031W\n\n`;

    mermaid += `  LOOP_W_END(("🔄 END<br/>WEIGHING<br/>LOOP"))\n`;
    mermaid += `  class LOOP_W_END loopStyle\n`;
    mermaid += `  D031W -.->|NO| T020\n`;
    mermaid += `  D031W -->|YES| LOOP_W_END\n\n`;

    mermaid += `  CONVERGE["🔗 PATH COMPLETE"]\n`;
    mermaid += `  class CONVERGE convergeStyle\n`;
    mermaid += `  LOOP_W_END --> CONVERGE\n\n`;
  }

  // ========================================
  // STAGE 4: LABELING & DOCUMENTATION
  // ========================================
  mermaid += `  M5["🏷️ LABELING, RECONCILIATION<br/>& DOCUMENTATION"]\n`;
  mermaid += `  class M5 macroStyle\n`;
  mermaid += `  CONVERGE ==> M5\n\n`;

  mermaid += `  T040["👁️ Label Preview<br/>& Validation"]\n`;
  mermaid += `  T042["📋 Print Aggregate/<br/>Kit Label"]\n`;
  mermaid += `  T044["✅ Label Reconciliation<br/>(Printed vs Used vs Voided)"]\n`;
  mermaid += `  class T040,T042,T044 microStyle\n\n`;

  mermaid += `  M5 --> T040\n`;
  mermaid += `  T040 --> T042\n`;
  mermaid += `  T042 --> T044\n\n`;

  // ========================================
  // STAGE 5: POST-DISPENSING
  // ========================================
  mermaid += `  M6["📤 POST-DISPENSING<br/>TRANSFER & ERP POSTING"]\n`;
  mermaid += `  class M6 macroStyle\n`;
  mermaid += `  T044 ==> M6\n\n`;

  mermaid += `  T050["📍 Assign Storage<br/>Location"]\n`;
  mermaid += `  T051["🤝 Handover Scan<br/>(Chain of Custody)"]\n`;
  mermaid += `  T052A["✓ ERP GI Posting<br/>Acknowledgement"]\n`;
  mermaid += `  T053["📊 Variance<br/>Reconciliation"]\n`;
  mermaid += `  T054["✅ Close Deviations<br/>& Attach Evidence"]\n`;
  mermaid += `  T055["📁 Archive Logs<br/>& Finalize Record"]\n`;
  mermaid += `  class T050,T051,T052A,T053,T054,T055 microStyle\n\n`;

  mermaid += `  M6 --> T050\n`;
  mermaid += `  T050 --> T051\n`;
  mermaid += `  T051 --> T052A\n`;
  mermaid += `  T052A --> T053\n`;
  mermaid += `  T053 --> T054\n`;
  mermaid += `  T054 --> T055\n\n`;

  // ========================================
  // END NODE
  // ========================================
  mermaid += `  COMPLETE([🎉 DISPENSING COMPLETE])\n`;
  mermaid += `  style COMPLETE fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n`;
  mermaid += `  T055 ==> COMPLETE\n`;

  return mermaid;
}

// Add this new function after generateBeautifulMermaidDiagram for Dispensing

/**
 * Generate beautiful Granulation workflow with enhanced UI
 */
function generateGranulationWorkflow(
  filteredTasks: Task[],
  allTasks: Task[],
  decisions: { [key: string]: ClientDecision },
  clientName: string
): string {
  let mermaid = `%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#e1f5ff','primaryTextColor':'#01579b','primaryBorderColor':'#0288d1','lineColor':'#546e7a','secondaryColor':'#fff9e1','tertiaryColor':'#f3e5f5'}}}%%\n`;
  mermaid += `graph TB\n`;
  mermaid += `  classDef macroStyle fill:#0288d1,stroke:#01579b,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:16px\n`;
  mermaid += `  classDef microStyle fill:#fff9e1,stroke:#f9a825,stroke-width:2px,color:#3e2723,font-size:14px\n`;
  mermaid += `  classDef loopStyle fill:#8e24aa,stroke:#4a148c,stroke-width:3px,color:#ffffff,font-weight:bold,font-size:14px\n`;
  mermaid += `  classDef exceptionStyle fill:#ffcdd2,stroke:#c62828,stroke-width:3px,stroke-dasharray:8 4,color:#b71c1c,font-weight:bold\n`;
  mermaid += `  classDef decisionStyle fill:#fff3e0,stroke:#e65100,stroke-width:3px,color:#e65100,font-weight:bold\n`;
  mermaid += `  classDef convergeStyle fill:#c8e6c9,stroke:#2e7d32,stroke-width:3px,color:#1b5e20,font-weight:bold\n\n`;

  // Get key decisions
  const methodDecision = decisions['GRAN-D-METHOD-001']?.selected_outcome || 'Wet';
  const cleaningDecision = decisions['GRAN-D-CLN-001']?.selected_outcome || 'Visual + swab';
  const calibrationDecision = decisions['GRAN-D-CAL-001']?.selected_outcome || 'Before each batch';
  const envDecision = decisions['GRAN-D-ENV-001']?.selected_outcome || 'Automated (HVAC historian)';
  
  // ========================================
  // START NODE
  // ========================================
  mermaid += `  START([🏁 START GRANULATION])\n`;
  mermaid += `  style START fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n\n`;

  // ========================================
  // STAGE 1: PRE-GRANULATION
  // ========================================
  mermaid += `  M1["🔬 PRE-GRANULATION<br/>EQUIPMENT READINESS"]\n`;
  mermaid += `  class M1 macroStyle\n`;
  mermaid += `  START --> M1\n\n`;

  mermaid += `  T101["📋 Retrieve Batch Order<br/>& Master Recipe"]\n`;
  mermaid += `  T102["🧹 Request Line<br/>Clearance"]\n`;
  mermaid += `  class T101,T102 microStyle\n`;
  mermaid += `  M1 --> T101\n`;
  mermaid += `  T101 --> T102\n\n`;

  // Cleaning verification
  mermaid += `  D103{"✓ Cleaning<br/>Valid?"}\n`;
  mermaid += `  T103A["✅ Cleaning<br/>Verification OK"]\n`;
  mermaid += `  T103B["⚠️ RE-CLEAN<br/>Equipment"]\n`;
  mermaid += `  class D103 decisionStyle\n`;
  mermaid += `  class T103A microStyle\n`;
  mermaid += `  class T103B exceptionStyle\n`;
  mermaid += `  T102 --> D103\n`;
  mermaid += `  D103 -->|YES| T103A\n`;
  mermaid += `  D103 -.->|NO| T103B\n`;
  mermaid += `  T103B -.-> T103A\n\n`;

  // Calibration check
  mermaid += `  D104{"⚖️ Instruments<br/>Calibrated?"}\n`;
  mermaid += `  T104A["✅ Calibration<br/>Valid"]\n`;
  mermaid += `  T104B["⚠️ CALIBRATE<br/>or Block"]\n`;
  mermaid += `  class D104 decisionStyle\n`;
  mermaid += `  class T104A microStyle\n`;
  mermaid += `  class T104B exceptionStyle\n`;
  mermaid += `  T103A --> D104\n`;
  mermaid += `  D104 -->|YES| T104A\n`;
  mermaid += `  D104 -.->|NO| T104B\n`;
  mermaid += `  T104B -.-> T104A\n\n`;

  // Environmental monitoring
  const envLabel = envDecision.includes('Automated') ? '🌡️ Monitor Environment<br/>T/RH - Automated' : '🌡️ Monitor Environment<br/>T/RH - Manual Entry';
  mermaid += `  T105["${envLabel}"]\n`;
  mermaid += `  class T105 microStyle\n`;
  mermaid += `  T104A --> T105\n\n`;

  mermaid += `  D106{"🌡️ Environment<br/>Within Range?"}\n`;
  mermaid += `  T106A["✅ Environment<br/>Acceptable"]\n`;
  mermaid += `  T106B["⚠️ PAUSE<br/>Deviation"]\n`;
  mermaid += `  class D106 decisionStyle\n`;
  mermaid += `  class T106A microStyle\n`;
  mermaid += `  class T106B exceptionStyle\n`;
  mermaid += `  T105 --> D106\n`;
  mermaid += `  D106 -->|YES| T106A\n`;
  mermaid += `  D106 -.->|NO| T106B\n`;
  mermaid += `  T106B -.-> T106A\n\n`;

  mermaid += `  T107["✅ Equipment<br/>Ready Sign-Off"]\n`;
  mermaid += `  class T107 convergeStyle\n`;
  mermaid += `  T106A --> T107\n\n`;

  // ========================================
  // STAGE 2: MATERIAL TRANSFER & VERIFICATION
  // ========================================
  mermaid += `  M2["📦 MATERIAL TRANSFER<br/>& VERIFICATION"]\n`;
  mermaid += `  class M2 macroStyle\n`;
  mermaid += `  T107 ==> M2\n\n`;

  const matVerification = decisions['GRAN-D-MAT-001']?.selected_outcome || 'Barcode scan mandatory';
  const containerCheck = decisions['GRAN-D-CONT-001']?.selected_outcome || 'Yes (visual + seal)';

  mermaid += `  T201["📥 Receive Dispensed<br/>Materials"]\n`;
  mermaid += `  T202["📱 ${matVerification.includes('Barcode') ? 'Barcode Scan' : 'Manual ID'}<br/>Mandatory Verification"]\n`;
  
  if (containerCheck.startsWith('Yes')) {
    const checkType = containerCheck.includes('seal') ? 'Visual + Seal Check' : 'Visual Only Check';
    mermaid += `  T203["🔍 Container Integrity<br/>${checkType}"]\n`;
  }
  
  mermaid += `  T204["✅ Material<br/>Verification Complete"]\n`;
  mermaid += `  class T201,T202,T203,T204 microStyle\n`;
  mermaid += `  M2 --> T201\n`;
  mermaid += `  T201 --> T202\n`;
  mermaid += `  T202 --> T203\n`;
  mermaid += `  T203 --> T204\n\n`;

  // ========================================
  // STAGE 3: BINDER PREPARATION (if Wet granulation)
  // ========================================
  if (methodDecision === 'Wet') {
    mermaid += `  M3["💧 BINDER SOLUTION<br/>PREPARATION"]\n`;
    mermaid += `  class M3 macroStyle\n`;
    mermaid += `  T204 ==> M3\n\n`;

    const binderPrep = decisions['GRAN-D-BINDER-001']?.selected_outcome || 'Pre-made batch in separate vessel';
    const binderQC = decisions['GRAN-D-BINDER-QC-001']?.selected_outcome || 'Concentration + pH';

    const prepLabel = binderPrep.includes('In-line') ? 'In-line Preparation' : 'Pre-Made Batch<br/>in Separate Vessel';
    mermaid += `  T301["⚗️ ${prepLabel}"]\n`;
    
    const qcLabel = binderQC.includes('Concentration') ? 'Concentration + pH' : binderQC.includes('Visual') ? 'Visual Only' : 'No QC';
    mermaid += `  T302["🧪 QC Testing<br/>${qcLabel}"]\n`;
    mermaid += `  T303["✅ Binder Solution<br/>Approved"]\n`;
    mermaid += `  class T301,T302,T303 microStyle\n`;
    mermaid += `  M3 --> T301\n`;
    mermaid += `  T301 --> T302\n`;
    mermaid += `  T302 --> T303\n\n`;
  }

  // ========================================
  // STAGE 4: GRANULATION PROCESS
  // ========================================
  mermaid += `  M4["🔄 GRANULATION<br/>PROCESS"]\n`;
  mermaid += `  class M4 macroStyle\n`;
  mermaid += `  ${methodDecision === 'Wet' ? 'T303' : 'T204'} ==> M4\n\n`;

  const recipeSource = decisions['GRAN-D-RECIPE-001']?.selected_outcome || 'MES master recipe';
  const scadaIntegration = decisions['GRAN-D-SCADA-001']?.selected_outcome || 'Yes (automated setpoints)';
  
  mermaid += `  T401["📋 Load ${recipeSource.includes('MES') ? 'MES Master' : recipeSource.includes('ERP') ? 'ERP' : 'Manual'}<br/>Recipe & Setpoints"]\n`;
  
  if (scadaIntegration.includes('Yes')) {
    mermaid += `  T402["🎛️ Configure SCADA<br/>Automated Setpoints"]\n`;
  } else {
    mermaid += `  T402["🎛️ Configure Process<br/>Manual Setpoints"]\n`;
  }
  
  mermaid += `  class T401,T402 microStyle\n`;
  mermaid += `  M4 --> T401\n`;
  mermaid += `  T401 --> T402\n\n`;

  // Setpoint validation
  if (methodDecision === 'Wet') {
    mermaid += `  D403{"⚙️ Wet Granulation<br/>Setpoints OK?"}\n`;
  } else if (methodDecision === 'Dry') {
    mermaid += `  D403{"⚙️ Dry Granulation<br/>Parameters OK?"}\n`;
  } else {
    mermaid += `  D403{"⚙️ Melt Granulation<br/>Setpoints OK?"}\n`;
  }
  
  mermaid += `  T403A["✅ Setpoints<br/>Within Range"]\n`;
  mermaid += `  T403B["⚠️ ADJUST<br/>or Block"]\n`;
  mermaid += `  class D403 decisionStyle\n`;
  mermaid += `  class T403A microStyle\n`;
  mermaid += `  class T403B exceptionStyle\n`;
  mermaid += `  T402 --> D403\n`;
  mermaid += `  D403 -->|YES| T403A\n`;
  mermaid += `  D403 -.->|NO| T403B\n`;
  mermaid += `  T403B -.-> T403A\n\n`;

  // Process execution
  if (methodDecision === 'Wet') {
    const binderMode = decisions['GRAN-D-WET-PARAM-001']?.selected_outcome || 'Continuous spray';
    const modeLabel = binderMode.includes('Continuous') ? 'Continuous Spray' : binderMode.includes('Batch') ? 'Batch Addition' : 'Dual-Phase';
    mermaid += `  T404["💧 ${modeLabel}<br/>Binder Addition"]\n`;
  } else if (methodDecision === 'Dry') {
    mermaid += `  T404["🔨 Roller Compaction<br/>Process"]\n`;
  } else {
    mermaid += `  T404["🌡️ Melt Process<br/>Execution"]\n`;
  }
  
  const dataCapture = decisions['GRAN-D-CAPTURE-001']?.selected_outcome || 'Automated (SCADA historian)';
  const captureLabel = dataCapture.includes('Automated') ? 'Automated Data<br/>Capture - SCADA' : 'Manual Entry<br/>with E-Sign';
  
  mermaid += `  T405["🔄 ${captureLabel}"]\n`;
  mermaid += `  T406["📊 Monitor Process<br/>Parameters"]\n`;
  mermaid += `  class T404,T405,T406 microStyle\n`;
  mermaid += `  T403A --> T404\n`;
  mermaid += `  T404 --> T405\n`;
  mermaid += `  T405 --> T406\n\n`;

  // Endpoint check
  mermaid += `  D407{"🎯 Endpoint<br/>Reached?"}\n`;
  mermaid += `  class D407 decisionStyle\n`;
  mermaid += `  T406 --> D407\n`;
  mermaid += `  D407 -.->|NO - Continue| T406\n`;
  mermaid += `  D407 -->|YES| T408\n\n`;

  mermaid += `  T408["🛑 Stop Granulation<br/>Process"]\n`;
  mermaid += `  class T408 microStyle\n\n`;

  // Equipment failure check
  mermaid += `  D409{"🔧 Equipment<br/>Failure?"}\n`;
  mermaid += `  T409A["✅ Process<br/>Complete"]\n`;
  mermaid += `  T409B["⚠️ TERMINATE<br/>Batch"]\n`;
  mermaid += `  class D409 decisionStyle\n`;
  mermaid += `  class T409A microStyle\n`;
  mermaid += `  class T409B exceptionStyle\n`;
  mermaid += `  T408 --> D409\n`;
  mermaid += `  D409 -->|NO| T409A\n`;
  mermaid += `  D409 -.->|YES - Cannot Recover| T409B\n\n`;

  // IPC Testing
  const ipcPolicy = decisions['GRAN-D-IPC-001']?.selected_outcome || 'All batches';
  const limsIntegration = decisions['GRAN-D-LIMS-001']?.selected_outcome || 'Manual entry with reference';
  
  mermaid += `  T410["🧪 IPC Testing<br/>Moisture/PSD/Bulk Density"]\n`;
  
  const limsLabel = limsIntegration.includes('Full') ? 'Auto-Import from LIMS' : 'Manual Entry<br/>with Reference to LIMS';
  mermaid += `  T411["📤 ${limsLabel}"]\n`;
  mermaid += `  class T410,T411 microStyle\n`;
  mermaid += `  T409A --> T410\n`;
  mermaid += `  T410 --> T411\n\n`;

  // IPC results check
  mermaid += `  D412{"📊 IPC Results<br/>Within Spec?"}\n`;
  mermaid += `  T412A["✅ IPC<br/>Acceptable"]\n`;
  
  const deviationSystem = decisions['GRAN-D-DEVIATION-001']?.selected_outcome || 'MES-integrated deviation module';
  const devLabel = deviationSystem.includes('MES') ? 'MES Integrated' : deviationSystem.includes('External') ? 'External QMS' : 'Both Systems';
  mermaid += `  T412B["⚠️ DEVIATION<br/>Workflow - ${devLabel}"]\n`;
  
  mermaid += `  class D412 decisionStyle\n`;
  mermaid += `  class T412A microStyle\n`;
  mermaid += `  class T412B exceptionStyle\n`;
  mermaid += `  T411 --> D412\n`;
  mermaid += `  D412 -->|YES| T412A\n`;
  mermaid += `  D412 -.->|NO| T412B\n`;
  mermaid += `  T412B -.-> T412A\n\n`;

  // Auto-calculations
  const autoCalc = decisions['GRAN-D-CALC-001']?.selected_outcome || 'Enabled (binder %, yield)';
  if (autoCalc.includes('Enabled')) {
    mermaid += `  T413["🧮 Auto-Calculate<br/>Binder % & Yield"]\n`;
    mermaid += `  class T413 microStyle\n`;
    mermaid += `  T412A --> T413\n\n`;
  }

  // ========================================
  // STAGE 5: POST-GRANULATION
  // ========================================
  mermaid += `  M5["📤 POST-GRANULATION<br/>HANDLING"]\n`;
  mermaid += `  class M5 macroStyle\n`;
  mermaid += `  ${autoCalc.includes('Enabled') ? 'T413' : 'T412A'} ==> M5\n\n`;

  const labelingReq = decisions['GRAN-D-LABEL-001']?.selected_outcome || 'GS1-128 barcode + manual fields';
  const retainPolicy = decisions['GRAN-D-RETAIN-001']?.selected_outcome || 'Mandatory with chain-of-custody';
  const transferDest = decisions['GRAN-D-TRANSFER-001']?.selected_outcome || 'Intermediate hold area';
  
  const labelType = labelingReq.includes('GS1') ? 'GS1-128<br/>Barcode + Manual Fields' : labelingReq.includes('Standard') ? 'Standard Label<br/>+ E-Record' : 'Minimal<br/>Batch ID Only';
  
  mermaid += `  T501["🏷️ Print ${labelType}"]\n`;
  mermaid += `  T502["✅ Label<br/>Verification"]\n`;
  
  if (retainPolicy.includes('Mandatory')) {
    const retainLabel = retainPolicy.includes('chain') ? 'with Chain-of-Custody' : 'No Tracking';
    mermaid += `  T503["🧪 Collect Retain Sample<br/>${retainLabel}"]\n`;
  }
  
  const transferLabel = transferDest.includes('Direct') ? 'Direct to<br/>Next Stage' : transferDest.includes('Intermediate') ? 'Intermediate Hold Area' : 'Conditional<br/>QA Decision';
  mermaid += `  T504["📍 Transfer to<br/>${transferLabel}"]\n`;
  
  mermaid += `  class T501,T502,T503,T504 microStyle\n`;
  mermaid += `  M5 --> T501\n`;
  mermaid += `  T501 --> T502\n`;
  mermaid += `  T502 --> T503\n`;
  mermaid += `  T503 --> T504\n\n`;

  // QA Release decision
  mermaid += `  D505{"👨‍🔬 QA Release<br/>Decision?"}\n`;
  mermaid += `  T505A["✅ Released"]\n`;
  mermaid += `  T505B["⛔ Hold"]\n`;
  mermaid += `  T505C["🔄 Conditional<br/>Rework"]\n`;
  mermaid += `  class D505 decisionStyle\n`;
  mermaid += `  class T505A convergeStyle\n`;
  mermaid += `  class T505B exceptionStyle\n`;
  mermaid += `  class T505C exceptionStyle\n`;
  mermaid += `  T504 --> D505\n`;
  mermaid += `  D505 -->|APPROVED| T505A\n`;
  mermaid += `  D505 -.->|REJECTED| T505B\n`;
  mermaid += `  D505 -.->|CONDITIONAL| T505C\n\n`;

  // Yield variance check
  const yieldThreshold = decisions['GRAN-D-YIELD-001']?.selected_outcome || '±5%';
  mermaid += `  T506["📊 Yield Variance<br/>Check ${yieldThreshold}"]\n`;
  mermaid += `  class T506 microStyle\n`;
  mermaid += `  T505A --> T506\n\n`;

  mermaid += `  D507{"📉 Variance<br/>Within Threshold?"}\n`;
  mermaid += `  T507A["✅ Yield<br/>Acceptable"]\n`;
  mermaid += `  T507B["⚠️ INVESTIGATION<br/>Triggered"]\n`;
  mermaid += `  class D507 decisionStyle\n`;
  mermaid += `  class T507A microStyle\n`;
  mermaid += `  class T507B exceptionStyle\n`;
  mermaid += `  T506 --> D507\n`;
  mermaid += `  D507 -->|YES - Within ${yieldThreshold}| T507A\n`;
  mermaid += `  D507 -.->|NO - Exceeds ${yieldThreshold}| T507B\n`;
  mermaid += `  T507B -.-> T507A\n\n`;

  // Cleaning
  const cleaningFreq = decisions['GRAN-D-CLEAN-POLICY-001']?.selected_outcome || 'After each batch';
  const cleanLabel = cleaningFreq.includes('each batch') ? 'After Each Batch' : cleaningFreq.includes('campaign') ? 'After Campaign' : 'After Product Change';
  
  mermaid += `  T508["🧹 Initiate Cleaning<br/>${cleanLabel}"]\n`;
  mermaid += `  class T508 microStyle\n`;
  mermaid += `  T507A --> T508\n\n`;

  // ========================================
  // STAGE 6: CLOSEOUT
  // ========================================
  mermaid += `  M6["📋 BATCH RECORD<br/>CLOSEOUT"]\n`;
  mermaid += `  class M6 macroStyle\n`;
  mermaid += `  T508 ==> M6\n\n`;

  const ebmrPolicy = decisions['GRAN-D-EBMR-001']?.selected_outcome || 'Full electronic (21 CFR Part 11)';
  const erpPosting = decisions['GRAN-D-ERP-POST-001']?.selected_outcome || 'On QA approval';
  
  const ebmrLabel = ebmrPolicy.includes('Full electronic') ? 'Full<br/>Electronic eBMR' : ebmrPolicy.includes('Hybrid') ? 'Hybrid<br/>E-Record + Paper' : 'Paper<br/>Only';
  
  mermaid += `  T601["📝 Generate ${ebmrLabel}"]\n`;
  
  if (ebmrPolicy.includes('21 CFR Part 11')) {
    mermaid += `  T602["✍️ 21 CFR Part 11<br/>Electronic Signatures"]\n`;
  } else {
    mermaid += `  T602["✍️ Sign Batch<br/>Record"]\n`;
  }
  
  const postingLabel = erpPosting.includes('Real-time') ? 'Real-Time<br/>at Completion' : erpPosting.includes('Batch') ? 'Batch<br/>End of Shift' : 'On QA Approval';
  mermaid += `  T603["📊 ERP Posting<br/>${postingLabel}"]\n`;
  
  mermaid += `  class T601,T602,T603 microStyle\n`;
  mermaid += `  M6 --> T601\n`;
  mermaid += `  T601 --> T602\n`;
  mermaid += `  T602 --> T603\n\n`;

  // QA Batch Review
  mermaid += `  D604{"👨‍🔬 QA Batch<br/>Review?"}\n`;
  mermaid += `  T604A["✅ Batch<br/>Approved"]\n`;
  mermaid += `  T604B["⛔ Batch<br/>Rejected"]\n`;
  mermaid += `  T604C["⏸️ Pending<br/>Investigation"]\n`;
  mermaid += `  class D604 decisionStyle\n`;
  mermaid += `  class T604A convergeStyle\n`;
  mermaid += `  class T604B exceptionStyle\n`;
  mermaid += `  class T604C exceptionStyle\n`;
  mermaid += `  T603 --> D604\n`;
  mermaid += `  D604 -->|APPROVED| T604A\n`;
  mermaid += `  D604 -.->|REJECTED| T604B\n`;
  mermaid += `  D604 -.->|CONDITIONAL| T604C\n\n`;

  // Archive
  const archivePolicy = decisions['GRAN-D-ARCHIVE-001']?.selected_outcome || 'Electronic archive (validated system)';
  const archiveLabel = archivePolicy.includes('Electronic archive') ? 'Electronic Archive<br/>Validated System' : archivePolicy.includes('Paper + electronic') ? 'Paper + Electronic<br/>Archive' : 'Site-Specific<br/>Archive';
  
  mermaid += `  T605["📁 ${archiveLabel}"]\n`;
  mermaid += `  T606["✅ Records Retention<br/>per Policy"]\n`;
  mermaid += `  class T605,T606 microStyle\n`;
  mermaid += `  T604A --> T605\n`;
  mermaid += `  T605 --> T606\n\n`;

  // ========================================
  // END NODE
  // ========================================
  mermaid += `  COMPLETE([🎉 GRANULATION COMPLETE])\n`;
  mermaid += `  style COMPLETE fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n`;
  mermaid += `  T606 ==> COMPLETE\n`;

  return mermaid;
}

// Initialize MCP Server
const server = new Server(
  {
    name: 'mes-workflow-server',
    version: '3.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_decisions',
      description: 'Get all decision questions for a manufacturing stage. Use this to understand what questions need to be answered for workflow configuration. Supports Dispensing and Granulation stages.',
      inputSchema: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            description: 'Stage name: Dispensing stages: "Pre-Dispensing", "Material Allocation", "Weighing & Dispensing", "Labeling & Documentation", "Post-Dispensing"; Granulation stages: "Pre-Granulation", "Material Transfer & Verification", "Binder Preparation", "Granulation", "Post-Granulation", "Closeout"; or "All" for all stages',
          },
          category: {
            type: 'string',
            description: 'Optional filter by category: "Practice" (configuration decisions) or "Runtime" (exception conditions)',
          },
        },
      },
    },
    {
      name: 'get_decision_details',
      description: 'Get detailed information about a specific decision including its question, outcomes, and which tasks it affects.',
      inputSchema: {
        type: 'object',
        properties: {
          decision_id: {
            type: 'string',
            description: 'The decision ID (e.g., Q-ERP-01, Q-SEC-01 for Dispensing; GRAN-D-METHOD-001, GRAN-D-ENDPOINT-001 for Granulation)',
          },
        },
        required: ['decision_id'],
      },
    },
    {
      name: 'save_client_decision',
      description: 'Save a client\'s answer to a decision question. Always validate that the selected outcome matches one of the valid outcomes for that decision.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          decision_id: {
            type: 'string',
            description: 'The decision ID (e.g., Q-ERP-01)',
          },
          selected_outcome: {
            type: 'string',
            description: 'The chosen outcome (must match one of the decision\'s valid outcomes exactly)',
          },
          rationale: {
            type: 'string',
            description: 'Optional explanation of why this choice was made',
          },
        },
        required: ['client_name', 'decision_id', 'selected_outcome'],
      },
    },
    {
      name: 'get_client_decisions',
      description: 'Get all decisions already answered by a client. Use this to check what has been configured and what still needs to be answered.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
        },
        required: ['client_name'],
      },
    },
    {
      name: 'list_clients',
      description: 'Get a list of all clients that have been configured in the system.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'generate_workflow',
      description: 'Generate a Mermaid workflow diagram based on client decisions and automatically save it to client_workflows.json. This filters tasks based on Practice decisions and shows all Runtime exception paths. Version 3.0 includes Dispensing and Granulation stages with beautiful enhanced UI, emojis, and professional styling.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          stage: {
            type: 'string',
            description: `Stage to generate workflow for:
            
    **Complete Workflows:**
    - "All" - Both Dispensing + Granulation combined (full end-to-end)
    - "Complete-Dispensing" - All 5 Dispensing stages only
    - "Complete-Granulation" - All 6 Granulation stages only

    **Individual Dispensing Stages:**
    - "Pre-Dispensing"
    - "Material Allocation"
    - "Weighing & Dispensing"
    - "Labeling & Documentation"
    - "Post-Dispensing"

    **Individual Granulation Stages:**
    - "Pre-Granulation"
    - "Material Transfer & Verification"
    - "Binder Preparation"
    - "Granulation"
    - "Post-Granulation"
    - "Closeout"`,
          },
        },
        required: ['client_name', 'stage'],
      },
    },
    {
      name: 'get_saved_workflow',
      description: 'Retrieve the most recently generated workflow for a client from client_workflows.json.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
        },
        required: ['client_name'],
      },
    },
    {
      name: 'export_workflow',
      description: 'Export a client\'s saved workflow as a PNG image to the exports/[client_name]/ directory. This creates a timestamped file for the finalized workflow.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          format: {
            type: 'string',
            description: 'Export format (currently only "png" is supported)',
            enum: ['png'],
          },
        },
        required: ['client_name'],
      },
    },
    {
      name: 'list_exports',
      description: 'List all exported workflow files for a specific client.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
        },
        required: ['client_name'],
      },
    },
    {
      name: 'get_unanswered_decisions',
      description: 'Get list of Practice decisions that still need to be answered for a client. Useful to determine what questions to ask next.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          stage: {
            type: 'string',
            description: 'Optional: filter by specific stage',
          },
        },
        required: ['client_name'],
      },
    },
    {
      name: 'validate_workflow',
      description: 'Validate a generated workflow for disconnected nodes, missing edges, and structural issues.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          stage: {
            type: 'string',
            description: 'Stage to validate',
          },
        },
        required: ['client_name', 'stage'],
      },
    },
  ],
}));

// Tool handlers
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_decisions': {
        const { stage, category } = args as { stage?: string; category?: string };
        const allDecisions = await loadDecisions();

        let filtered = allDecisions;

        if (stage && stage !== 'All') {
          filtered = filtered.filter((d) => d.stage === stage);
        }

        if (category) {
          filtered = filtered.filter((d) => d.category === category);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Found ${filtered.length} decision(s):\n\n${filtered
                .map(
                  (d) =>
                    `**${d.id}** (${d.category})\nQuestion: ${d.question}\nOutcomes: ${d.outcomes.join(', ')}\nStage: ${d.stage}\nAffects: ${d.affects}\n`
                )
                .join('\n')}`,
            },
          ],
        };
      }

      case 'get_decision_details': {
        const { decision_id } = args as { decision_id: string };
        const decisions = await loadDecisions();
        const tasks = await loadTasks();

        const decision = decisions.find((d) => d.id === decision_id);

        if (!decision) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Decision ${decision_id} not found`,
              },
            ],
            isError: true,
          };
        }

        const affectedTasks = tasks.filter((t) => t.decision_id === decision_id);

        return {
          content: [
            {
              type: 'text',
              text: `**${decision.id}** - ${decision.category}\n\nQuestion: ${decision.question}\n\nValid Outcomes:\n${decision.outcomes.map((o) => `  - ${o}`).join('\n')}\n\nStage: ${decision.stage}\nAffects: ${decision.affects}\nNotes: ${decision.notes}\n\nThis decision affects ${affectedTasks.length} task(s):\n${affectedTasks.map((t) => `  - ${t.id}: ${t.name} (when outcome = "${t.decision_outcome}")`).join('\n')}`,
            },
          ],
        };
      }

      case 'save_client_decision': {
        const { client_name, decision_id, selected_outcome, rationale } = args as {
          client_name: string;
          decision_id: string;
          selected_outcome: string;
          rationale?: string;
        };

        const decisions = await loadDecisions();
        const decision = decisions.find((d) => d.id === decision_id);

        if (!decision) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Decision ${decision_id} not found`,
              },
            ],
            isError: true,
          };
        }

        if (!decision.outcomes.includes(selected_outcome)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Invalid outcome "${selected_outcome}". Valid options are: ${decision.outcomes.join(', ')}`,
              },
            ],
            isError: true,
          };
        }

        const clientDecisions = await loadClientDecisions();

        if (!clientDecisions[client_name]) {
          clientDecisions[client_name] = {};
        }

        clientDecisions[client_name][decision_id] = {
          selected_outcome,
          rationale: rationale || '',
          timestamp: new Date().toISOString(),
        };

        await saveClientDecisions(clientDecisions);

        return {
          content: [
            {
              type: 'text',
              text: `✅ Saved: ${decision_id} = "${selected_outcome}" for ${client_name}`,
            },
          ],
        };
      }

      case 'get_client_decisions': {
        const { client_name } = args as { client_name: string };
        const clientDecisions = await loadClientDecisions();

        const decisions = clientDecisions[client_name] || {};
        const count = Object.keys(decisions).length;

        if (count === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No decisions configured yet for ${client_name}`,
              },
            ],
          };
        }

        const formatted = Object.entries(decisions)
          .map(
            ([id, data]) =>
              `  - **${id}**: ${data.selected_outcome}${data.rationale ? ` (${data.rationale})` : ''}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Decisions for ${client_name} (${count} total):\n\n${formatted}`,
            },
          ],
        };
      }

      case 'list_clients': {
        const clientDecisions = await loadClientDecisions();
        const clients = Object.keys(clientDecisions);

        if (clients.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No clients configured yet. Start by saving decisions for a new client.',
              },
            ],
          };
        }

        const formatted = clients
          .map((name) => {
            const decisionCount = Object.keys(clientDecisions[name]).length;
            return `  - ${name} (${decisionCount} decisions configured)`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text',
              text: `Configured clients:\n\n${formatted}`,
            },
          ],
        };
      }

      case 'get_unanswered_decisions': {
        const { client_name, stage } = args as { client_name: string; stage?: string };
        const decisions = await loadDecisions();
        const clientDecisions = await loadClientDecisions();

        const answered = clientDecisions[client_name] || {};
        const answeredIds = Object.keys(answered);

        let practiceDecisions = decisions.filter((d) => d.category === 'Practice');

        if (stage) {
          practiceDecisions = practiceDecisions.filter((d) => d.stage === stage);
        }

        const unanswered = practiceDecisions.filter((d) => !answeredIds.includes(d.id));

        if (unanswered.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `All Practice decisions have been answered for ${client_name}${stage ? ` in stage "${stage}"` : ''}! Ready to generate workflow.`,
              },
            ],
          };
        }

        const formatted = unanswered
          .map((d) => `  - **${d.id}**: ${d.question}\n    Outcomes: ${d.outcomes.join(', ')}`)
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Unanswered Practice decisions for ${client_name} (${unanswered.length} remaining):\n\n${formatted}`,
            },
          ],
        };
      }

      case 'validate_workflow': {
        const { client_name, stage } = args as { client_name: string; stage: string };

        const clientDecisions = await loadClientDecisions();
        const decisions = clientDecisions[client_name] || {};
        const allTasks = await loadTasks();

        // Filter tasks using helper function
        let filteredTasks = allTasks.filter((task) => {
          if (stage !== 'All' && task.stage !== stage) return false;
          return shouldIncludeTask(task, decisions);
        });

        const includedTaskIds = new Set(filteredTasks.map((t) => t.id));
        const issues: string[] = [];

        // Check for orphaned nodes
        for (const task of filteredTasks) {
          if (task.predecessors && task.predecessors.length > 0) {
            const hasValidPredecessor = task.predecessors.some((pred) => includedTaskIds.has(pred));

            if (!hasValidPredecessor) {
              const closestAncestor = findClosestIncludedAncestor(task, allTasks, includedTaskIds);
              if (!closestAncestor) {
                issues.push(`⚠️ ${task.id} (${task.name}) has no valid predecessors - orphaned node`);
              } else {
                issues.push(
                  `ℹ️ ${task.id} linked to distant ancestor ${closestAncestor} (immediate predecessors excluded)`
                );
              }
            }
          }
        }

        // Check for missing loop back edges
        const loopEnds = filteredTasks.filter((t) => t.type === 'Loop-End');
        for (const loopEnd of loopEnds) {
          const loopStartId = findLoopStart(loopEnd.id);
          if (!includedTaskIds.has(loopStartId)) {
            issues.push(`⚠️ ${loopEnd.id} loop end exists but ${loopStartId} loop start is missing`);
          }
        }

        if (issues.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `✅ Workflow validation passed for ${client_name} - ${stage}\n\nNo structural issues found. All nodes are properly connected.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: `Workflow validation for ${client_name} - ${stage}:\n\n${issues.join('\n')}\n\n${issues.filter((i) => i.startsWith('⚠️')).length} warnings, ${issues.filter((i) => i.startsWith('ℹ️')).length} info messages`,
            },
          ],
        };
      }

      // Replace the existing 'generate_workflow' case in the CallToolRequestSchema handler

      case 'generate_workflow': {
        const { client_name, stage } = args as { client_name: string; stage: string };

        const clientDecisions = await loadClientDecisions();
        const decisions = clientDecisions[client_name] || {};

        if (Object.keys(decisions).length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `Cannot generate workflow: No decisions configured for ${client_name}. Please answer decision questions first.`,
              },
            ],
            isError: true,
          };
        }

        const allTasks = await loadTasks();

        // Define stage groups
        const granulationStages = [
          'Pre-Granulation',
          'Material Transfer & Verification',
          'Binder Preparation',
          'Granulation',
          'Post-Granulation',
          'Closeout'
        ];
        
        const dispensingStages = [
          'Pre-Dispensing',
          'Material Allocation',
          'Weighing & Dispensing',
          'Labeling & Documentation',
          'Post-Dispensing'
        ];

        let mermaid: string;
        let workflowType: string;
        let filteredTasks: Task[];

        // Determine workflow type based on stage parameter
        if (stage === 'All') {
          // Generate BOTH Dispensing AND Granulation workflows combined
          workflowType = 'Complete (Dispensing + Granulation)';
          
          filteredTasks = allTasks.filter((task) => {
            return shouldIncludeTask(task, decisions);
          });
          
          // Generate Dispensing part
          const dispensingTasks = filteredTasks.filter(t => dispensingStages.includes(t.stage));
          const dispensingMermaid = generateBeautifulMermaidDiagram(dispensingTasks, allTasks, decisions, client_name);
          
          // Generate Granulation part
          const granulationTasks = filteredTasks.filter(t => granulationStages.includes(t.stage));
          const granulationMermaid = generateGranulationWorkflow(granulationTasks, allTasks, decisions, client_name);
          
          // Combine them (remove duplicate headers from second diagram)
          const granulationBody = granulationMermaid.split('\n').slice(9).join('\n'); // Skip header and class definitions
          mermaid = dispensingMermaid.replace(/COMPLETE\([🎉 DISPENSING COMPLETE]\)[\s\S]*$/, '') + 
                    '\n\n' +
                    '  DISP_COMPLETE([🎉 DISPENSING COMPLETE])\n' +
                    '  style DISP_COMPLETE fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n' +
                    '  T055 ==> DISP_COMPLETE\n\n' +
                    '  DISP_COMPLETE ==> START_GRAN\n' +
                    '  START_GRAN([🔗 BEGIN GRANULATION])\n' +
                    '  style START_GRAN fill:#ff9800,stroke:#e65100,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n\n' +
                    granulationBody;
                    
        } else if (stage === 'Complete-Dispensing') {
          // Generate ONLY complete Dispensing workflow (all dispensing stages)
          workflowType = 'Complete Dispensing Workflow';
          
          filteredTasks = allTasks.filter((task) => {
            if (!dispensingStages.includes(task.stage)) {
              return false;
            }
            return shouldIncludeTask(task, decisions);
          });
          
          mermaid = generateBeautifulMermaidDiagram(filteredTasks, allTasks, decisions, client_name);
          
        } else if (stage === 'Complete-Granulation') {
          // Generate ONLY complete Granulation workflow (all granulation stages)
          workflowType = 'Complete Granulation Workflow';
          
          filteredTasks = allTasks.filter((task) => {
            if (!granulationStages.includes(task.stage)) {
              return false;
            }
            return shouldIncludeTask(task, decisions);
          });
          
          mermaid = generateGranulationWorkflow(filteredTasks, allTasks, decisions, client_name);
          
        } else if (granulationStages.includes(stage)) {
          // Generate specific Granulation stage
          workflowType = `Granulation - ${stage}`;
          
          filteredTasks = allTasks.filter((task) => {
            if (task.stage !== stage) {
              return false;
            }
            return shouldIncludeTask(task, decisions);
          });
          
          mermaid = generateGranulationWorkflow(filteredTasks, allTasks, decisions, client_name);
          
        } else if (dispensingStages.includes(stage)) {
          // Generate specific Dispensing stage
          workflowType = `Dispensing - ${stage}`;
          
          filteredTasks = allTasks.filter((task) => {
            if (task.stage !== stage) {
              return false;
            }
            return shouldIncludeTask(task, decisions);
          });
          
          mermaid = generateBeautifulMermaidDiagram(filteredTasks, allTasks, decisions, client_name);
          
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `Error: Unknown stage "${stage}". Valid options are:

      **Complete Workflows:**
      - "All" - Both Dispensing + Granulation combined
      - "Complete-Dispensing" - All Dispensing stages only
      - "Complete-Granulation" - All Granulation stages only

      **Individual Dispensing Stages:**
      ${dispensingStages.map(s => `- "${s}"`).join('\n')}

      **Individual Granulation Stages:**
      ${granulationStages.map(s => `- "${s}"`).join('\n')}`,
              },
            ],
            isError: true,
          };
        }

        // Calculate metadata
        const metadata: WorkflowMetadata = {
          task_count: filteredTasks.length,
          decision_count: Object.keys(decisions).length,
          macro_count: filteredTasks.filter((t) => t.type === 'Macro').length,
          loop_count: filteredTasks.filter((t) => t.type.includes('Loop')).length,
        };

        // Load existing workflows and update
        const clientWorkflows = await loadClientWorkflows();
        const existingVersion = clientWorkflows[client_name]?.version || 0;

        clientWorkflows[client_name] = {
          last_generated: new Date().toISOString(),
          stage: workflowType,
          version: existingVersion + 1,
          mermaid_code: mermaid,
          metadata: metadata,
        };

        await saveClientWorkflows(clientWorkflows);

        // Create summary
        const summary = `## Workflow Generated for ${client_name} - ${workflowType}

      **✅ Auto-saved to client_workflows.json (Version ${clientWorkflows[client_name].version})**

      **Configuration Summary:**
      - Total tasks in library: ${allTasks.length}
      - Tasks included in workflow: ${metadata.task_count}
        - Macro stages: ${metadata.macro_count}
        - Micro tasks: ${metadata.task_count - metadata.macro_count - metadata.loop_count}
        - Loop constructs: ${metadata.loop_count}

      **Applied Decisions (${metadata.decision_count}):**
      ${Object.entries(decisions)
        .slice(0, 10)
        .map(([id, data]) => `- ${id} = "${data.selected_outcome}"`)
        .join('\n')}${Object.keys(decisions).length > 10 ? `\n... and ${Object.keys(decisions).length - 10} more` : ''}

      **Features in v3.0:**
      ✅ Support for Dispensing and Granulation stages (11 total stages)
      ✅ Beautiful enhanced UI with emojis and professional colors
      ✅ Clear START 🏁 and COMPLETE 🎉 nodes
      ✅ Visual hierarchy with blue macros and purple loops
      ✅ Exception paths highlighted in red dashed boxes
      ✅ Decision diamonds in orange for runtime conditions

      **Workflow Diagram:**

      \`\`\`mermaid
      ${mermaid}
      \`\`\`

      **Next Steps:**
      - Review the workflow above
      - Make any necessary decision changes and regenerate
      - When finalized, use \`export_workflow\` to create a PNG deliverable

      **Note:** This workflow has been automatically saved. You can retrieve it anytime using \`get_saved_workflow\`.`;

        return {
          content: [
            {
              type: 'text',
              text: summary,
            },
          ],
        };
      }

      case 'get_saved_workflow': {
        const { client_name } = args as { client_name: string };
        const clientWorkflows = await loadClientWorkflows();

        const workflow = clientWorkflows[client_name];

        if (!workflow) {
          return {
            content: [
              {
                type: 'text',
                text: `No saved workflow found for ${client_name}. Generate a workflow first using \`generate_workflow\`.`,
              },
            ],
            isError: true,
          };
        }

        const summary = `## Saved Workflow for ${client_name}

**Last Generated:** ${new Date(workflow.last_generated).toLocaleString()}
**Stage:** ${workflow.stage}
**Version:** ${workflow.version}

**Metadata:**
- Tasks: ${workflow.metadata.task_count}
- Decisions: ${workflow.metadata.decision_count}
- Macro Stages: ${workflow.metadata.macro_count}
- Loop Constructs: ${workflow.metadata.loop_count}

**Workflow Diagram:**

\`\`\`mermaid
${workflow.mermaid_code}
\`\`\`

**Actions:**
- Regenerate: Use \`generate_workflow\` to update
- Export: Use \`export_workflow\` to create PNG file`;

        return {
          content: [
            {
              type: 'text',
              text: summary,
            },
          ],
        };
      }

      case 'export_workflow': {
        const { client_name, format } = args as { client_name: string; format?: string };
        
        const exportFormat = format || 'png';
        
        // Load saved workflow
        const clientWorkflows = await loadClientWorkflows();
        const workflow = clientWorkflows[client_name];

        if (!workflow) {
          return {
            content: [
              {
                type: 'text',
                text: `No saved workflow found for ${client_name}. Generate a workflow first using \`generate_workflow\`.`,
              },
            ],
            isError: true,
          };
        }

        // Ensure client export directory exists
        const clientDir = await ensureClientExportDir(client_name);

        // Create timestamped filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const mmdFilename = `workflow_${workflow.stage.replace(/\s+/g, '-')}_${timestamp}.mmd`;
        const outputFilename = `workflow_${workflow.stage.replace(/\s+/g, '-')}_${timestamp}.${exportFormat}`;
        const mmdPath = path.join(clientDir, mmdFilename);
        const outputPath = path.join(clientDir, outputFilename);

        try {
          // Write Mermaid code to .mmd file
          await fs.writeFile(mmdPath, workflow.mermaid_code, 'utf-8');

          // Use child_process exec for simpler command execution
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          
          // Build the command with proper quoting for Windows paths
          const command = `npx mmdc -i "${mmdPath}" -o "${outputPath}" -b white -w 2400 -H 3000`;

          // Execute the command
          const { stdout, stderr } = await execAsync(command, {
            cwd: path.join(__dirname, '..'),
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
          });

          // Get file size for reporting
          const stats = await fs.stat(outputPath);
          const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

          return {
            content: [
              {
                type: 'text',
                text: `✅ Workflow exported successfully!

      **Client:** ${client_name}
      **File:** ${outputFilename}
      **Location:** ${outputPath}
      **Stage:** ${workflow.stage}
      **Version:** ${workflow.version}
      **Format:** ${exportFormat.toUpperCase()}
      **Resolution:** 2400x3000px
      **File Size:** ${fileSizeMB} MB

      **Source File:** ${mmdFilename} (Mermaid source code)

      The workflow diagram has been saved and is ready for client delivery.`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error exporting workflow: ${error instanceof Error ? error.message : String(error)}

      **Debug Info:**
      Input file: ${mmdPath}
      Output file: ${outputPath}

      **Troubleshooting:**
      - Try running manually: npx mmdc -i "${mmdPath}" -o "${outputPath}"
      - Ensure @mermaid-js/mermaid-cli is installed: npm list @mermaid-js/mermaid-cli
      - Check if Chromium was downloaded: npx puppeteer browsers install chrome`,
              },
            ],
            isError: true,
          };
        }
      }

      case 'list_exports': {
        const { client_name } = args as { client_name: string };

        const clientDir = path.join(EXPORTS_DIR, client_name);

        if (!existsSync(clientDir)) {
          return {
            content: [
              {
                type: 'text',
                text: `No exports found for ${client_name}. Export a workflow first using \`export_workflow\`.`,
              },
            ],
          };
        }

        const files = await fs.readdir(clientDir);
        const pngFiles = files.filter((f) => f.endsWith('.png'));

        if (pngFiles.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No PNG exports found for ${client_name}.`,
              },
            ],
          };
        }

        // Get file stats for each export
        const fileDetails = await Promise.all(
          pngFiles.map(async (filename) => {
            const filepath = path.join(clientDir, filename);
            const stats = await fs.stat(filepath);
            return {
              filename,
              size: (stats.size / 1024).toFixed(2) + ' KB',
              created: stats.birthtime.toLocaleString(),
            };
          })
        );

        const formatted = fileDetails
          .sort((a, b) => b.filename.localeCompare(a.filename)) // Most recent first
          .map((f) => `  - ${f.filename}\n    Size: ${f.size}, Created: ${f.created}`)
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `## Exported Workflows for ${client_name}

**Total Exports:** ${pngFiles.length}
**Location:** ${clientDir}

${formatted}`,
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MES Workflow MCP server v3.0.0 running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});