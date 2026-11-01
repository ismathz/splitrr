import {
  normalizeTelegramBotToken,
  telegramTokenFingerprint,
  WEBAPP_HMAC_ALGO
} from "@splitbot/shared";

export type TelegramDiag = {
  hmacAlgo: string;
  gitSha: string;
  token: {
    configured: boolean;
    botId: string | null;
    tokenSuffix: string | null;
  };
  expectedUsername: string;
  getMe: {
    ok: boolean;
    id?: number;
    username?: string;
    error?: string;
  };
  tokenMatchesExpectedBot: boolean | null;
};

function resolveGitSha(): string {
  const fromEnv =
    process.env.GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim()?.slice(0, 7) ||
    "";
  if (fromEnv) return fromEnv;

  const cwds = [process.cwd(), `${process.cwd()}/../..`, `${process.cwd()}/..`];
  for (const cwd of cwds) {
    try {
      const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
        cwd,
        stdout: "pipe",
        stderr: "pipe"
      });
      if (proc.exitCode === 0) {
        const sha = new TextDecoder().decode(proc.stdout).trim();
        if (sha) return sha;
      }
    } catch {
      /* try next */
    }
  }
  return "unknown";
}

export async function buildTelegramDiag(input: {
  botToken: string | undefined;
  expectedUsername: string;
}): Promise<TelegramDiag> {
  const token = input.botToken
    ? normalizeTelegramBotToken(input.botToken)
    : "";
  const fp = telegramTokenFingerprint(token || null);
  const expectedUsername = input.expectedUsername.replace(/^@/, "").trim();

  const diag: TelegramDiag = {
    hmacAlgo: WEBAPP_HMAC_ALGO,
    gitSha: resolveGitSha(),
    token: {
      configured: fp.configured,
      botId: fp.botId,
      tokenSuffix: fp.tokenSuffix
    },
    expectedUsername,
    getMe: { ok: false },
    tokenMatchesExpectedBot: null
  };

  if (!token) {
    diag.getMe = { ok: false, error: "token_not_configured" };
    return diag;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = (await res.json()) as {
      ok?: boolean;
      description?: string;
      result?: { id?: number; username?: string };
    };
    if (!json.ok || !json.result) {
      diag.getMe = {
        ok: false,
        error: json.description || `http_${res.status}`
      };
      return diag;
    }
    const username = json.result.username ?? "";
    diag.getMe = {
      ok: true,
      id: json.result.id,
      username
    };
    diag.tokenMatchesExpectedBot = expectedUsername
      ? username.toLowerCase() === expectedUsername.toLowerCase()
      : null;
  } catch (err) {
    diag.getMe = {
      ok: false,
      error: err instanceof Error ? err.message : "getMe_failed"
    };
  }

  return diag;
}
