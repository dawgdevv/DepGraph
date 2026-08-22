# DepGraph Product Requirements

> See exactly what depends on a vulnerable package.

## 1. Product Definition

DepGraph is a focused developer-security application that explains the potential impact of vulnerable npm dependencies.

It combines:

- **CVE-Lite CLI** for vulnerability detection.
- **CognoDB** for storing and traversing dependency relationships.
- **Interactive graph visualization** for showing blast radius and dependency paths.

DepGraph is not a vulnerability scanner replacement. CVE-Lite identifies findings; DepGraph explains how those findings reach an application.

### Core question

> Why does this vulnerability affect this repository?

### Core product loop

```text
Repository
  -> Parse npm dependency tree
  -> Run CVE-Lite
  -> Build graph in CognoDB
  -> Calculate blast radius
  -> Explore dependency paths visually
```

## 2. Problem And Goal

Traditional scanner output may say:

```text
follow-redirects@1.15.9 is vulnerable.
```

That does not explain how the package reaches the application, which direct dependencies introduce it, or how many paths are affected.

DepGraph must make these relationships visible:

```text
my-app
  -> api-client
    -> axios
      -> follow-redirects [vulnerable]
```

The product succeeds when a reviewer can understand the finding and its impact in under 30 seconds.

## 3. Target User

Primary user: a developer investigating the impact of a vulnerable npm package.

Users must not need to understand graph databases or Cypher. Graph technology is an implementation detail that produces useful answers.

## 4. MVP Scope

### Supported input

- JavaScript/TypeScript repositories using npm.
- Required files: `package.json` and `package-lock.json`.
- `package-lock.json` is the source of truth for resolved versions and relationships.
- Repository ZIP upload.
- Public GitHub repository URL; no GitHub authentication required.

### In scope

- Repository validation and loading.
- npm dependency parsing.
- CVE-Lite integration and normalized findings.
- Project, package, and vulnerability graph construction.
- Direct and transitive dependency traversal.
- Dependency path inspection.
- Blast-radius counts and visualization.
- File-level import reachability for JavaScript/TypeScript source files.
- Package and vulnerability detail panels.
- Loading, empty, and error states.
- Polished desktop-first responsive UI.
- Server-side CognoDB access.

### Explicitly out of scope

- Accounts, authentication, teams, organizations, or billing.
- User/project persistence or SaaS dashboards.
- GitHub OAuth, pull requests, or CI/CD integration.
- Automatic remediation, upgrades, or `package.json` editing.
- Running `npm install`.
- Continuous monitoring or full SCA platform features.
- Source-code vulnerability detection or proof that vulnerable code executes.
- Function-level reachability.
- Other package managers or programming languages.
- SBOM/SARIF export.

Do not build future features until MVP acceptance criteria are complete.

## 5. User Experience

Keep application to three primary views.

### View 1: Analyze

Route: `/`

Purpose:

- Show product name and one-line explanation.
- Accept a repository ZIP or public GitHub URL.
- Start analysis.
- Provide a small example/demo option.

Suggested copy:

```text
DepGraph
See exactly what depends on a vulnerable package.

[ GitHub repository URL ]  [ Analyze Repository ]
or
[ Drop repository ZIP here ]
```

No signup, login, or unnecessary navigation.

### View 2: Overview

Route: `/analysis/[id]`

Purpose:

- Show repository name.
- Show total, direct, and transitive package counts.
- Show vulnerable package count.
- Show affected path count.
- List vulnerabilities ordered by impact/severity.
- Link each finding to blast-radius exploration.

Example summary:

```text
my-next-app
187 packages | 31 direct | 156 transitive
2 vulnerable packages | 8 affected paths
```

Each vulnerability card should show package, installed version, severity, identifier when available, dependent package count, dependent path count, and `View blast radius`.

### View 3: Explorer

Route: `/analysis/[id]/explore`

Purpose:

- Interactive dependency graph.
- Blast-radius analysis.
- Dependency path list.
- Package and vulnerability details.

Recommended desktop layout:

```text
+----------------+----------------------------+-------------+
| Vulnerabilities|                            | Details     |
|                |           GRAPH            |             |
| vulnerable     |                            | selected    |
| packages       |                            | package or  |
|                |                            | vulnerability|
+----------------+----------------------------+-------------+
```

Graph interactions:

- Pan and zoom.
- Select nodes.
- Expand and collapse relationships.
- Focus on selected package.
- Navigate to connected packages.
- Return to vulnerable package.
- Inspect individual paths.

Node types:

- `Project`: repository root.
- `Package`: resolved npm package and version.
- `Vulnerability`: CVE-Lite finding.

Future `File` and `Function` nodes are not required for MVP.

Visual semantics:

- Project and package nodes: neutral.
- Vulnerability nodes: red/error state.
- Selected node: clear highlighted state.
- Dependency edges: subtle and readable.

Use high information density, strong typography, clear hierarchy, and restrained decoration. Graph must remain understandable rather than visually overwhelming.

## 6. Analysis Workflow

When analysis starts, show progress for each stage:

```text
Repository loaded
package.json detected
package-lock.json detected
Dependencies parsed
Vulnerability scan completed
Dependency graph built
Graph stored in CognoDB
```

Recommended internal stages:

1. Load ZIP or clone public GitHub repository.
2. Validate required files.
3. Parse `package.json` and `package-lock.json`.
4. Run CVE-Lite.
5. Normalize CVE-Lite output.
6. Create/update graph in CognoDB.
7. Calculate summary counts.
8. Redirect to overview.

Every expensive operation needs a visible status, such as `Reading repository`, `Parsing dependency tree`, `Running vulnerability analysis`, `Building dependency graph`, or `Finding dependency paths`. UI must never appear frozen.

## 7. Dependency And Vulnerability Data

### Dependency parser

Capture from npm metadata:

- Package name.
- Resolved version.
- Dependency relationships.

Example:

```text
axios@1.8.4 -> follow-redirects@1.15.9
```

The parser must use lockfile-resolved data, not only version ranges from `package.json`.

### CVE-Lite adapter

DepGraph consumes CVE-Lite output and must not recreate vulnerability detection. Normalize supported output into an internal structure:

```ts
type VulnerabilityFinding = {
  packageName: string;
  installedVersion: string;
  severity: string;
  identifier?: string;
  affectedRange?: string;
};
```

Exact fields must follow the CVE-Lite output available during implementation.

### File-level reachability

File-level reachability maps repository source files to imported packages. It does not trace function calls or prove runtime execution.

Parse JavaScript/TypeScript imports such as:

```ts
import axios from "axios";
const axios = require("axios");
await import("axios");
```

Normalize each import into:

```ts
type FileImport = {
  filePath: string;
  packageName: string;
  importType: "static" | "require" | "dynamic";
  line: number;
};
```

File-level graph relationships:

```text
(:Project)-[:CONTAINS]->(:File)
(:File)-[:IMPORTS]->(:Package)
(:File)-[:IMPORTS_FILE]->(:File)
```

Example:

```text
Project
  -> src/api/client.ts
    -> axios@1.8.4
      -> follow-redirects@1.15.9
        -> Vulnerability
```

The source analyzer should resolve relative imports and common TypeScript extensions where practical. It may report files that directly import a vulnerable package or import a package that leads to one through the dependency graph.

This feature must be labeled **file-level import reachability**. It must not claim that vulnerable code executes. Dynamic imports, aliases, generated code, dead code, runtime configuration, and framework behavior can make static results incomplete.

## 8. Graph Model

Core model:

```text
(:Project)-[:DEPENDS_ON]->(:Package)
(:Project)-[:CONTAINS]->(:File)
(:File)-[:IMPORTS]->(:Package)
(:File)-[:IMPORTS_FILE]->(:File)
(:Package)-[:DEPENDS_ON]->(:Package)
(:Package)-[:HAS_VULNERABILITY]->(:Vulnerability)
```

Example:

```text
Project -> axios -> follow-redirects -> CVE
```

Required properties:

```text
Project       { id, name }
Package       { name, version }
Vulnerability { id, severity }
```

Use stable identifiers and uniqueness constraints so repeated graph construction does not create unintended duplicate nodes. Analysis data must remain scoped to its project/analysis identifier.

The important relationship is `DEPENDS_ON`. It enables reverse and multi-hop traversal from a vulnerable package to every package that can reach it.

## 9. Required Graph Operations

Use parameterized Cypher queries through the official Neo4j JavaScript driver.

Required operations:

- **Direct dependencies:** What does package X depend on?
- **Direct dependents:** What directly depends on package X?
- **Transitive dependents:** What ultimately depends on package X?
- **Dependency paths:** What paths connect project X to package Y?
- **Blast radius:** What packages are reachable by reverse traversal from vulnerable package X?
- **Multi-hop traversal:** Demonstrate paths of at least two hops.

File-level operations:

- Files that directly import a selected package.
- Files that import packages with a dependency path to a selected vulnerable package.

Reverse dependency search must support filters:

```text
Direct | Transitive | All
```

## 10. Blast Radius And Paths

Every vulnerability must expose `View blast radius`.

Blast-radius view must show:

- Vulnerable package and version.
- Severity and identifier when available.
- Number of dependent packages.
- Number of dependency paths.
- Direct path count.
- Transitive path count.
- Visual graph of affected relationships.

Users must be able to inspect each individual path. Each path must show:

- Starting project.
- Every dependency in order.
- Vulnerable package.
- Number of hops.

Example:

```text
4 hops
my-app -> package-a -> package-b -> axios -> follow-redirects [vulnerable]
```

### Package detail

Selecting a package opens a detail panel with:

- Name and resolved version.
- Type.
- Direct dependency count.
- Dependent count.
- Vulnerability count.
- Dependencies.
- Packages that use it.

Actions:

```text
Explore dependencies
Find dependents
Show paths
```

## 11. States And Errors

### Empty states

```text
No vulnerabilities found.
Your dependency tree contains no findings from the current vulnerability scan.
```

```text
No dependents found.
Nothing in this repository depends on this package.
```

### Required errors

- Invalid/unreadable repository: `We couldn't read this repository.`
- Invalid GitHub URL: `Please enter a valid public GitHub repository URL.`
- Missing `package.json`: explain that file was not found.
- Missing `package-lock.json`: explain npm lockfile is required to build resolved graph.
- CVE-Lite failure: explain vulnerability results could not be associated with graph.
- CognoDB unavailable: explain dependency graph is temporarily unavailable and offer retry.

Errors must be human-readable, actionable, and must not expose secrets or internal stack traces.

## 12. Technical Architecture

Recommended stack:

- Next.js.
- TypeScript.
- React.
- Tailwind CSS.
- Neo4j JavaScript Driver.
- CognoDB.
- CVE-Lite CLI.
- React Flow or another lightweight graph visualization library.

Keep responsibilities separated:

```text
Next.js UI
  -> Analysis API
    -> Repository loader
    -> Dependency parser
    -> CVE-Lite adapter
    -> Graph builder
    -> CognoDB query layer
```

Suggested structure:

```text
depgraph/
├── app/
│   ├── page.tsx
│   ├── analysis/[id]/page.tsx
│   ├── analysis/[id]/explore/page.tsx
│   ├── api/analyze/route.ts
│   ├── api/graph/route.ts
│   ├── api/vulnerabilities/route.ts
│   └── layout.tsx
├── components/
│   ├── analysis/
│   ├── graph/
│   ├── vulnerabilities/
│   └── ui/
├── lib/
│   ├── analysis/
│   ├── cognodb/
│   ├── cve-lite/
│   └── dependency-parser/
├── cypher/
│   ├── dependencies.cypher
│   ├── dependents.cypher
│   ├── paths.cypher
│   └── blast-radius.cypher
├── scripts/seed.ts
└── README.md
```

## 13. Security Requirements

- Keep `COGNODB_URI`, `COGNODB_USERNAME`, and `COGNODB_PASSWORD` server-side.
- Never expose database credentials to browser code.
- Never commit secrets to Git.
- Use parameterized Cypher queries.
- Validate uploaded files and GitHub URLs.
- Limit repository/archive size and reject unsupported input safely.
- Sanitize errors shown to users.

## 14. MVP Acceptance Criteria

MVP is complete when a user can:

### Repository

- Upload a supported npm repository ZIP or provide a public GitHub URL.
- Analyze a repository containing `package.json` and `package-lock.json`.
- Receive clear progress and failure states.

### Vulnerability analysis

- Run CVE-Lite successfully.
- See package name, installed version, severity, and available identifier.
- See an explicit no-vulnerabilities state.

### Graph

- Store project, package, dependency, and vulnerability data in CognoDB.
- Display package nodes and dependency relationships.
- Navigate at least two dependency hops.
- Avoid duplicate nodes during graph construction.

### Blast radius

- Select a vulnerable package.
- Find direct dependents.
- Find transitive dependents.
- Display direct, transitive, and total path counts.
- Inspect individual project-to-vulnerability paths.

### File reachability

- Display source files that import the vulnerable package or an affected dependency.
- Label results as file-level import reachability, not execution proof.

### Reliability and UX

- Handle invalid repositories, missing files, CVE-Lite failures, and CognoDB outages gracefully.
- Keep database access server-side.
- Provide a polished, desktop-first interface that remains usable on smaller screens.

## 15. Demo Scenario

Target duration: 2-3 minutes.

1. Open DepGraph and show the one-line value proposition.
2. Load a prepared npm repository.
3. Click `Analyze Repository`.
4. Show package and vulnerability summary.
5. Select a vulnerable package.
6. Click `View blast radius`.
7. Show one direct or transitive path from project to vulnerable package.
8. Show a second path and affected path counts.
9. Explain: CVE-Lite detects the vulnerability; CognoDB traverses relationships to explain impact.
10. Briefly show the graph model and parameterized traversal query.

## 16. Why Graph Database

Dependency impact is fundamentally a relationship-traversal problem:

```text
Project -> A -> B -> C -> Vulnerable package
```

The key question is not only which package record is vulnerable. It is:

> Which nodes can reach this vulnerable node through dependency relationships?

CognoDB directly models `DEPENDS_ON` and supports arbitrary reverse, multi-hop traversal. The graph must explain the blast radius, not merely decorate the interface.

## 17. Future Ideas

Only consider after MVP:

- Function-level reachability.
- Additional package managers.
- GitHub PR and CI/CD integration.
- Remediation and upgrade recommendations.
- Historical vulnerability tracking.
- Continuous monitoring.
- SBOM and SARIF export.
- Authentication.

## One-Sentence Definition

> DepGraph uses CVE-Lite to detect vulnerable npm dependencies and CognoDB to trace their direct and transitive dependency paths, giving developers a visual explanation of potential vulnerability blast radius.
