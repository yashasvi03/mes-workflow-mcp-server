# MES Workflow Builder

A **Model Context Protocol (MCP) server** for designing, configuring, and visualizing pharmaceutical manufacturing workflows including **Dispensing** and **Granulation** stages. This tool enables pharmaceutical manufacturers to configure custom Manufacturing Execution System (MES) workflows based on their facility's specific practices, equipment, and regulatory requirements.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage Guide](#usage-guide)
- [Project Structure](#project-structure)
- [Decision Framework](#decision-framework)
- [Workflow Stages](#workflow-stages)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Contributing](#contributing)
- [License](#license)

---

## 🎯 Overview

The **MES Workflow Builder** is an intelligent system that helps pharmaceutical manufacturers design customized workflows for **Dispensing** and **Granulation** operations. Instead of rigid, one-size-fits-all processes, this tool adapts to each client's unique requirements through a **decision-driven configuration approach**.

### Why This Matters

Pharmaceutical manufacturing operations vary significantly across facilities due to:
- Different ERP systems (SAP vs. MES-driven allocation)
- Equipment capabilities (connected vs. manual balances, wet vs. dry granulation)
- Material types (APIs requiring potency adjustment, sealed excipients, binders)
- Quality procedures (second-person verification policies, IPC testing frequency)
- Regulatory requirements (21 CFR Part 11, EU Annex 11)

This tool captures these variations through **62 Practice decisions** and generates validated, client-specific workflows spanning 11 manufacturing stages.

---

## ✨ Features

### 🔧 Core Capabilities

- **Decision-Driven Configuration**: Answer 62 practice questions across Dispensing and Granulation stages
- **Multi-Stage Support**: 11 stages spanning material allocation through batch closeout
- **Multi-Path Processing**: Support for weighing/sealed dispensing, wet/dry/melt granulation methods
- **Beautiful Visualizations**: Professional Mermaid diagrams with color-coded elements
- **Version Control**: Track workflow iterations during client discussions
- **Export to PNG**: Generate client-ready deliverables
- **Validation Engine**: Detect disconnected nodes and structural issues
- **Exception Handling**: Runtime conditions for spills, deviations, equipment failures, QA holds

### 🎨 Visual Design

- 🔷 **Blue macros** for major stages
- 🟨 **Yellow tasks** for standard operations
- 🟣 **Purple loops** for iterative processes
- 🔴 **Red dashed boxes** for exceptions
- 🟠 **Orange diamonds** for decision points
- 🟢 **Green nodes** for convergence/completion

### 🆕 What's New in v3.0.0

- 🎯 **Granulation Stage Support**: 56 new tasks and 34 decisions for granulation workflows
- 📊 **11 Total Stages**: Dispensing (5 stages) + Granulation (6 stages)
- 🔀 **Tri-Path Granulation**: Wet, dry, and melt granulation method routing
- 🔁 **Container Verification Loop**: Loop detection for material transfer verification
- 📈 **123 Total Tasks**: Comprehensive task library covering end-to-end pharmaceutical manufacturing
- 🎛️ **77 Decision Points**: Complete decision framework for both stages
- ⚙️ **SCADA/PLC Integration**: Support for automated process control and data capture
- 🧪 **LIMS Integration**: IPC result linkage and QA release workflows

---

## 🏗️ Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (TypeScript)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   Decision   │  │   Workflow   │  │     Export      │  │
│  │   Manager    │  │   Generator  │  │     Engine      │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Reads/Writes
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer (JSON)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  decisions   │  │    tasks     │  │  client_        │  │
│  │    .json     │  │    .json     │  │  decisions.json │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │            client_workflows.json (cache)              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Exports
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Exports Folder (PNG Deliverables)               │
│  ├── Demo Pharma/                                            │
│  │   ├── workflow_All_2025-01-15_14-30-00.png              │
│  │   └── workflow_All_2025-01-16_10-22-15.png              │
│  └── TechPharma/                                             │
│      └── workflow_All_2025-01-15_16-45-30.png              │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 Installation

### Prerequisites

- **Node.js** 18+ and npm
- **Claude Desktop** or any MCP-compatible client

### Steps

1. **Clone the repository**
```bash
   git clone https://github.com/yashasvi03/mes-workflow-mcp-server
   cd mes-workflow-builder
```

2. **Install dependencies**
```bash
   npm install
```

3. **Build the project**
```bash
   npm run build
```

4. **Configure Claude Desktop**
   
   Edit your Claude Desktop config file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   Add the MCP server:
```json
   {
     "mcpServers": {
       "mes-workflow": {
         "command": "node",
         "args": ["/absolute/path/to/mes-workflow-builder/build/index.js"]
       }
     }
   }
```

5. **Restart Claude Desktop**

---

## 🚀 Quick Start

### Example: Configuring Demo Pharma
```typescript
// 1. Check available decisions
get_decisions({ stage: "All", category: "Practice" })

// 2. Configure key decisions
save_client_decision({
  client_name: "Demo Pharma",
  decision_id: "Q-ERP-01",
  selected_outcome: "SAP",
  rationale: "Using SAP for batch determination"
})

save_client_decision({
  client_name: "Demo Pharma",
  decision_id: "Q-SEC-01",
  selected_outcome: "Both (material-dependent)",
  rationale: "APIs need weighing, excipients can be sealed"
})

// 3. Check what's still needed
get_unanswered_decisions({ client_name: "Demo Pharma" })

// 4. Generate workflow
generate_workflow({ 
  client_name: "Demo Pharma", 
  stage: "All" 
})

// 5. Review and iterate (make changes, regenerate)

// 6. Export finalized workflow
export_workflow({ 
  client_name: "Demo Pharma",
  format: "png"
})
```

---

## 📖 Usage Guide

### Typical Workflow

1. **Discovery Phase**
   - Review client's current manufacturing procedures (Dispensing and/or Granulation)
   - Identify ERP/WMS/LIMS/SCADA integrations
   - Understand material handling and equipment requirements
   - Determine granulation method (wet/dry/melt) if applicable

2. **Configuration Phase**
   - Answer relevant Practice decisions (62 total across both stages)
   - Use `get_unanswered_decisions` to track progress
   - Document rationale for each choice

3. **Generation Phase**
   - Generate initial workflow
   - Review with stakeholders
   - Iterate on decisions as needed

4. **Validation Phase**
   - Run `validate_workflow` to check structure
   - Verify decision points match SOPs
   - Test exception handling paths

5. **Export Phase**
   - Export final workflow as PNG
   - Include in client deliverables
   - Maintain version history

### Best Practices

✅ **DO:**
- Document rationale for each decision
- Validate workflow before exporting
- Keep exports for audit trail
- Review Runtime conditions with operations team

❌ **DON'T:**
- Skip validation before export
- Export without client review
- Delete previous exports
- Make assumptions about client practices

---

## 📁 Project Structure
```
mes-workflow-builder/
├── src/
│   └── index.ts                 # Main MCP server implementation
├── data/
│   ├── decisions.json           # 77 decisions (62 Practice + 15 Runtime)
│   ├── tasks.json               # 123 workflow tasks (Dispensing + Granulation)
│   ├── client_decisions.json    # Client configurations
│   └── client_workflows.json    # Generated workflow cache
├── exports/
│   ├── Demo Pharma/
│   │   └── workflow_*.png       # Client deliverables
│   ├── TechPharma/
│   │   └── workflow_*.png
│   └── README.md
├── build/                       # Compiled JavaScript
├── package.json
├── tsconfig.json
└── README.md                    # This file
```

---

## 🏭 Workflow Stages

The MES Workflow Builder supports **11 manufacturing stages** across two major process families:

### Dispensing Stages (5)

1. **Pre-Dispensing** - Equipment readiness, cleaning verification, environmental checks
2. **Material Allocation** - Lot selection, WMS staging, container verification
3. **Weighing & Dispensing** - Material weighing, potency adjustment, dual-path (sealed/weighed) routing
4. **Labeling & Documentation** - Container labeling, batch record generation
5. **Post-Dispensing** - ERP consumption posting, remnant handling

### Granulation Stages (6)

6. **Pre-Granulation** - Room clearance, equipment readiness, calibration verification
7. **Material Transfer & Verification** - Container-by-container material verification loop
8. **Binder Preparation** - Binder solution prep, concentration/pH QC
9. **Granulation** - Tri-path routing (wet/dry/melt methods), process control, endpoint verification
10. **Post-Granulation** - Discharge to IBC, retain sampling, QA release decision, yield reconciliation
11. **Closeout** - ERP batch posting, eBMR generation, QA approval, archival

---

## 🧩 Decision Framework

### Practice Decisions (62 Total)

Configuration-time choices that filter which tasks appear in the workflow:

#### **Pre-Dispensing (6 decisions)**
- Q-HSE-01: Material handling category
- Q-HSE-02: Cleaning frequency
- Q-HR-01: Training enforcement
- Q-ENV-01: Environmental logging method
- Q-ENV-02: Cold-chain/TOR tracking
- Q-ENV-03: Action on environmental excursions

#### **Material Allocation (4 decisions)**
- Q-ERP-01: **Batch/lot determination (SAP vs MES)**
- Q-INV-02: Material selection policy (FIFO/FEFO)
- Q-INV-03: Allowed lot statuses
- Q-WMS-01: WMS integration

#### **Weighing & Dispensing (12 decisions)**
- Q-SEC-01: **Sealed container support (Weighing only | Sealed only | Both)**
- Q-LIMS-01: Potency/assay source
- Q-QA-02: Second-person verification policy
- Q-WB-01: Balance connectivity
- Q-WB-02: Balance suitability enforcement
- Q-WB-03: Default weighing method
- Q-WB-04: Out-of-tolerance handling
- Q-UOM-01: UoM conversion authority
- Q-UOM-02: Rounding policy
- Q-LOT-01: Multi-lot allowed
- Q-LOT-02: Proportional potency
- Q-DMG-01: Spillage handling

#### **Labeling & Documentation (4 decisions)**
- Q-LBL-01: Manual label fields
- Q-LBL-02: Label symbology standard
- Q-LBL-03: Reprint/void policy
- Q-QA-04: Deviation documentation

#### **Post-Dispensing (2 decisions)**
- Q-CONS-01: ERP consumption timing
- Q-INV-06: Remnant return policy

#### **Granulation - Pre-Granulation (4 decisions)**
- GRAN-D-METHOD-001: **Granulation method (Wet | Dry | Melt)** - Primary routing decision
- GRAN-D-CLN-001: Cleaning verification policy
- GRAN-D-CAL-001: Instrument calibration frequency
- GRAN-D-ENV-001: Environmental monitoring method

#### **Granulation - Material Transfer (2 decisions)**
- GRAN-D-MAT-001: Material verification method at staging
- GRAN-D-CONT-001: Container integrity check requirement

#### **Granulation - Binder Preparation (2 decisions)**
- GRAN-D-BINDER-001: Binder solution preparation location
- GRAN-D-BINDER-QC-001: Binder QC testing before use

#### **Granulation - Granulation Process (7 decisions)**
- GRAN-D-RECIPE-001: Recipe/setpoint source
- GRAN-D-SCADA-001: SCADA/PLC integration availability
- GRAN-D-WET-PARAM-001: Wet granulation binder addition mode
- GRAN-D-CAPTURE-001: Data capture mode for process parameters
- GRAN-D-IPC-001: In-process QC testing policy
- GRAN-D-LIMS-001: LIMS integration for IPC results
- GRAN-D-CALC-001: Auto-calculations for reconciliation

#### **Granulation - Post-Granulation (6 decisions)**
- GRAN-D-LABEL-001: Labeling requirements for granule containers
- GRAN-D-RETAIN-001: Retain sample collection policy
- GRAN-D-TRANSFER-001: Transfer destination for granules
- GRAN-D-YIELD-001: Yield variance investigation threshold
- GRAN-D-CLEAN-POLICY-001: Cleaning frequency for equipment
- GRAN-D-DEVIATION-001: Deviation documentation system

#### **Granulation - Closeout (3 decisions)**
- GRAN-D-ERP-POST-001: ERP posting timing
- GRAN-D-EBMR-001: eBMR generation and signature policy
- GRAN-D-ARCHIVE-001: Records archival and retention policy

### Runtime Conditions (15 Total)

Exception paths that appear as decision diamonds in the workflow:

#### **Dispensing Runtime Conditions (13)**
- C-CLN-01: Cleaning hold-time validity
- C-CAL-01: Balance calibration validity
- C-ENV-01: Environmental limits
- C-REL-01: Lot release status
- C-TOR-01: Time-out-of-refrigeration
- C-NET-01: Network connectivity
- C-STAT-01: Lot status changes
- C-DMG-01: Container damage
- C-TOL-01: Weighing tolerance
- C-SPILL-01: Spill detection
- C-VERIFY-01: Container verification
- C-WB-CONN-01: Instrument handshake
- C-GI-ACK-01: ERP posting acknowledgment
- C-LBL-01: Label verification
- C-SEC-01: Container sealed check (for "Both" path)

#### **Granulation Runtime Conditions (8)**
- GRAN-C-CLN-VALID-001: Cleaning verification validity
- GRAN-C-CAL-VALID-001: Instrument calibration validity
- GRAN-C-ENV-VALID-001: Environmental conditions within range
- GRAN-D-WET-SET-001: Wet granulation setpoints validation
- GRAN-D-DRY-SET-001: Dry granulation parameters validation
- GRAN-D-ENDPOINT-001: Granulation endpoint reached
- GRAN-D-OOL-001: IPC results within spec limits
- GRAN-D-FAIL-001: Equipment failure recovery decision
- GRAN-D-RELEASE-001: QA release decision for granules
- GRAN-D-QA-APPROVAL-001: Final batch approval

---

## 🛠️ API Reference

### Core Tools

#### `get_decisions`
Get all decision questions for a stage.

**Parameters:**
- `stage` (optional): Dispensing: "Pre-Dispensing" | "Material Allocation" | "Weighing & Dispensing" | "Labeling & Documentation" | "Post-Dispensing"; Granulation: "Pre-Granulation" | "Material Transfer & Verification" | "Binder Preparation" | "Granulation" | "Post-Granulation" | "Closeout" | "All"
- `category` (optional): "Practice" | "Runtime"

**Example:**
```typescript
// Get Dispensing decisions
get_decisions({
  stage: "Weighing & Dispensing",
  category: "Practice"
})

// Get Granulation decisions
get_decisions({
  stage: "Granulation",
  category: "Practice"
})
```

#### `get_decision_details`
Get detailed information about a specific decision.

**Parameters:**
- `decision_id` (required): e.g., "Q-ERP-01" (Dispensing) or "GRAN-D-METHOD-001" (Granulation)

**Example:**
```typescript
// Dispensing decision
get_decision_details({ decision_id: "Q-SEC-01" })

// Granulation decision
get_decision_details({ decision_id: "GRAN-D-METHOD-001" })
```

#### `save_client_decision`
Save a client's answer to a decision.

**Parameters:**
- `client_name` (required): Client company name
- `decision_id` (required): Decision ID
- `selected_outcome` (required): Must match valid outcomes
- `rationale` (optional): Explanation

**Example:**
```typescript
save_client_decision({
  client_name: "Demo Pharma",
  decision_id: "Q-SEC-01",
  selected_outcome: "Both (material-dependent)",
  rationale: "APIs require weighing, excipients are sealed"
})
```

#### `get_client_decisions`
View all configured decisions for a client.

**Parameters:**
- `client_name` (required)

#### `get_unanswered_decisions`
List Practice decisions still needing answers.

**Parameters:**
- `client_name` (required)
- `stage` (optional): Filter by stage

#### `generate_workflow`
Generate and auto-save workflow diagram.

**Parameters:**
- `client_name` (required)
- `stage` (required): Stage to generate

**Behavior:**
- Filters tasks based on Practice decisions
- Shows all Runtime exception paths
- Auto-saves to `client_workflows.json`
- Increments version number

#### `get_saved_workflow`
Retrieve cached workflow from `client_workflows.json`.

**Parameters:**
- `client_name` (required)

#### `validate_workflow`
Check workflow structure for issues.

**Parameters:**
- `client_name` (required)
- `stage` (required)

**Checks:**
- Orphaned nodes
- Missing predecessors
- Loop structure integrity

#### `export_workflow`
Export workflow as PNG to `exports/[client]/`.

**Parameters:**
- `client_name` (required)
- `format` (optional): "png" (only format currently supported)

**Behavior:**
- Uses Mermaid.ink API
- Creates timestamped file
- Never overwrites previous exports
- Requires internet connection

#### `list_exports`
List all exported PNG files for a client.

**Parameters:**
- `client_name` (required)

#### `list_clients`
Show all configured clients.

---

## 💡 Examples

### Example 1: Simple Configuration (Weighing Only)
```typescript
// TechPharma: Uses MES allocation, weighing path only

save_client_decision({
  client_name: "TechPharma",
  decision_id: "Q-ERP-01",
  selected_outcome: "MES",
  rationale: "MES performs lot determination"
})

save_client_decision({
  client_name: "TechPharma",
  decision_id: "Q-SEC-01",
  selected_outcome: "Weighing only",
  rationale: "All materials require balance verification"
})

// ... configure remaining decisions ...

generate_workflow({ 
  client_name: "TechPharma", 
  stage: "All" 
})

// Result: Clean single-path workflow with 56 tasks
```

### Example 2: Dual-Path Configuration
```typescript
// Demo Pharma: Uses SAP, supports both weighing and sealed

save_client_decision({
  client_name: "Demo Pharma",
  decision_id: "Q-ERP-01",
  selected_outcome: "SAP",
  rationale: "SAP ERP for batch determination"
})

save_client_decision({
  client_name: "Demo Pharma",
  decision_id: "Q-SEC-01",
  selected_outcome: "Both (material-dependent)",
  rationale: "APIs need weighing, excipients can be sealed"
})

// ... configure remaining decisions ...

generate_workflow({ 
  client_name: "Demo Pharma", 
  stage: "All" 
})

// Result: Dual-path workflow with decision diamond routing
// 58 tasks, 6 macros, 4 loops
```

### Example 3: Iterative Refinement
```typescript
// Initial generation
generate_workflow({ 
  client_name: "Client X", 
  stage: "All" 
})

// Review with client, they want to change spill handling

save_client_decision({
  client_name: "Client X",
  decision_id: "Q-DMG-01",
  selected_outcome: "Continue by adding new container",
  rationale: "Updated per client feedback"
})

// Regenerate (version increments automatically)
generate_workflow({ 
  client_name: "Client X", 
  stage: "All" 
})

// When finalized
export_workflow({ client_name: "Client X" })
```

---

## 🔍 Validation & Troubleshooting

### Common Issues

**Issue: Missing loop start warning**
```
⚠️ DISP-SL-006 loop end exists but DISP-SL-001 loop start is missing
```
**Solution:** Check Q-SEC-01 configuration. If set to "Both" or "Sealed only", the sealed loop should be included.

**Issue: Orphaned node**
```
⚠️ DISP-XYZ has no valid predecessors - orphaned node
```
**Solution:** Review decision dependencies. Some tasks require specific combinations of decisions.

**Issue: Export fails**
```
Error: Mermaid.ink API returned 500
```
**Solution:** Check internet connection. Mermaid.ink may have rate limits. Wait and retry.

### Validation Checklist

Before exporting:
- [ ] All Practice decisions answered
- [ ] `validate_workflow` shows no warnings
- [ ] Decision rationales documented
- [ ] Client has reviewed and approved
- [ ] Stage-specific workflows validated if needed

---

## 🤝 Contributing

### Development Setup
```bash
# Clone and install
git clone <repo>
cd mes-workflow-builder
npm install

# Build
npm run build

# Watch mode for development
npm run watch
```

### Adding New Decisions

1. Add to `data/decisions.json`
2. Update affected tasks in `data/tasks.json`
3. Update `README.md` decision framework section
4. Test with sample client
5. Validate workflow generation

### Adding New Tasks

1. Add to `data/tasks.json` with proper structure
2. Set `decision_id` and `decision_outcome` if conditional
3. Define `predecessors` for workflow flow
4. Test integration with existing workflows

---

## 📄 License

[Your License Here - e.g., MIT, Apache 2.0]

---

## 📞 Support

For issues, questions, or feature requests:
- Create an issue on GitHub
- Contact: [your-email@example.com]
- Documentation: [link to docs]

---

## 🙏 Acknowledgments

Built with:
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Mermaid.js](https://mermaid.js.org/) for diagram generation
- [Mermaid.ink](https://mermaid.ink/) for PNG rendering
- TypeScript & Node.js

---

## 📊 Project Stats

- **Version:** 2.3.0
- **Total Decisions:** 28 Practice + 13 Runtime = 41
- **Total Tasks:** 65 (5 Macros + 56 Micros + 4 Loops)
- **Workflow Stages:** 5
- **Supported Clients:** Unlimited
- **Export Formats:** PNG (SVG coming soon)

---

## 🆕 Version History

### Version 2.3.0 (Current)
**Enhanced Workflow Visualization & Export Improvements**
- ✨ **Refined diagram layout**: Cleaner visual structure with improved node organization
- 🎨 **Better decision points**: Enhanced decision diamond styling and placement
- 🔄 **Improved path convergence**: Clearer visual flow for dual-path workflows (weighing/sealed)
- 📦 **Local PNG export**: Full local export support using @mermaid-js/mermaid-cli
- 🎯 **High-resolution exports**: 2400x3000px professional deliverables
- ⚡ **Faster generation**: Optimized diagram generation algorithm
- 🧹 **Code cleanup**: Removed redundant functions, streamlined codebase

### Version 2.2.0
**Workflow Persistence & Export Capabilities**
- 💾 Auto-save generated workflows to `client_workflows.json`
- 📤 Export workflows as PNG images via Mermaid.ink API
- 📁 Organized client export folders with timestamped files
- 🔢 Version tracking for workflow iterations
- 📊 Workflow metadata (task counts, decision counts)

### Version 2.1.0
**Multi-Path Dispensing Support**
- 🔀 Dual-path workflow support (weighing + sealed containers)
- 🎯 Material-dependent routing with decision diamonds
- 🟣 Enhanced loop visualization
- 🔗 Path convergence nodes

### Version 1.0.0
**Initial Release**
- 📋 Decision-driven workflow configuration
- 🔧 28 Practice decisions framework
- ⚙️ 13 Runtime condition handling
- 📊 Mermaid diagram generation
- 🎨 Color-coded workflow elements

---

**Last Updated:** October 2025