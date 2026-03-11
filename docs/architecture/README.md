# AWS Architecture Diagrams

This directory contains architecture diagrams for the ECS Fargate Spot Failover solution, available in multiple formats.

## 📁 File Descriptions

| File | Format | Purpose | Editing Tool |
|------|--------|---------|--------------|
| `aws-architecture.drawio` | Draw.io XML | Detailed editable architecture diagram | [Draw.io](https://app.diagrams.net/) / VS Code Extension |
| `aws-architecture.puml` | PlantUML | Code-based architecture diagram | [PlantUML Online](https://www.plantuml.com/) / VS Code Extension |
| `aws-architecture.mmd` | Mermaid | Markdown-embedded diagram | [Mermaid Live Editor](https://mermaid.live/) / GitHub/GitLab |

## 🎨 Architecture Diagram Preview

### Overall Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ☁️ AWS Cloud                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 🏠 VPC (10.0.0.0/16)                                                │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │ 🌐 Public Subnets                                             │   │   │
│  │  │  ⚖️ Application Load Balancer (Port 80)                        │   │   │
│  │  └──────────────────────┬───────────────────────────────────────┘   │   │
│  │                         │                                           │   │
│  │  ┌──────────────────────┴───────────────────────────────────────┐   │   │
│  │  │ 🔒 Private Subnets                                              │   │   │
│  │  │                                                                  │   │   │
│  │  │  ┌──────────────────────┐  ┌──────────────────────┐            │   │   │
│  │  │  │ 🟢 Fargate Spot      │  │ 🟡 Fargate Standard  │            │   │   │
│  │  │  │ sample-app           │  │ sample-app-standard  │            │   │   │
│  │  │  │ Capacity: FARGATE_SPOT│  │ Capacity: FARGATE    │            │   │   │
│  │  │  │ Desired: 2           │  │ Desired: 0→2         │            │   │   │
│  │  │  └──────────────────────┘  └──────────────────────┘            │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚡ Serverless Components                                             │   │
│  │                                                                      │   │
│  │  📡 EventBridge → 🔍 Spot Error Detector → 🔄 Failback Orchestrator │   │
│  │                 → ✅ Spot Success Monitor → 🧹 Cleanup Orchestrator │   │
│  │                                                                      │   │
│  │  💾 DynamoDB (State)    📨 SNS (Notifications)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🚀 Usage Instructions

### Draw.io (Recommended)

**Online Editing:**
1. Visit [app.diagrams.net](https://app.diagrams.net/)
2. Select "Open from" → "Device"
3. Choose the `aws-architecture.drawio` file

**VS Code Editing:**
1. Install the "Draw.io Integration" extension
2. Right-click on `aws-architecture.drawio`
3. Select "Open with Draw.io"

**Export Formats:**
- PNG/SVG (for embedding in documentation)
- PDF (for printing)
- XML (preserves editing capability)

### PlantUML

**Online Rendering:**
1. Visit [www.plantuml.com/plantuml](https://www.plantuml.com/plantuml/)
2. Paste the contents of `aws-architecture.puml`
3. Click generate

**VS Code:**
1. Install the "PlantUML" extension
2. Open `aws-architecture.puml`
3. Use keyboard shortcut `Alt+D` to preview

**Command Line:**
```bash
# Install PlantUML
brew install plantuml

# Generate PNG
plantuml aws-architecture.puml

# Generate SVG
plantuml -tsvg aws-architecture.puml
```

### Mermaid

**GitHub/GitLab Rendering:**
Reference directly in Markdown files:

```markdown
![Architecture](./aws-architecture.mmd)
```

**Online Editing:**
1. Visit [mermaid.live](https://mermaid.live/)
2. Paste the contents of `aws-architecture.mmd`

**VS Code:**
1. Install the "Markdown Preview Mermaid Support" extension
2. Open preview to view the diagram

## 📐 Architecture Diagram Content Guide

### Component Color Coding

| Color | Component Type | Description |
|-------|----------------|-------------|
| 🟢 Green | Fargate Spot | Cost-optimized, spot pricing |
| 🟡 Yellow | Fargate Standard | High availability, standard pricing |
| 🔵 Blue | Network Components | VPC, subnets, load balancers |
| 🟣 Purple | ECS Related | Clusters, services, tasks |
| 🔴 Red | Serverless | Lambda, DynamoDB, SNS |

### Connector Styles

| Style | Meaning | Example |
|-------|---------|---------|
| Solid line (→) | Primary traffic/control flow | ALB → Spot Service |
| Dashed line (-.->) | Failover/backup | ALB -.-> Standard Service |
| Thick line | High-frequency interaction | Lambda ↔ DynamoDB |

### Data Flow Descriptions

#### Normal Traffic Flow
```
Users → ALB → Spot Target Group → Fargate Spot Service
```

#### Failover Flow
```
Spot Error → EventBridge → Spot Error Detector → Failback Orchestrator
  → Start Standard Service + Stop Spot Service
  → ALB automatically switches traffic to Standard Target Group
```

#### Auto-Recovery Flow
```
Spot Success → EventBridge → Spot Success Monitor → Cleanup Orchestrator
  → Start Spot Service + Stop Standard Service
  → ALB automatically switches back to Spot Target Group
```

## 🔄 Updating Architecture Diagrams

### When Architecture Changes:

1. **Synchronize diagram updates after code changes**
   ```bash
   # Modify Lambda functions
   git add src/lambda/*.ts
   
   # Synchronize architecture diagram updates
   git add docs/architecture/*
   ```

2. **Version Control**
   ```bash
   git commit -m "docs(architecture): update for multi-region support
   
   - Add Route53 component
   - Update VPC peering connections
   - Modify Lambda event flow"
   ```

3. **Export Latest Images**
   - Export PNG/SVG from Draw.io
   - Commit to `docs/images/`

## 📖 Architecture Diagram Use Cases

| Scenario | Recommended Format | Rationale |
|----------|-------------------|-----------|
| Technical Review | Draw.io | Interactive, editable |
| Documentation Embedding | Mermaid | Version control friendly |
| PPT Presentation | PNG/SVG | High resolution, no network required |
| Architecture Decision | PlantUML | Code-based, diff-friendly |

## 🔗 Related Resources

- [AWS Icons for PlantUML](https://github.com/awslabs/aws-icons-for-plantuml)
- [Draw.io AWS Shapes](https://www.draw.io/?libs=aws4)
- [Mermaid Documentation](https://mermaid-js.github.io/)
- [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)

## 💡 Tips

1. **Keep Synchronized**: Update both code and architecture diagrams when architecture changes
2. **Version Tagging**: Label version numbers in architecture diagrams
3. **Layered Presentation**: Split complex architecture into multiple diagrams (network layer, application layer, data flow)
4. **Consistent Colors**: Maintain consistent color schemes for better understanding
