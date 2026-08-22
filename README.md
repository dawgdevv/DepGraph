# DepGraph

DepGraph shows why a vulnerable npm dependency affects a repository and how it reaches the application.

It combines vulnerability findings from **CVE-Lite** with dependency relationships stored in **CognoDB**. Developers can inspect direct and transitive paths, affected packages, and the potential blast radius of each finding.

## How It Works

```text
Repository ZIP or public GitHub URL
  -> Validate package.json and package-lock.json
  -> Parse the resolved npm dependency tree
  -> Detect vulnerable packages with CVE-Lite
  -> Store dependency relationships in CognoDB
  -> Trace paths from the project to each vulnerable package
  -> Show the blast radius in an interactive graph
```

For example, instead of only reporting `follow-redirects@1.15.9` as vulnerable, DepGraph explains how it enters the project:

```text
my-app -> api-client -> axios -> follow-redirects [vulnerable]
```

DepGraph explains impact; it does not replace a vulnerability scanner, modify dependencies, or automatically remediate findings.

## Development

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Other commands:

```bash
npm run lint
npm run build
npm start
```

Built with Next.js, React, TypeScript, and Tailwind CSS. CVE-Lite and CognoDB integration is planned as part of the MVP and is not implemented in the current scaffold.
