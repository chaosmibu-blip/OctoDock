/**
 * GitHub patch_file 輔助模組
 * 讓 AI 透過 find/replace 局部修改檔案，不需要傳完整內容
 * 解決 MCP 回傳壓縮（3K 上限）導致無法修改大檔案的問題
 */

const GITHUB_API = "https://api.github.com";

async function githubFetchRaw(
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

export interface PatchFileParams {
  owner: string;
  repo: string;
  path: string;
  find: string;
  replace: string;
  message: string;
  branch?: string;
}

export interface PatchFileResult {
  ok: boolean;
  data?: string;
  error?: string;
}

/**
 * 局部修改 GitHub 檔案：
 * 1. Server 端讀取完整檔案（不受 MCP 回傳壓縮限制）
 * 2. 執行 find/replace
 * 3. 推回 GitHub
 *
 * AI 端只需傳 find + replace 字串，不需要碰完整內容
 */
export async function executePatchFile(
  params: PatchFileParams,
  token: string,
): Promise<PatchFileResult> {
  const { owner, repo, path, find, replace, message, branch } = params;

  try {
    // 1. 取得檔案（server 端，完整內容）
    const ref = branch ? `?ref=${branch}` : "";
    const fileData = await githubFetchRaw(
      `/repos/${owner}/${repo}/contents/${path}${ref}`,
      token,
    ) as { content?: string; sha?: string; encoding?: string };

    if (!fileData.content || !fileData.sha) {
      return { ok: false, error: `File not found or empty: ${path}` };
    }

    // 2. 解碼 base64 內容
    const content = Buffer.from(fileData.content, "base64").toString("utf-8");

    // 3. 檢查 find 字串是否存在
    const matchCount = content.split(find).length - 1;
    if (matchCount === 0) {
      return {
        ok: false,
        error: `Find string not found in ${path}. File has ${content.length} chars, ${content.split("\n").length} lines.`,
      };
    }
    if (matchCount > 1) {
      return {
        ok: false,
        error: `Find string matches ${matchCount} times in ${path}. Must be unique (exactly 1 match). Try a longer/more specific find string.`,
      };
    }

    // 4. 執行替換
    const newContent = content.replace(find, replace);

    // 5. 推回 GitHub
    const updateBody: Record<string, unknown> = {
      message,
      content: Buffer.from(newContent).toString("base64"),
      sha: fileData.sha,
    };
    if (branch) updateBody.branch = branch;

    await githubFetchRaw(
      `/repos/${owner}/${repo}/contents/${path}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify(updateBody),
      },
    );

    // 6. 回傳成功訊息（含 diff 預覽）
    const findPreview = find.length > 80 ? find.substring(0, 80) + "..." : find;
    const replacePreview = replace.length > 80 ? replace.substring(0, 80) + "..." : replace;

    return {
      ok: true,
      data: `Patched ${path}\n- Found: ${findPreview}\n+ Replace: ${replacePreview}\nCommit: ${message}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `patch_file failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
