# AWS 架构图

本目录包含 ECS Fargate Spot Failover 解决方案的架构图，支持多种格式。

## 📁 文件说明

| 文件 | 格式 | 用途 | 编辑工具 |
|------|------|------|----------|
| `aws-architecture.drawio` | Draw.io XML | 详细的可编辑架构图 | [Draw.io](https://app.diagrams.net/) / VS Code 插件 |
| `aws-architecture.puml` | PlantUML | 代码化架构图 | [PlantUML Online](https://www.plantuml.com/) / VS Code 插件 |
| `aws-architecture.mmd` | Mermaid | Markdown 内嵌图表 | [Mermaid Live Editor](https://mermaid.live/) / GitHub/GitLab |

## 🎨 架构图预览

### 整体架构

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

## 🚀 使用方法

### Draw.io (推荐)

**在线编辑:**
1. 访问 [app.diagrams.net](https://app.diagrams.net/)
2. 选择 "Open from" → "Device"
3. 选择 `aws-architecture.drawio` 文件

**VS Code 编辑:**
1. 安装 "Draw.io Integration" 扩展
2. 右键点击 `aws-architecture.drawio`
3. 选择 "Open with Draw.io"

**导出格式:**
- PNG/SVG (可嵌入文档)
- PDF (适合打印)
- XML (保留编辑能力)

### PlantUML

**在线渲染:**
1. 访问 [www.plantuml.com/plantuml](https://www.plantuml.com/plantuml/)
2. 粘贴 `aws-architecture.puml` 内容
3. 点击生成

**VS Code:**
1. 安装 "PlantUML" 扩展
2. 打开 `aws-architecture.puml`
3. 使用快捷键 `Alt+D` 预览

**命令行:**
```bash
# 安装 PlantUML
brew install plantuml

# 生成 PNG
plantuml aws-architecture.puml

# 生成 SVG
plantuml -tsvg aws-architecture.puml
```

### Mermaid

**GitHub/GitLab 渲染:**
直接在 Markdown 文件中引用:

```markdown
![Architecture](./aws-architecture.mmd)
```

**在线编辑:**
1. 访问 [mermaid.live](https://mermaid.live/)
2. 粘贴 `aws-architecture.mmd` 内容

**VS Code:**
1. 安装 "Markdown Preview Mermaid Support" 扩展
2. 打开预览查看图表

## 📐 架构图内容说明

### 组件配色

| 颜色 | 组件类型 | 说明 |
|------|----------|------|
| 🟢 绿色 | Fargate Spot | 成本优化，按需定价 |
| 🟡 黄色 | Fargate Standard | 高可用性，标准定价 |
| 🔵 蓝色 | 网络组件 | VPC、子网、负载均衡 |
| 🟣 紫色 | ECS 相关 | 集群、服务、任务 |
| 🔴 红色 | Serverless | Lambda、DynamoDB、SNS |

### 连接线样式

| 样式 | 含义 | 示例 |
|------|------|------|
| 实线 (→) | 主要流量/控制流 | ALB → Spot Service |
| 虚线 (-.->) | 故障转移/备用 | ALB -.-> Standard Service |
| 粗线 | 高频交互 | Lambda ↔ DynamoDB |

### 数据流说明

#### 正常流量流
```
Users → ALB → Spot Target Group → Fargate Spot Service
```

#### 故障转移流
```
Spot Error → EventBridge → Spot Error Detector → Failback Orchestrator
  → Start Standard Service + Stop Spot Service
  → ALB 自动切换流量到 Standard Target Group
```

#### 自动恢复流
```
Spot Success → EventBridge → Spot Success Monitor → Cleanup Orchestrator
  → Start Spot Service + Stop Standard Service
  → ALB 自动切换回 Spot Target Group
```

## 🔄 更新架构图

### 当架构变更时:

1. **更新代码后同步修改图表**
   ```bash
   # 修改 Lambda 函数
   git add src/lambda/*.ts
   
   # 同步更新架构图
   git add docs/architecture/*
   ```

2. **版本控制**
   ```bash
   git commit -m "docs(architecture): update for multi-region support
   
   - Add Route53 component
   - Update VPC peering connections
   - Modify Lambda event flow"
   ```

3. **导出最新图片**
   - 从 Draw.io 导出 PNG/SVG
   - 提交到 `docs/images/`

## 📖 架构图使用场景

| 场景 | 推荐格式 | 原因 |
|------|----------|------|
| 技术评审 | Draw.io | 可交互、可编辑 |
| 文档嵌入 | Mermaid | 版本控制友好 |
| PPT 演示 | PNG/SVG | 高清、无需网络 |
| 架构决策 | PlantUML | 代码化、diff 友好 |

## 🔗 相关资源

- [AWS Icons for PlantUML](https://github.com/awslabs/aws-icons-for-plantuml)
- [Draw.io AWS Shapes](https://www.draw.io/?libs=aws4)
- [Mermaid Documentation](https://mermaid-js.github.io/)
- [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/)

## 💡 提示

1. **保持同步**: 架构变更时，同时更新代码和架构图
2. **版本标记**: 在架构图中标注版本号
3. **分层展示**: 复杂架构可拆分为多张图 (网络层、应用层、数据流)
4. **颜色一致**: 保持配色方案统一，便于理解
