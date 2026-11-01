## Operator checkpoint: deploy `services/account` (PAN-4330 W-10)

All verbs and the `githubLogin` RPC change are implemented and tested. The Worker builds
clean with no credentials:

- `npm --prefix services/account run build:dry` exits 0 (dry-run deploy, no secrets needed)
- `npm run typecheck:account` exits 0

Nothing below this line can be run by an agent — it needs the operator's Cloudflare account
and GitHub OAuth app. `services/account/wrangler.jsonc` still has the all-zero placeholder
`database_id`; step 3 replaces it and that change should be committed.

### Deploy steps

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps):
   homepage `https://account.overdeck.ai`, authorization callback URL
   `https://account.overdeck.ai/auth/github/callback`. Note the client id and generate a
   client secret.
2. `cd services/account && npx wrangler login` (opens the browser for the Cloudflare
   account that owns the `overdeck.ai` zone).
3. `npx wrangler d1 create overdeck-account`, paste the printed `database_id` into
   `wrangler.jsonc` (replacing the all-zero placeholder), and commit that change.
4. `npx wrangler d1 migrations apply overdeck-account --remote` (applies
   `migrations/0001_init.sql` to the production database).
5. `npx wrangler secret put GITHUB_CLIENT_ID`, then
   `npx wrangler secret put GITHUB_CLIENT_SECRET`, then
   `npx wrangler secret put OWNER_GITHUB_ID` (your numeric GitHub id, from
   `https://api.github.com/users/<login>` → `id`).
6. `npx wrangler deploy` (uploads the Worker, binds D1, registers the hourly cron and the
   `account.overdeck.ai` custom domain).
7. Smoke test: `curl -s https://account.overdeck.ai/healthz` shows `"configured":true`;
   open `https://account.overdeck.ai/admin`, sign in with GitHub as the owner, add one
   tester by username, and have them sign in.
8. Rollback if needed: `npx wrangler rollback` returns to the previous Worker version (the
   D1 schema is additive and stays).

### Post-deploy acceptance check (this issue's new client)

From a machine with a fresh `OVERDECK_HOME` (or after `pan account logout` if already
signed in):

1. `pan account login` → open the printed URL, approve with your (owner) GitHub account.
2. `pan account status` prints `Signed in as <login>`.
3. `pan account logout` prints `Signed out.`

Full reference: [`docs/ACCOUNT-SERVICE.md`](https://github.com/eltmon/overdeck/blob/main/docs/ACCOUNT-SERVICE.md#deploy)
"Deploy" section, and [`/cli/account`](https://overdeck.ai/cli/account) for the CLI
commands.
