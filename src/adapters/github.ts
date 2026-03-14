/**
 * GitHub Adapter
 * 提供 GitHub 倉庫管理、Issue、PR、程式碼搜尋等功能
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  scopes: ["repo", "read:user"],
  authMethod: "post",
};

// ── API 基礎設定 ───────────────────────────────────────────
const GITHUB_API = "https://api.github.com";

// ── 輔助函式：GitHub API 請求封裝 ──────────────────────────
async function githubFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    const status = res.status;
    throw new Error(
      JSON.stringify({ status, message: (error as { message: string }).message }),
    );
  }
  return res.json();
}

// ── do+help 架構：動作對照表 ──────────────────────────────
// 將自然語言動作名稱對應到 MCP 工具名稱
const actionMap: Record<string, string> = {
  list_repos: "github_list_repos",
  get_repo: "github_get_repo",
  search_code: "github_search_code",
  list_issues: "github_list_issues",
  create_issue: "github_create_issue",
  update_issue: "github_update_issue",
  list_prs: "github_list_prs",
  get_pr: "github_get_pr",
  create_comment: "github_create_comment",
  get_file: "github_get_file",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  list_repos: `## github.list_repos
List the authenticated user's repositories, sorted by last updated.
### Parameters
  (no required parameters)
### Example
octodock_do(app:"github", action:"list_repos", params:{})`,

  get_repo: `## github.get_repo
Get detailed information about a specific repository (stars, forks, description, etc.).
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"get_repo", params:{owner:"octocat", repo:"Hello-World"})`,

  search_code: `## github.search_code
Search code across all GitHub repositories.
### Parameters
  query: Search query (supports GitHub code search syntax, e.g. "useState repo:facebook/react")
### Example
octodock_do(app:"github", action:"search_code", params:{query:"className repo:vercel/next.js language:typescript"})`,

  list_issues: `## github.list_issues
List open issues for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"list_issues", params:{owner:"octocat", repo:"Hello-World"})`,

  create_issue: `## github.create_issue
Create a new issue in a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  title: Issue title
  body (optional): Issue body in Markdown
  labels (optional): Array of label names, e.g. ["bug", "urgent"]
### Example
octodock_do(app:"github", action:"create_issue", params:{
  owner:"octocat", repo:"Hello-World",
  title:"Fix login page bug",
  body:"The login button is not responding on mobile.",
  labels:["bug"]
})`,

  update_issue: `## github.update_issue
Update an existing issue (change title, body, state, or labels).
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  issue_number: Issue number
  title (optional): New title
  body (optional): New body
  state (optional): "open" or "closed"
  labels (optional): Array of label names
### Example
octodock_do(app:"github", action:"update_issue", params:{
  owner:"octocat", repo:"Hello-World",
  issue_number:42,
  state:"closed"
})`,

  list_prs: `## github.list_prs
List open pull requests for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"list_prs", params:{owner:"octocat", repo:"Hello-World"})`,

  get_pr: `## github.get_pr
Get pull request details including diff stats.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  pull_number: Pull request number
### Example
octodock_do(app:"github", action:"get_pr", params:{owner:"octocat", repo:"Hello-World", pull_number:123})`,

  create_comment: `## github.create_comment
Comment on an issue or pull request.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  issue_number: Issue or PR number
  body: Comment body in Markdown
### Example
octodock_do(app:"github", action:"create_comment", params:{
  owner:"octocat", repo:"Hello-World",
  issue_number:42,
  body:"Looks good! Merging now."
})`,

  get_file: `## github.get_file
Get the content of a file from a repository (automatically decoded from base64).
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  path: File path within the repository (e.g. "src/index.ts")
### Example
octodock_do(app:"github", action:"get_file", params:{owner:"octocat", repo:"Hello-World", path:"README.md"})`,
};

// ── do+help 架構：取得技能說明 ────────────────────────────
function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `github actions:
  list_repos() — list your repositories
  get_repo(owner, repo) — get repo details (stars, forks, description)
  search_code(query) — search code across repos
  list_issues(owner, repo) — list open issues
  create_issue(owner, repo, title, body?, labels?) — create issue
  update_issue(owner, repo, issue_number, title?, body?, state?, labels?) — update issue
  list_prs(owner, repo) — list open pull requests
  get_pr(owner, repo, pull_number) — get PR details + diff stats
  create_comment(owner, repo, issue_number, body) — comment on issue/PR
  get_file(owner, repo, path) — get file content
Use octodock_help(app:"github", action:"ACTION") for detailed params + example.`;
}

// ── do+help 架構：格式化回應（將原始資料轉為簡潔文字）────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);

  switch (action) {
    // 倉庫列表：精簡摘要
    case "list_repos": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No repositories found.";
        return rawData.map((r: any) =>
          `- **${r.full_name}** ⭐ ${r.stargazers_count} | ${r.description || "No description"}`
        ).join("\n");
      }
      return String(rawData);
    }

    // Issue 列表：編號、標題、狀態、作者
    case "list_issues": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No issues found.";
        return rawData.map((i: any) =>
          `- #${i.number} **${i.title}** (${i.state}) by ${i.user?.login ?? "unknown"}`
        ).join("\n");
      }
      return String(rawData);
    }

    // PR 列表：編號、標題、狀態、作者
    case "list_prs": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No pull requests found.";
        return rawData.map((p: any) =>
          `- #${p.number} **${p.title}** (${p.state}) by ${p.user?.login ?? "unknown"}`
        ).join("\n");
      }
      return String(rawData);
    }

    // 取得檔案內容：解碼 base64 並回傳純文字
    case "get_file": {
      const data = rawData as any;
      if (data.content && data.encoding === "base64") {
        const decoded = Buffer.from(data.content, "base64").toString("utf8");
        return decoded;
      }
      return JSON.stringify(rawData, null, 2);
    }

    // 建立/更新操作：完成確認 + URL
    case "create_issue":
    case "update_issue":
    case "create_comment": {
      const data = rawData as any;
      return `Done. URL: ${data.html_url}`;
    }

    // 倉庫詳情
    case "get_repo": {
      const r = rawData as any;
      return [
        `**${r.full_name}**`,
        r.description ? `> ${r.description}` : null,
        `⭐ ${r.stargazers_count} | 🍴 ${r.forks_count} | 👁 ${r.watchers_count}`,
        `Language: ${r.language ?? "N/A"} | Default branch: ${r.default_branch}`,
        `URL: ${r.html_url}`,
      ].filter(Boolean).join("\n");
    }

    // PR 詳情：包含 diff 統計
    case "get_pr": {
      const p = rawData as any;
      return [
        `#${p.number} **${p.title}** (${p.state}) by ${p.user?.login ?? "unknown"}`,
        p.body ? `\n${p.body}` : null,
        `\n+${p.additions ?? 0} -${p.deletions ?? 0} | ${p.changed_files ?? 0} files changed`,
        `Mergeable: ${p.mergeable ?? "unknown"} | URL: ${p.html_url}`,
      ].filter(Boolean).join("\n");
    }

    // 程式碼搜尋結果
    case "search_code": {
      const data = rawData as any;
      const items = data.items ?? [];
      if (items.length === 0) return "No code results found.";
      return items.map((item: any) =>
        `- **${item.repository?.full_name}** ${item.path}\n  ${item.html_url}`
      ).join("\n");
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導：處理常見 GitHub API 錯誤 ────────────────
function formatError(action: string, errorMessage: string): string | null {
  try {
    const parsed = JSON.parse(errorMessage);
    const status = parsed.status as number;
    const message = parsed.message as string;

    // 404：資源不存在
    if (status === 404) {
      return `「找不到資源 (GITHUB_NOT_FOUND)」\nThe repository, issue, or file was not found. Please check the owner, repo name, and resource ID.\nAPI message: ${message}`;
    }

    // 403：權限不足或速率限制
    if (status === 403) {
      if (message?.toLowerCase().includes("rate limit")) {
        return `「已達 API 速率限制 (GITHUB_RATE_LIMITED)」\nGitHub API rate limit exceeded (5000 requests/hour). Please wait and try again later.`;
      }
      return `「權限不足 (GITHUB_FORBIDDEN)」\nYou don't have permission for this action. Please check that the GitHub OAuth scope includes "repo".\nAPI message: ${message}`;
    }

    // 422：驗證錯誤（例如缺少必要欄位）
    if (status === 422) {
      return `「驗證失敗 (GITHUB_VALIDATION_ERROR)」\nThe request was invalid. Please check the parameters.\nAPI message: ${message}`;
    }

    return null;
  } catch {
    // 如果不是 JSON 格式的錯誤，回傳 null 讓系統使用預設處理
    return null;
  }
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "github_list_repos",
    description:
      "List the authenticated user's repositories, sorted by last updated. Returns repo name, stars, and description.",
    inputSchema: {},
  },
  {
    name: "github_get_repo",
    description:
      "Get detailed information about a specific repository including stars, forks, description, language, and default branch.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_search_code",
    description:
      "Search code across GitHub repositories. Supports GitHub code search syntax (e.g., 'query repo:owner/repo language:typescript').",
    inputSchema: {
      query: z.string().describe("Search query using GitHub code search syntax"),
    },
  },
  {
    name: "github_list_issues",
    description:
      "List open issues for a repository. Returns issue number, title, state, and author.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_create_issue",
    description:
      "Create a new issue in a repository with title, optional body, and optional labels.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("Issue title"),
      body: z.string().optional().describe("Issue body in Markdown"),
      labels: z.array(z.string()).optional().describe("Array of label names"),
    },
  },
  {
    name: "github_update_issue",
    description:
      "Update an existing issue. Can change title, body, state (open/closed), or labels.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue number"),
      title: z.string().optional().describe("New issue title"),
      body: z.string().optional().describe("New issue body"),
      state: z.enum(["open", "closed"]).optional().describe("Issue state"),
      labels: z.array(z.string()).optional().describe("Array of label names"),
    },
  },
  {
    name: "github_list_prs",
    description:
      "List open pull requests for a repository. Returns PR number, title, state, and author.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_get_pr",
    description:
      "Get pull request details including title, body, diff stats (additions, deletions, changed files), and merge status.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("Pull request number"),
    },
  },
  {
    name: "github_create_comment",
    description:
      "Post a comment on an issue or pull request. Supports Markdown formatting.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      issue_number: z.number().describe("Issue or pull request number"),
      body: z.string().describe("Comment body in Markdown"),
    },
  },
  {
    name: "github_get_file",
    description:
      "Get the content of a file from a repository. The file content is automatically decoded from base64 to plain text.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path within the repository (e.g., 'src/index.ts')"),
    },
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 列出用戶的倉庫，按最近更新排序
    case "github_list_repos": {
      const result = await githubFetch(
        "/user/repos?sort=updated&per_page=20",
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得單一倉庫詳情（星星、分支、描述等）
    case "github_get_repo": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 跨倉庫搜尋程式碼
    case "github_search_code": {
      const result = await githubFetch(
        `/search/code?q=${encodeURIComponent(params.query as string)}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出倉庫的開放 Issue
    case "github_list_issues": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/issues?state=open`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新 Issue（包含標題、內容、標籤）
    case "github_create_issue": {
      const body: Record<string, unknown> = {
        title: params.title,
      };
      if (params.body) body.body = params.body;
      if (params.labels) body.labels = params.labels;

      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/issues`,
        token,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新 Issue（標題、內容、狀態、標籤）
    case "github_update_issue": {
      const body: Record<string, unknown> = {};
      if (params.title !== undefined) body.title = params.title;
      if (params.body !== undefined) body.body = params.body;
      if (params.state !== undefined) body.state = params.state;
      if (params.labels !== undefined) body.labels = params.labels;

      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出倉庫的開放 PR
    case "github_list_prs": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/pulls?state=open`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得 PR 詳情（包含 diff 統計資訊）
    case "github_get_pr": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 在 Issue/PR 上留言
    case "github_create_comment": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/issues/${params.issue_number}/comments`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ body: params.body }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得檔案內容（base64 解碼為純文字）
    case "github_get_file": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新：GitHub token 不會過期，保留骨架供未來使用 ─
async function refreshGithubToken(refreshToken: string): Promise<TokenSet> {
  // GitHub OAuth token 不會過期，不需要刷新機制
  // 保留此函式骨架，以便未來 GitHub App 安裝 token 可能需要刷新時使用
  return {
    access_token: refreshToken,
    refresh_token: refreshToken,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const githubAdapter: AppAdapter = {
  name: "github",
  displayName: { zh: "GitHub", en: "GitHub" },
  icon: "github",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: refreshGithubToken,
};
