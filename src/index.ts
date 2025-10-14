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
  
  if (isBothPaths) {
    mermaid += `  classDef dualPathStyle fill:#e1bee7,stroke:#6a1b9a,stroke-width:3px,color:#4a148c,font-weight:bold\n\n`;
  } else {
    mermaid += `\n`;
  }

  // ========================================
  // Add START node
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% START\n`;
  mermaid += `  %% ========================================\n\n`;
  mermaid += `  START([🏁 START DISPENSING])\n`;
  mermaid += `  style START fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n\n`;

  // ========================================
  // STAGE 1: Pre-Dispensing
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% STAGE 1: PRE-DISPENSING\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  M1["📋 PRE-DISPENSING &<br/>ROOM READINESS"]\n`;
  mermaid += `  class M1 macroStyle\n`;
  mermaid += `  START --> M1\n\n`;

  // ========================================
  // STAGE 2: Material Allocation
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% STAGE 2: MATERIAL ALLOCATION\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  M2["📦 MATERIAL IDENTIFICATION<br/>ALLOCATION & STAGING"]\n`;
  mermaid += `  class M2 macroStyle\n`;
  mermaid += `  M1 ==> M2\n\n`;

  // Add allocation decision highlight
  if (usesSAP) {
    mermaid += `  T014["🎯 SAP/ERP BATCH<br/>DETERMINATION"]\n`;
    mermaid += `  style T014 fill:#bbdefb,stroke:#1565c0,stroke-width:3px,color:#0d47a1,font-weight:bold\n\n`;
  } else {
    mermaid += `  T015["🎯 MES LOT ALLOCATION<br/>with FIFO/FEFO Policy"]\n`;
    mermaid += `  style T015 fill:#e3f2fd,stroke:#1565c0,stroke-width:3px,color:#0d47a1,font-weight:bold\n\n`;
  }

  // ========================================
  // STAGE 3: Weighing & Dispensing
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% STAGE 3: WEIGHING & DISPENSING\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  M3["⚖️ WEIGHING &<br/>DISPENSING"]\n`;
  mermaid += `  class M3 macroStyle\n`;
  mermaid += `  M2 ==> M3\n\n`;

  // Add dual-path routing if applicable
  if (isBothPaths) {
    mermaid += `  ROUTE{"🔀 CONTAINER<br/>SEALED?<br/>(Material-Dependent)"}\n`;
    mermaid += `  class ROUTE dualPathStyle\n`;
    mermaid += `  M3 --> ROUTE\n\n`;
  }

  // ========================================
  // STAGE 4: Labeling & Documentation
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% STAGE 4: LABELING & DOCUMENTATION\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  M5["🏷️ LABELING, RECONCILIATION<br/>& DOCUMENTATION"]\n`;
  mermaid += `  class M5 macroStyle\n\n`;

  if (isBothPaths) {
    mermaid += `  CONVERGE["🔗 PATHS CONVERGE"]\n`;
    mermaid += `  class CONVERGE convergeStyle\n`;
    mermaid += `  CONVERGE ==> M5\n\n`;
  }

  // ========================================
  // STAGE 5: Post-Dispensing
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% STAGE 5: POST-DISPENSING\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  M6["📤 POST-DISPENSING<br/>TRANSFER & ERP POSTING"]\n`;
  mermaid += `  class M6 macroStyle\n`;
  mermaid += `  M5 ==> M6\n\n`;

  // ========================================
  // Add COMPLETE node
  // ========================================
  mermaid += `  %% ========================================\n`;
  mermaid += `  %% END\n`;
  mermaid += `  %% ========================================\n\n`;
  
  mermaid += `  COMPLETE([🎉 DISPENSING COMPLETE])\n`;
  mermaid += `  style COMPLETE fill:#4caf50,stroke:#2e7d32,stroke-width:4px,color:#ffffff,font-weight:bold,font-size:18px\n`;
  mermaid += `  M6 ==> COMPLETE\n\n`;

  // Now use the standard diagram generation for all the detailed nodes
  const detailedDiagram = generateMermaidDiagram(filteredTasks, allTasks, decisions);
  
  // Extract just the node and edge definitions (skip the header and class definitions)
  const lines = detailedDiagram.split('\n');
  let inSubgraph = false;
  let detailedContent = '';
  
  for (const line of lines) {
    if (line.includes('subgraph')) {
      inSubgraph = true;
    }
    if (inSubgraph || line.includes('-->') || line.includes('-.->')  || line.includes('==>')) {
      detailedContent += line + '\n';
    }
    if (line.includes('end') && inSubgraph) {
      inSubgraph = false;
    }
  }

  mermaid += detailedContent;

  return mermaid;
}

// Initialize MCP Server
const server = new Server(
  {
    name: 'mes-workflow-server',
    version: '2.2.0',
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
      description: 'Get all decision questions for a manufacturing stage. Use this to understand what questions need to be answered for workflow configuration.',
      inputSchema: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            description: 'Stage name: "Pre-Dispensing", "Material Allocation", "Weighing & Dispensing", "Labeling & Documentation", "Post-Dispensing", or "All" for all stages',
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
            description: 'The decision ID (e.g., Q-ERP-01, Q-SEC-01)',
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
      description: 'Generate a Mermaid workflow diagram based on client decisions and automatically save it to client_workflows.json. This filters tasks based on Practice decisions and shows all Runtime exception paths. Version 2.2 includes beautiful enhanced UI with emojis and professional styling.',
      inputSchema: {
        type: 'object',
        properties: {
          client_name: {
            type: 'string',
            description: 'Client company name',
          },
          stage: {
            type: 'string',
            description: 'Stage to generate workflow for: "Pre-Dispensing", "Material Allocation", "Weighing & Dispensing", "Labeling & Documentation", "Post-Dispensing", or "All" for complete workflow',
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

        // Filter tasks based on stage and client decisions
        let filteredTasks = allTasks.filter((task) => {
          if (stage !== 'All' && task.stage !== stage) {
            return false;
          }
          return shouldIncludeTask(task, decisions);
        });

        // Generate beautiful Mermaid diagram with enhanced UI
        const mermaid = generateBeautifulMermaidDiagram(filteredTasks, allTasks, decisions, client_name);

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
          stage: stage,
          version: existingVersion + 1,
          mermaid_code: mermaid,
          metadata: metadata,
        };

        await saveClientWorkflows(clientWorkflows);

        // Create summary
        const summary = `## Workflow Generated for ${client_name} - ${stage}

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

**Improvements in v2.2:**
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
        const filename = `workflow_${workflow.stage.replace(/\s+/g, '-')}_${timestamp}.${exportFormat}`;
        const filepath = path.join(clientDir, filename);

        // Use Mermaid.ink API to generate PNG
        try {
          const mermaidCode = workflow.mermaid_code;
          const encodedMermaid = Buffer.from(mermaidCode).toString('base64');
          const mermaidInkUrl = `https://mermaid.ink/img/${encodedMermaid}`;

          // Fetch the image
          const response = await fetch(mermaidInkUrl);
          
          if (!response.ok) {
            throw new Error(`Mermaid.ink API returned ${response.status}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Save to file
          await fs.writeFile(filepath, buffer);

          return {
            content: [
              {
                type: 'text',
                text: `✅ Workflow exported successfully!

**Client:** ${client_name}
**File:** ${filename}
**Location:** ${filepath}
**Stage:** ${workflow.stage}
**Version:** ${workflow.version}
**Format:** ${exportFormat.toUpperCase()}

The workflow diagram has been saved and is ready for client delivery.`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error exporting workflow: ${error instanceof Error ? error.message : String(error)}\n\nPlease ensure you have internet connectivity to use the Mermaid.ink API.`,
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
  console.error('MES Workflow MCP server v2.2.0 running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});