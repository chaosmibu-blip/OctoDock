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
  scopes: ["repo", "read:user", "gist"],
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
  // 處理 204 No Content（例如 star_repo）
  if (res.status === 204) return { _status: 204 };
  return res.json();
}

/**
 * 取得 repo 的預設分支名稱（通常是 main 或 master）
 * 避免寫死 "main"，因為部分 repo 用 master 或其他名稱
 */
async function getDefaultBranch(owner: string, repo: string, token: string): Promise<string> {
  try {
    const repoData = await githubFetch(`/repos/${owner}/${repo}`, token) as { default_branch?: string };
    return repoData.default_branch ?? "main";
  } catch {
    return "main"; // API 失敗時 fallback
  }
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
  create_file: "github_create_file",
  update_file: "github_update_file",
  delete_file: "github_delete_file",
  list_branches: "github_list_branches",
  create_pr: "github_create_pr",
  merge_pr: "github_merge_pr",
  list_commits: "github_list_commits",
  create_repo: "github_create_repo",
  list_releases: "github_list_releases",
  create_release: "github_create_release",
  list_workflows: "github_list_workflows",
  trigger_workflow: "github_trigger_workflow",
  list_gists: "github_list_gists",
  create_gist: "github_create_gist",
  search_repos: "github_search_repos",
  search_issues: "github_search_issues",
  star_repo: "github_star_repo",
  fork_repo: "github_fork_repo",
  create_branch: "github_create_branch",
  list_runs: "github_list_runs",
  get_run: "github_get_run",
  create_review: "github_create_review",
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
Get the content of a file from a repository (automatically decoded from base64). Returns the file's SHA (needed for update_file/delete_file) followed by the content.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  path: File path within the repository (e.g. "src/index.ts")
  branch (optional): Branch name (default: repo's default branch)
### Example
octodock_do(app:"github", action:"get_file", params:{owner:"octocat", repo:"Hello-World", path:"README.md", branch:"feature-x"})`,

  create_file: `## github.create_file
Create a new file in a repository with a commit message.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  path: File path to create (e.g. "docs/guide.md")
  content: File content in plain text (will be base64 encoded automatically)
  message: Commit message
  branch (optional): Branch to commit to (default: repo's default branch)
### Example
octodock_do(app:"github", action:"create_file", params:{owner:"octocat", repo:"Hello-World", path:"docs/guide.md", content:"# Guide", message:"Add guide", branch:"feature-x"})`,

  update_file: `## github.update_file
Update an existing file in a repository. Requires the file's current SHA (get from get_file).
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  path: File path to update
  content: New file content in plain text
  message: Commit message
  sha: Current file SHA (required, obtain via get_file)
  branch (optional): Branch to commit to (default: repo's default branch)
### Example
octodock_do(app:"github", action:"update_file", params:{owner:"octocat", repo:"Hello-World", path:"README.md", content:"# Updated", message:"Update readme", sha:"abc123", branch:"feature-x"})`,

  delete_file: `## github.delete_file
Delete a file from a repository. Requires the file's current SHA.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  path: File path to delete
  message: Commit message
  sha: Current file SHA (required, obtain via get_file)
  branch (optional): Branch to delete from (default: repo's default branch)
### Example
octodock_do(app:"github", action:"delete_file", params:{owner:"octocat", repo:"Hello-World", path:"old-file.txt", message:"Remove old file", sha:"abc123", branch:"feature-x"})`,

  list_branches: `## github.list_branches
List branches for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"list_branches", params:{owner:"octocat", repo:"Hello-World"})`,

  create_pr: `## github.create_pr
Create a new pull request.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  title: PR title
  body: PR description
  head: Source branch name
  base (optional): Target branch name (default "main")
### Example
octodock_do(app:"github", action:"create_pr", params:{owner:"octocat", repo:"Hello-World", title:"Add feature", body:"Implements feature X", head:"feature-branch", base:"main"})`,

  merge_pr: `## github.merge_pr
Merge a pull request.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  pull_number: Pull request number
  merge_method (optional): "merge", "squash", or "rebase" (default "merge")
### Example
octodock_do(app:"github", action:"merge_pr", params:{owner:"octocat", repo:"Hello-World", pull_number:123})`,

  list_commits: `## github.list_commits
List recent commits for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  per_page (optional): Number of commits to return (default 20)
### Example
octodock_do(app:"github", action:"list_commits", params:{owner:"octocat", repo:"Hello-World"})`,

  create_repo: `## github.create_repo
Create a new repository for the authenticated user.
### Parameters
  name: Repository name
  description (optional): Repository description
  private (optional): Whether the repo is private (default false)
### Example
octodock_do(app:"github", action:"create_repo", params:{name:"my-new-repo", description:"A cool project", private:true})`,

  list_releases: `## github.list_releases
List releases for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"list_releases", params:{owner:"octocat", repo:"Hello-World"})`,

  create_release: `## github.create_release
Create a new release for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  tag_name: Tag name for the release (e.g. "v1.0.0")
  name: Release title
  body (optional): Release notes
  draft (optional): Whether this is a draft release (default false)
  target_commitish (optional): Branch or commit SHA for the tag (default: repo's default branch)
### Example
octodock_do(app:"github", action:"create_release", params:{owner:"octocat", repo:"Hello-World", tag_name:"v1.0.0", name:"Version 1.0", body:"First stable release"})`,

  list_workflows: `## github.list_workflows
List GitHub Actions workflows for a repository.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"list_workflows", params:{owner:"octocat", repo:"Hello-World"})`,

  trigger_workflow: `## github.trigger_workflow
Trigger a GitHub Actions workflow dispatch event.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  workflow_id: Workflow ID or filename (e.g. "deploy.yml")
  ref (optional): Branch to run the workflow on (default "main")
### Example
octodock_do(app:"github", action:"trigger_workflow", params:{owner:"octocat", repo:"Hello-World", workflow_id:"deploy.yml", ref:"main"})`,

  list_gists: `## github.list_gists
List the authenticated user's gists.
### Parameters
  per_page (optional): Number of gists to return (default 20)
### Example
octodock_do(app:"github", action:"list_gists", params:{})`,

  create_gist: `## github.create_gist
Create a new gist.
### Parameters
  description: Gist description
  files: Object mapping filename to {content: string}
  public (optional): Whether the gist is public (default false)
### Example
octodock_do(app:"github", action:"create_gist", params:{description:"My snippet", files:{"hello.js":{content:"console.log('hello')"}}, public:false})`,

  search_repos: `## github.search_repos
Search GitHub repositories by keyword.
### Parameters
  query: Search query
  per_page (optional): Number of results (default 10)
### Example
octodock_do(app:"github", action:"search_repos", params:{query:"react framework"})`,

  search_issues: `## github.search_issues
Search issues and pull requests across GitHub.
### Parameters
  query: Search query (supports GitHub search syntax)
  per_page (optional): Number of results (default 10)
### Example
octodock_do(app:"github", action:"search_issues", params:{query:"bug label:bug repo:octocat/Hello-World"})`,

  star_repo: `## github.star_repo
Star a repository for the authenticated user.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"star_repo", params:{owner:"octocat", repo:"Hello-World"})`,

  fork_repo: `## github.fork_repo
Fork a repository to the authenticated user's account.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
### Example
octodock_do(app:"github", action:"fork_repo", params:{owner:"octocat", repo:"Hello-World"})`,

  create_branch: `## github.create_branch
Create a new branch from an existing branch or the default branch.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  branch: New branch name to create
  from (optional): Source branch name (default: repo's default branch)
### Example
octodock_do(app:"github", action:"create_branch", params:{owner:"octocat", repo:"Hello-World", branch:"feature-x", from:"main"})`,

  list_runs: `## github.list_runs
List recent workflow runs for a repository. Shows run ID, status, conclusion, workflow name, and branch.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  workflow_id (optional): Filter by workflow ID or filename (e.g. "ci.yml")
  status (optional): Filter by status (queued, in_progress, completed)
### Example
octodock_do(app:"github", action:"list_runs", params:{owner:"octocat", repo:"Hello-World"})`,

  get_run: `## github.get_run
Get details of a specific workflow run, including status, conclusion, timing, and jobs.
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  run_id: Workflow run ID (from list_runs)
### Example
octodock_do(app:"github", action:"get_run", params:{owner:"octocat", repo:"Hello-World", run_id:12345})`,

  create_review: `## github.create_review
Create a review on a pull request (approve, request changes, or comment).
### Parameters
  owner: Repository owner (username or org)
  repo: Repository name
  pull_number: Pull request number
  event: Review action — APPROVE, REQUEST_CHANGES, or COMMENT
  body (optional): Review comment body
### Example
octodock_do(app:"github", action:"create_review", params:{owner:"octocat", repo:"Hello-World", pull_number:42, event:"APPROVE", body:"LGTM!"})`,
};

// ── do+help 架構：取得技能說明 ────────────────────────────
function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `github actions (${Object.keys(actionMap).length}):
  list_repos() — list your repositories
  get_repo(owner, repo) — get repo details (stars, forks, description)
  search_code(query) — search code across repos
  list_issues(owner, repo) — list open issues
  create_issue(owner, repo, title, body?, labels?) — create issue
  update_issue(owner, repo, issue_number, title?, body?, state?, labels?) — update issue
  list_prs(owner, repo) — list open pull requests
  get_pr(owner, repo, pull_number) — get PR details + diff stats
  create_comment(owner, repo, issue_number, body) — comment on issue/PR
  get_file(owner, repo, path, branch?) — get file content (includes SHA for update/delete)
  create_file(owner, repo, path, content, message, branch?) — create a file with commit
  update_file(owner, repo, path, content, message, sha, branch?) — update a file with commit
  delete_file(owner, repo, path, message, sha, branch?) — delete a file with commit
  list_branches(owner, repo) — list branches
  create_branch(owner, repo, branch, from?) — create a new branch
  list_runs(owner, repo, workflow_id?, status?) — list workflow runs
  get_run(owner, repo, run_id) — get workflow run details
  create_review(owner, repo, pull_number, event, body?) — review a PR
  create_pr(owner, repo, title, body, head, base?) — create pull request
  merge_pr(owner, repo, pull_number, merge_method?) — merge pull request
  list_commits(owner, repo, per_page?) — list recent commits
  create_repo(name, description?, private?) — create new repository
  list_releases(owner, repo) — list releases
  create_release(owner, repo, tag_name, name, body?, draft?, target_commitish?) — create release
  list_workflows(owner, repo) — list GitHub Actions workflows
  trigger_workflow(owner, repo, workflow_id, ref?) — trigger workflow dispatch
  list_gists(per_page?) — list your gists
  create_gist(description, files, public?) — create a gist
  search_repos(query, per_page?) — search repositories
  search_issues(query, per_page?) — search issues & PRs
  star_repo(owner, repo) — star a repository
  fork_repo(owner, repo) — fork a repository
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

    // 取得檔案內容：解碼 base64 並回傳純文字 + SHA（供 update/delete 使用）
    case "get_file": {
      const data = rawData as any;
      if (data.content && data.encoding === "base64") {
        const decoded = Buffer.from(data.content, "base64").toString("utf8");
        return `sha: ${data.sha}\n---\n${decoded}`;
      }
      return JSON.stringify(rawData, null, 2);
    }

    // 建立/更新操作：完成確認 + URL
    case "create_issue":
    case "update_issue":
    case "create_comment":
    case "create_pr":
    case "create_repo":
    case "create_release":
    case "create_gist":
    case "fork_repo": {
      const data = rawData as any;
      return `Done. URL: ${data.html_url}`;
    }

    // 檔案建立/更新/刪除：完成確認 + commit URL
    case "create_file":
    case "update_file":
    case "delete_file": {
      const data = rawData as any;
      return `Done. URL: ${data.content?.html_url ?? data.commit?.html_url ?? "N/A"}`;
    }

    // 合併 PR：完成確認
    case "merge_pr": {
      const data = rawData as any;
      return `Done. ${data.message ?? "Pull request merged."}`;
    }

    // 建立分支：回傳分支名稱
    case "create_branch": {
      const data = rawData as any;
      const branchName = data.ref?.replace("refs/heads/", "") ?? "unknown";
      return `Done. Branch "${branchName}" created.`;
    }

    // Workflow runs 列表
    case "list_runs": {
      const runs = (rawData as any).workflow_runs;
      if (!Array.isArray(runs) || runs.length === 0) return "No workflow runs found.";
      return runs.map((r: any) =>
        `- **${r.name}** #${r.run_number} (${r.status}${r.conclusion ? ` → ${r.conclusion}` : ""})\n  Branch: ${r.head_branch} | Run ID: ${r.id} | ${r.created_at}`
      ).join("\n");
    }

    // Workflow run 詳情
    case "get_run": {
      const r = rawData as any;
      let text = `Workflow: ${r.name} #${r.run_number}\nStatus: ${r.status}${r.conclusion ? ` → ${r.conclusion}` : ""}\nBranch: ${r.head_branch}\nTriggered: ${r.event} by ${r.actor?.login ?? "unknown"}\nCreated: ${r.created_at}\nUpdated: ${r.updated_at}`;
      if (r.jobs) {
        const jobs = Array.isArray(r.jobs) ? r.jobs : [];
        if (jobs.length > 0) {
          text += "\n\nJobs:";
          text += jobs.map((j: any) => `\n  - ${j.name}: ${j.status}${j.conclusion ? ` → ${j.conclusion}` : ""}`).join("");
        }
      }
      return text;
    }

    // PR Review
    case "create_review": {
      const r = rawData as any;
      return `Done. Review submitted: ${r.state ?? "unknown"}.${r.body ? ` Comment: "${r.body}"` : ""}`;
    }

    // Star 倉庫：204 No Content 成功
    case "star_repo": {
      return "Done. Repository starred successfully.";
    }

    // 觸發工作流程：204 No Content 成功
    case "trigger_workflow": {
      return "Done. Workflow dispatch triggered successfully.";
    }

    // 列出分支
    case "list_branches": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No branches found.";
        return rawData.map((b: any) =>
          `- **${b.name}**${b.protected ? " (protected)" : ""}`
        ).join("\n");
      }
      return String(rawData);
    }

    // 列出提交紀錄
    case "list_commits": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No commits found.";
        return rawData.map((c: any) => {
          const sha = c.sha?.substring(0, 7) ?? "???????";
          const msg = c.commit?.message?.split("\n")[0] ?? "";
          const author = c.commit?.author?.name ?? "unknown";
          const date = c.commit?.author?.date?.substring(0, 10) ?? "";
          return `- **${sha}** ${msg} (${author}, ${date})`;
        }).join("\n");
      }
      return String(rawData);
    }

    // 列出發佈版本
    case "list_releases": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No releases found.";
        return rawData.map((r: any) => {
          const date = r.published_at?.substring(0, 10) ?? "";
          return `- **${r.tag_name}** ${r.name ?? ""} (${date})`;
        }).join("\n");
      }
      return String(rawData);
    }

    // 列出工作流程
    case "list_workflows": {
      const data = rawData as any;
      const workflows = data.workflows ?? [];
      if (workflows.length === 0) return "No workflows found.";
      return workflows.map((w: any) =>
        `- **${w.name}** (id: ${w.id}, ${w.state})`
      ).join("\n");
    }

    // 列出 Gist
    case "list_gists": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No gists found.";
        return rawData.map((g: any) => {
          const desc = g.description || "No description";
          const fileCount = Object.keys(g.files ?? {}).length;
          return `- **${desc}** (files: ${fileCount}, ${g.html_url})`;
        }).join("\n");
      }
      return String(rawData);
    }

    // 搜尋倉庫
    case "search_repos": {
      const data = rawData as any;
      const items = data.items ?? [];
      if (items.length === 0) return "No repositories found.";
      return items.map((r: any) =>
        `- **${r.full_name}** ⭐ ${r.stargazers_count} | ${r.description || "No description"}`
      ).join("\n");
    }

    // 搜尋 Issue
    case "search_issues": {
      const data = rawData as any;
      const items = data.items ?? [];
      if (items.length === 0) return "No issues found.";
      return items.map((i: any) => {
        const repo = i.repository_url?.split("/").slice(-2).join("/") ?? "";
        return `- #${i.number} **${i.title}** (${i.state}, ${repo})`;
      }).join("\n");
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
      if (items.length === 0) return "No code results found.\nTip: GitHub code search may miss results due to indexing delay. Use get_file to read the file directly if you know the path.";
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
      "Get the content of a file from a repository. Returns SHA (for update/delete) and decoded content.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path within the repository (e.g., 'src/index.ts')"),
      branch: z.string().optional().describe("Branch name (default: repo's default branch)"),
    },
  },
  // ── 新增 18 個工具定義 ──────────────────────────────────
  {
    name: "github_create_file",
    description:
      "Create a new file in a repository with a commit. Content is provided as plain text and automatically base64-encoded.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path to create (e.g., 'docs/guide.md')"),
      content: z.string().describe("File content in plain text"),
      message: z.string().describe("Commit message"),
      branch: z.string().optional().describe("Branch to commit to (default: repo's default branch)"),
    },
  },
  {
    name: "github_update_file",
    description:
      "Update an existing file in a repository. Requires the file's current SHA (obtain via get_file). Content is plain text, automatically base64-encoded.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path to update"),
      content: z.string().describe("New file content in plain text"),
      message: z.string().describe("Commit message"),
      sha: z.string().describe("Current file SHA (required, obtain via get_file)"),
      branch: z.string().optional().describe("Branch to commit to (default: repo's default branch)"),
    },
  },
  {
    name: "github_delete_file",
    description:
      "Delete a file from a repository. Requires the file's current SHA (obtain via get_file).",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      path: z.string().describe("File path to delete"),
      message: z.string().describe("Commit message"),
      sha: z.string().describe("Current file SHA (required, obtain via get_file)"),
      branch: z.string().optional().describe("Branch to delete from (default: repo's default branch)"),
    },
  },
  {
    name: "github_list_branches",
    description:
      "List branches for a repository. Shows branch name and whether it is the default branch.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_create_pr",
    description:
      "Create a new pull request from a head branch to a base branch.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      title: z.string().describe("Pull request title"),
      body: z.string().describe("Pull request description"),
      head: z.string().describe("Source branch name"),
      base: z.string().optional().describe("Target branch name (default 'main')"),
    },
  },
  {
    name: "github_merge_pr",
    description:
      "Merge a pull request using the specified merge method.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("Pull request number"),
      merge_method: z.enum(["merge", "squash", "rebase"]).optional().describe("Merge method (default 'merge')"),
    },
  },
  {
    name: "github_list_commits",
    description:
      "List recent commits for a repository, showing SHA, message, author, and date.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      per_page: z.number().optional().describe("Number of commits to return (default 20)"),
    },
  },
  {
    name: "github_create_repo",
    description:
      "Create a new repository for the authenticated user.",
    inputSchema: {
      name: z.string().describe("Repository name"),
      description: z.string().optional().describe("Repository description"),
      private: z.boolean().optional().describe("Whether the repo is private (default false)"),
    },
  },
  {
    name: "github_list_releases",
    description:
      "List releases for a repository, showing tag, name, and publish date.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_create_release",
    description:
      "Create a new release for a repository with a tag, title, and optional release notes.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      tag_name: z.string().describe("Tag name for the release (e.g., 'v1.0.0')"),
      name: z.string().describe("Release title"),
      body: z.string().optional().describe("Release notes in Markdown"),
      draft: z.boolean().optional().describe("Whether this is a draft release (default false)"),
      target_commitish: z.string().optional().describe("Branch or commit SHA for the tag (default: repo's default branch)"),
    },
  },
  {
    name: "github_list_workflows",
    description:
      "List GitHub Actions workflows for a repository, showing name, ID, and state.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_trigger_workflow",
    description:
      "Trigger a GitHub Actions workflow dispatch event on a specified branch.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      workflow_id: z.union([z.string(), z.number()]).describe("Workflow ID or filename (e.g., 'deploy.yml')"),
      ref: z.string().optional().describe("Branch to run the workflow on (default 'main')"),
    },
  },
  {
    name: "github_list_gists",
    description:
      "List the authenticated user's gists, showing description, file count, and URL.",
    inputSchema: {
      per_page: z.number().optional().describe("Number of gists to return (default 20)"),
    },
  },
  {
    name: "github_create_gist",
    description:
      "Create a new gist with one or more files.",
    inputSchema: {
      description: z.string().describe("Gist description"),
      files: z.record(z.string(), z.object({ content: z.string() })).describe("Object mapping filename to {content: string}"),
      public: z.boolean().optional().describe("Whether the gist is public (default false)"),
    },
  },
  {
    name: "github_search_repos",
    description:
      "Search GitHub repositories by keyword. Returns repo name, stars, and description.",
    inputSchema: {
      query: z.string().describe("Search query"),
      per_page: z.number().optional().describe("Number of results (default 10)"),
    },
  },
  {
    name: "github_search_issues",
    description:
      "Search issues and pull requests across GitHub repositories.",
    inputSchema: {
      query: z.string().describe("Search query (supports GitHub search syntax)"),
      per_page: z.number().optional().describe("Number of results (default 10)"),
    },
  },
  {
    name: "github_star_repo",
    description:
      "Star a repository for the authenticated user.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_fork_repo",
    description:
      "Fork a repository to the authenticated user's account.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
    },
  },
  {
    name: "github_create_branch",
    description:
      "Create a new branch from an existing branch or the repo's default branch.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      branch: z.string().describe("New branch name to create"),
      from: z.string().optional().describe("Source branch name (default: repo's default branch)"),
    },
  },
  {
    name: "github_list_runs",
    description:
      "List recent GitHub Actions workflow runs for a repository. Shows run ID, status, conclusion, workflow name, branch, and timing.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      workflow_id: z.string().optional().describe("Filter by workflow ID or filename (e.g. 'ci.yml')"),
      status: z.string().optional().describe("Filter by status: queued, in_progress, completed"),
    },
  },
  {
    name: "github_get_run",
    description:
      "Get details of a specific GitHub Actions workflow run including status, conclusion, timing, trigger event, and jobs.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      run_id: z.number().describe("Workflow run ID (from list_runs)"),
    },
  },
  {
    name: "github_create_review",
    description:
      "Create a review on a pull request. Can approve, request changes, or leave a comment.",
    inputSchema: {
      owner: z.string().describe("Repository owner (username or organization)"),
      repo: z.string().describe("Repository name"),
      pull_number: z.number().describe("Pull request number"),
      event: z.string().describe("Review action: APPROVE, REQUEST_CHANGES, or COMMENT"),
      body: z.string().optional().describe("Review comment body (required for REQUEST_CHANGES)"),
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

    // 取得檔案內容（base64 解碼為純文字，支援指定分支）
    case "github_get_file": {
      const ref = params.branch ? `?ref=${params.branch}` : "";
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${params.path}${ref}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 新增 18 個動作 ──────────────────────────────────────

    // 建立檔案（內容自動 base64 編碼，支援指定分支）
    case "github_create_file": {
      const createBody: Record<string, unknown> = {
        message: params.message,
        content: Buffer.from(params.content as string).toString("base64"),
      };
      if (params.branch) createBody.branch = params.branch;
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify(createBody),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新檔案（需要提供目前的 SHA，支援指定分支）
    case "github_update_file": {
      const updateBody: Record<string, unknown> = {
        message: params.message,
        content: Buffer.from(params.content as string).toString("base64"),
        sha: params.sha,
      };
      if (params.branch) updateBody.branch = params.branch;
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
        token,
        {
          method: "PUT",
          body: JSON.stringify(updateBody),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除檔案（需要提供目前的 SHA，支援指定分支）
    case "github_delete_file": {
      const deleteBody: Record<string, unknown> = {
        message: params.message,
        sha: params.sha,
      };
      if (params.branch) deleteBody.branch = params.branch;
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/contents/${params.path}`,
        token,
        {
          method: "DELETE",
          body: JSON.stringify(deleteBody),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出倉庫分支
    case "github_list_branches": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/branches`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立 Pull Request
    case "github_create_pr": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/pulls`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            title: params.title,
            body: params.body,
            head: params.head,
            base: (params.base as string) || await getDefaultBranch(params.owner as string, params.repo as string, token),
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 合併 Pull Request
    case "github_merge_pr": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/merge`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            merge_method: (params.merge_method as string) || "merge",
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出倉庫提交紀錄
    case "github_list_commits": {
      const perPage = (params.per_page as number) || 20;
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/commits?per_page=${perPage}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新倉庫
    case "github_create_repo": {
      const body: Record<string, unknown> = { name: params.name };
      if (params.description) body.description = params.description;
      body.private = params.private ?? false;

      const result = await githubFetch("/user/repos", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出倉庫發佈版本
    case "github_list_releases": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/releases`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新發佈版本
    case "github_create_release": {
      const body: Record<string, unknown> = {
        tag_name: params.tag_name,
        name: params.name,
      };
      if (params.body) body.body = params.body;
      body.draft = params.draft ?? false;
      if (params.target_commitish) body.target_commitish = params.target_commitish;

      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/releases`,
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

    // 列出 GitHub Actions 工作流程
    case "github_list_workflows": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/actions/workflows`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 觸發 GitHub Actions 工作流程
    case "github_trigger_workflow": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflow_id}/dispatches`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            ref: (params.ref as string) || await getDefaultBranch(params.owner as string, params.repo as string, token),
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出用戶的 Gist
    case "github_list_gists": {
      const perPage = (params.per_page as number) || 20;
      const result = await githubFetch(
        `/gists?per_page=${perPage}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新 Gist
    case "github_create_gist": {
      const result = await githubFetch("/gists", token, {
        method: "POST",
        body: JSON.stringify({
          description: params.description,
          files: params.files,
          public: params.public ?? false,
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 搜尋倉庫
    case "github_search_repos": {
      const perPage = (params.per_page as number) || 10;
      const result = await githubFetch(
        `/search/repositories?q=${encodeURIComponent(params.query as string)}&per_page=${perPage}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 搜尋 Issue 與 PR
    case "github_search_issues": {
      const perPage = (params.per_page as number) || 10;
      const result = await githubFetch(
        `/search/issues?q=${encodeURIComponent(params.query as string)}&per_page=${perPage}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 為倉庫加星（回傳 204 No Content）
    case "github_star_repo": {
      const result = await githubFetch(
        `/user/starred/${params.owner}/${params.repo}`,
        token,
        { method: "PUT" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新分支（先取得來源分支的 SHA，再建立 ref）
    case "github_create_branch": {
      // 取得來源分支的最新 commit SHA
      const sourceBranch = (params.from as string) || await getDefaultBranch(params.owner as string, params.repo as string, token);
      const refData = await githubFetch(
        `/repos/${params.owner}/${params.repo}/git/ref/heads/${sourceBranch}`,
        token,
      ) as { object: { sha: string } };
      const sha = refData.object.sha;

      // 建立新分支
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/git/refs`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            ref: `refs/heads/${params.branch}`,
            sha,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // Fork 倉庫
    case "github_fork_repo": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/forks`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出 workflow runs
    case "github_list_runs": {
      const workflowId = params.workflow_id as string | undefined;
      const status = params.status as string | undefined;
      let path = workflowId
        ? `/repos/${params.owner}/${params.repo}/actions/workflows/${workflowId}/runs`
        : `/repos/${params.owner}/${params.repo}/actions/runs`;
      const qParams = new URLSearchParams();
      if (status) qParams.set("status", status);
      qParams.set("per_page", "20");
      path += `?${qParams.toString()}`;

      const result = await githubFetch(path, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得 workflow run 詳情
    case "github_get_run": {
      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/actions/runs/${params.run_id}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立 PR review
    case "github_create_review": {
      const body: Record<string, unknown> = {
        event: params.event,
      };
      if (params.body) body.body = params.body;

      const result = await githubFetch(
        `/repos/${params.owner}/${params.repo}/pulls/${params.pull_number}/reviews`,
        token,
        { method: "POST", body: JSON.stringify(body) },
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
