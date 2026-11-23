# Deployment

Choose a static frontend unless temporary relay credentials need a service you operate. Signaling,
STUN and TURN can be hosted independently from the site. Cloudflare Tunnel is optional ingress;
Cloudflare TURN is a separate optional credential provider.

| Option                    | Artifact                                     | Runtime                                                   | Credential API               |
| ------------------------- | -------------------------------------------- | --------------------------------------------------------- | ---------------------------- |
| Any static HTTPS host/CDN | `dist/`                                      | Static host only                                          | External endpoint, or none   |
| GitHub Pages              | `dist/`                                      | GitHub Actions and Pages                                  | External endpoint, or none   |
| Vercel                    | `dist/` and optional `api/*.ts` functions    | CDN, optional Node functions                              | Included adapters if enabled |
| VPS without containers    | `dist/`, optionally `dist-server/server.mjs` | Existing web server, optionally Node                      | Same origin or separate      |
| VPS Compose               | Docker `app` target                          | One nonroot Node container serving files and optional API | Same origin                  |
| Static container          | Docker `static` target                       | Nonroot nginx, no Node                                    | External endpoint, or none   |

## Static hosting

```bash
pnpm install --frozen-lockfile
pnpm build:client
```

Publish `dist/`, never the source repository or `.env`. Serve HTTPS for browser WebRTC/pointer
features. Solo and STUN-only multiplayer need no project function. Replace `ice-servers.json` with
your STUN configuration or set public build variables. For a separately hosted credential API,
configure `VITE_TURN_CREDENTIALS_URL=https://your-api.example/api/turn-credentials` and allow your
frontend origin on that API. Do not put a provider token in a build variable.

Hash-named assets can use immutable long caching. HTML and ICE configuration should revalidate;
credentials must never be cached by a CDN. `vite preview` is a local preview tool, not a production
server. An existing nginx/Caddy/static hosting service can serve this artifact with no new container.

## GitHub Pages

1. Fork this repository or copy it into a repository with GitHub Pages available. In **Settings →
   Pages → Build and deployment**, choose **GitHub Actions** as the source.
2. In **Actions**, enable workflows if GitHub prompts you to. Open **Publish GitHub Pages →
   Run workflow** and select your default branch.
3. Open the Pages URL shown by the deployment job. Run the workflow again after changes you want
   to publish.

The workflow reads the site's base path from Pages and passes it to Vite, so a project site such as
`https://owner.github.io/renamed-repo/` loads its bundles and `ice-servers.json` under
`/renamed-repo/`. A user site or custom domain at the root uses `/`. Configure a custom domain in
**Settings → Pages** before publishing to it.

Pages serves the static frontend and its STUN configuration. Multiplayer uses PeerServer Cloud for
signaling by default, and player traffic follows the WebRTC routes available on their networks.
The workflow derives the lobby namespace from the owner and repository name. Set
`VITE_LOBBY_NAMESPACE` as an Actions repository variable if you want to share lobbies deliberately
or keep the same namespace after renaming the repository.

For networks that need a relay, set the Actions repository variable `VITE_TURN_CREDENTIALS_URL` to
your external HTTPS credentials endpoint. Allow the Pages site's origin on that service, such as
`ALLOWED_ORIGINS=https://owner.github.io` for the Paper Shooter adapter. Use the domain and scheme
without the project subpath. Keep provider secrets on the credential server.

See [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Existing VPS / Compose workflow

```bash
cp .env.example .env
# Edit public configuration and, optionally, select/configure a TURN provider.
docker compose up --build -d --remove-orphans
```

The default site stays at `127.0.0.1:8901` (`PAPERSHOOT_PORT` overrides it). Point the existing HTTPS
ingress/tunnel at that loopback listener. The service serves frontend and API in one container;
the previous `turn-api` container is replaced, which is why upgrading uses `--remove-orphans`.
There are no persistent game databases or volumes. Private secrets are runtime environment values,
not build arguments. The origin must remain private when trusting a forwarded client IP header.

Compose uses `/api/ice-servers` and `/api/turn-credentials` by default. With `TURN_PROVIDER=none`,
credential requests return 503 and play uses available direct/STUN routes. An explicitly empty
`VITE_TURN_CREDENTIALS_URL` disables credential requests. Changing private/provider/STUN environment
values requires container recreation; changing browser `VITE_*` variables requires rebuilding.

Preserve the existing private `.env` values when upgrading. Set a deployment-specific
`VITE_LOBBY_NAMESPACE`, for example `didaskalia-papershooter-v1-`, before building; use a different
value for previews. The Paper defaults now isolate discovery from upstream Doodle clients even when
both use PeerServer Cloud. Existing clients must reload and open new lobbies after this change.
Changing only the container runtime environment cannot update a namespace already bundled into
browser JavaScript. See [networking](networking.md) for discovery and signaling boundaries.

The multi-stage build pins base image digests, installs the locked dependencies once, compiles the
frontend/server and copies only runtime artifacts. The `app` target runs as `node`, drops
capabilities, uses a read-only filesystem and has a health check. It contains no application
`node_modules`, build toolchain, repository metadata or provider `.env` file. The Node base still
includes its own package-manager tools. Debian slim retains glibc compatibility for Node. See
[ADR 0004](adr/0004-deployment.md) for the alternatives.

## Static container

```bash
docker build --target static -t papershooter-static .
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --tmpfs /tmp -p 127.0.0.1:8901:8080 papershooter-static
```

This target uses the portable static ICE configuration and does not proxy to an API. Use an external
HTTPS credentials URL at build time if needed. It is smaller than the Node variant but cannot keep
a TURN signing secret by itself. The Alpine image is a static nginx runtime; the Node build/API
runtime uses Debian slim. Compare real image sizes on your target architecture instead of assuming
that one base distribution improves gameplay performance.

## Vercel

1. Click **Deploy with Vercel** in the [README](../README.md#deploy), sign in and authorize access
   to the Git account where Vercel will create the repository.
2. Choose where to create the project and cloned repository. The button prefills
   `ENABLE_EXPERIMENTAL_COREPACK=1` so Corepack can use the pinned pnpm version (12.18.0).
   Select Node 22.x at 22.23.1 or newer, or a newer supported Node version.
3. Deploy and open the generated HTTPS URL. `vercel.json` supplies the locked installation,
   `pnpm build:client` command and `dist/` output path. The basic setup uses the bundled
   STUN configuration and requires no TURN-provider credentials.

Before sharing the deployment for multiplayer, set a unique public `VITE_LOBBY_NAMESPACE` in
project settings and redeploy. Use a different value for previews. For optional TURN, configure the
private runtime variables from [networking](networking.md#private-runtime-configuration) in the Vercel
project, set the public `VITE_TURN_CREDENTIALS_URL=/api/turn-credentials`, and redeploy. The
`api/turn-credentials.ts` function issues temporary credentials.

PeerServer signaling runs separately and browsers connect to WebRTC directly. Apply an edge rate
limit if the credential route is enabled, since each serverless instance has its own limiter.
See [Vercel's deploy button guide](https://vercel.com/docs/deploy-button).

## Verify a deployment

1. Open the published HTTPS URL, choose **Paper Mexico**, and start solo. Check that the map and
   first wave load.
2. On the published URL, open **Play Online** from two browser profiles, create a private lobby
   in one, then join by code from the other. Confirm both see the same roster. If the connection
   fails on the target networks, check signaling and relay configuration separately from hosting.
3. In the browser's Network tab, check that the client assets and ICE JSON load from the published
   base path. If TURN is enabled, also check the credential request returns a successful JSON
   response from the configured endpoint.

## Native Node option

```bash
pnpm build
pnpm start
```

The bundled service listens on `127.0.0.1:3000` and reads `.env` if present. Place it behind HTTPS
ingress and a process supervisor. Set `STATIC_DIR` to serve another build directory. Only the
compiled server file, static artifact and Node runtime are required to run it.

Inspect logs with `docker compose logs --tail=100 papershooter` and check `/healthz` through your
origin listener. Keep a previously built image tag for rollback. Review new dependency/base image
digests and run the checks before publishing replacements.
