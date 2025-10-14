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

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory path
const DATA_DIR = path.join(__dirname, '../data');

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
      // Skip predecessor edges - handled by decision diamond
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

// Initialize MCP Server
const server = new Server(
  {
    name: 'mes-workflow-server',
    version: '2.1.0',
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
      description: 'Generate a Mermaid workflow diagram based on client decisions. This filters tasks based on Practice decisions and shows all Runtime exception paths. Version 2.1 includes support for multi-path dispensing (Q-SEC-01 "Both" option).',
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

        // Filter tasks using new helper function
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

        // Filter tasks based on stage and client decisions using new helper function
        let filteredTasks = allTasks.filter((task) => {
          if (stage !== 'All' && task.stage !== stage) {
            return false;
          }

          return shouldIncludeTask(task, decisions);
        });

        // Generate improved Mermaid diagram
        const mermaid = generateMermaidDiagram(filteredTasks, allTasks, decisions);

        // Create summary
        const totalTasks = allTasks.length;
        const includedCount = filteredTasks.length;
        const macroCount = filteredTasks.filter((t) => t.type === 'Macro').length;
        const microCount = filteredTasks.filter((t) => t.type === 'Micro').length;
        const loopCount = filteredTasks.filter((t) => t.type.includes('Loop')).length;

        const summary = `## Workflow Generated for ${client_name} - ${stage}

**Configuration Summary:**
- Total tasks in library: ${totalTasks}
- Tasks included in workflow: ${includedCount}
  - Macro stages: ${macroCount}
  - Micro tasks: ${microCount}
  - Loop constructs: ${loopCount}

**Applied Decisions (${Object.keys(decisions).length}):**
${Object.entries(decisions)
  .slice(0, 10)
  .map(([id, data]) => `- ${id} = "${data.selected_outcome}"`)
  .join('\n')}${Object.keys(decisions).length > 10 ? `\n... and ${Object.keys(decisions).length - 10} more` : ''}

**Improvements in v2.1:**
✅ Smart ancestor linking - no orphaned nodes
✅ Decision diamonds for runtime conditions
✅ Loop back edges showing iteration
✅ Subgraphs organized by stage
✅ Multi-path dispensing support (Q-SEC-01 "Both" option)
✅ Better handling of OR predecessors

**Workflow Diagram:**

\`\`\`mermaid
${mermaid}
\`\`\`

**Legend:**
- 🔷 Blue boxes with thick borders = Macro stages
- 🟨 Yellow boxes = Micro tasks (normal flow)
- 🟣 Purple circles = Loop start/end
- 🔴 Red dashed boxes = Exception handlers
- 🟠 Orange diamonds = Runtime decision points

**Note:** Runtime conditions (C-xxx) appear as decision diamonds and exception paths throughout the workflow.`;

        return {
          content: [
            {
              type: 'text',
              text: summary,
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
  console.error('MES Workflow MCP server v2.1 running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});