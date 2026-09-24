# Findings & Technical Context

## Environment & Tooling
- OS: Windows 10/11 x64
- Node.js: v22.20.0
- Package Manager: npm 10.9.3 (pnpm is not installed in Windows PATH; npm workspaces can be used directly or pnpm installed via npm)
- Docker Desktop: Installed at `C:\Program Files\Docker\Docker\Docker Desktop.exe`, WSL2 Ubuntu installed.
- Sample Data Available:
  - `D:\yukngaji\connections\followers_and_following\followers_1.json` (2.35 MB)
  - `D:\yukngaji\connections\followers_and_following\followers_2.json` (477 KB)
  - Format: Array of objects with `string_list_data: [{ href, value, timestamp }]`, matches SRS FR-1.1 (`value` = username).
- Database:
  - Requires PostgreSQL 16 with `pgvector` extension.
  - Image: `pgvector/pgvector:pg16`
  - Ports: 5432:5432
