# Networking

The game runs in browsers. The host browser manages lobby membership, scores, clock and host
migration. Players simulate their own bodies and report damage/events. This is not a cheat-resistant
authoritative game server. Changing that trust model would require a protocol/gameplay redesign.

| Component              | Role                                                                         | Required                                           |
| ---------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| Static host            | Serves the compiled frontend                                                 | All play                                           |
| PeerServer             | Exchanges PeerJS signaling/connection metadata                               | Multiplayer                                        |
| STUN                   | Discovers public addresses and candidates                                    | Optional, improves direct connectivity             |
| TURN                   | Relays WebRTC traffic when direct routes fail                                | Optional, needed by some NAT/firewall combinations |
| Project credential API | Keeps provider/signing secrets private and issues temporary TURN credentials | Only for managed temporary credentials             |

Browsers contact STUN/TURN directly. STUN is not a signaling server or a relay. The project's API
does not carry gameplay traffic. A VPS/static host with no API can support solo and direct/STUN
multiplayer; it cannot guarantee connectivity across every network. Node, Go or Rust do not change
that routing constraint. See [ADR 0002](adr/0002-networking-and-credentials.md).

## Public lobby discovery

A search is incomplete when some probes fail or remain unanswered at the deadline. The browser
keeps confirmed rows, and Quick Play creates a public lobby only after a completed search finds
no joinable offer.

Public discovery starts up to 16 probes every 750 ms and closes explicitly unavailable probes.
The offer-gathering window starts after the final batch. If signaling disconnects before a batch,
discovery can reconnect once within the original search deadline. An unfinished queue is reported
as incomplete.

After a search or Quick Play attempt, inspect `window.__game.net.getLobbyDiagnostics()` in the
browser console. The report separates signaling readiness and elapsed time from aggregate ICE,
data-channel, and lobby-response counts. It also includes queued probes and signaling reconnection
attempts. The report contains no addresses, SDP, tokens or credentials.

In a Vite development session with real PeerServer signaling, a Chromium host and Firefox 159
reproduced the original failure. Two of three searches received a signaling answer and candidates
for the reachable room, then stayed in ICE checking until the timeout. Joining by code worked in
both cases. In a one-core Firefox comparison, the original burst found the room in two of four
searches and the staggered batches found it in four of four. Testing an alias in the final batch
then reproduced a separate signaling disconnect. In an alternating comparison, discovery found
the alias in zero of three searches without recovery and three of three with one reconnection.
These measurements were made from one network. Independent-network validation is tracked in
[#36](https://github.com/meyer-pidiache/paper-shooter/issues/36).

## Public frontend configuration

Vite reads these at development/build time. Rebuild when they change. A deployed static host can
also replace `ice-servers.json` without rebuilding.

| Variable                    | Default                                     | Meaning                                                                     |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| `VITE_STUN_SERVERS`         | Unset                                       | Comma-separated public STUN URLs; an explicitly empty value disables STUN   |
| `VITE_ICE_CONFIG_URL`       | `ice-servers.json` under Vite's base        | Optional JSON source when no STUN override is set                           |
| `VITE_TURN_CREDENTIALS_URL` | Unset                                       | Same-origin path or HTTPS URL for expiring TURN credentials                 |
| `VITE_PEER_HOST`            | Unset                                       | Use PeerJS Cloud; set a hostname to use another PeerServer                  |
| `VITE_PEER_PORT`            | 443, or 80 for insecure local signaling     | Signaling port when a host is configured                                    |
| `VITE_PEER_PATH`            | `/`                                         | Signaling service path                                                      |
| `VITE_PEER_SECURE`          | `true`                                      | Use secure signaling; `false` is for an explicitly configured local server  |
| `VITE_LOBBY_NAMESPACE`      | Derived from the hostname on deployed sites | Separate public slots, discovery, quick play and private codes by namespace |

The checked-in `public/ice-servers.json` is an editable deployment default, not a host list embedded
in transport code. Its contract is `{ "iceServers": [{ "urls": ["stun:host:3478"] }] }`. Any valid
STUN host can be supplied. The client retains all valid TURN URLs/ports/transports returned by its
credential endpoint; it does not filter by provider hostname.

PeerServer Cloud shares its peer IDs across websites. The game derives a stable prefix from the
browser hostname so copies on different domains discover their own rooms. Localhost uses
`papershooter-dev-`. Hosting, browsing, Quick Play, manual joins and migration aliases all use
the same prefix. When an existing site switches from the former shared default, players need to
reload the site and create new lobbies.

To share lobbies across a custom domain and its deployment URL, set the same explicit
`VITE_LOBBY_NAMESPACE` on both builds. Use a separate value for previews when overriding the
default. The namespace controls discovery. Site access and private room authorization require
their own controls. See [ADR 0029](adr/0029-independent-lobby-namespaces.md).

Saved browser preferences still migrate from `doodle_*` to `paper_*` without deleting old values;
local preference migration does not require sharing a network lobby namespace.

## Credential API

`GET /api/turn-credentials` returns this provider-independent contract:

```json
{
  "iceServers": [
    {
      "urls": ["turn:relay.example:3478?transport=udp", "turns:relay.example:5349?transport=tcp"],
      "username": "temporary-user",
      "credential": "temporary-password"
    }
  ],
  "expiresAt": 1800000000000
}
```

`expiresAt` is an absolute Unix timestamp in milliseconds. Clients cache/coalesce requests and
renew credentials before expiry. Configuration/provider failures fall back to available ICE
servers and remain retryable. They do not invent permanent credentials or silently select a
different provider. A same-origin endpoint or external HTTPS adapter can implement this contract.

`GET /api/ice-servers` exposes public STUN URLs from runtime environment variables. Compose builds
use it, allowing STUN changes through container recreation. `GET /healthz` reports process health.
All API JSON uses `no-store`. Unsupported methods return 405; missing provider configuration returns
503; provider failure returns a redacted 502. The service bounds rate-limiter memory, coalesces
provider calls and applies a 10 second upstream deadline.

## Lobby and gameplay boundaries

The committed-session transport owns its selected peer and player connections. `LobbyDiscovery`
owns temporary signaling peers used to browse or choose a public lobby; only a successful explicit
adoption transfers one into the session. `LobbyQuery` owns each operation's probe connections,
listeners, overall deadline and gathering deadline. Cancellation, failure and completion clean up
those resources; the selected connection's session consumer is installed before following packets
can arrive. Browsing and quick play use the same query implementation.

Gameplay messages retain the existing wire format but pass typed payload validation before routing,
forwarding or handshake adoption. Snapshots have 11 or 14 finite values; vectors have exactly three.
Roster sizes follow `MAX_PLAYERS`; tracer batches, strings, spawn/breakable indices, clock values
and damage are bounded. These are input-safety contracts, not authentication or anti-cheat rules.

Character ink travels with the player's join metadata and the host's roster. The original red ink
applies when a client omits the field or supplies a value outside the palette. A player-scoped
message carries live color changes independently of movement snapshots.

The host chooses the time limit in the lobby from 3, 5, 10 and 15 minutes. Five minutes is the
default for new rooms. Lobby and start packets include the selected duration, and late-join start
packets carry the host's current clock state. Followers continue to project the last host clock
state between updates. An elected replacement host continues from its current projection.

The results screen gives match participants up to 20 seconds to vote for the next map. The host
counts one vote per player using the connection's identity. Among tied maps, the final scoreboard
rank of the highest-ranked voter decides the result. With no votes, the current map stays selected.
The lobby shows the winning map when players return for the next match.

## Optional multiplayer ping

Nerd Stats reports application echo round-trip time over the active PeerJS WebRTC data connection.
The guest measures its connection to the current host. A host sees the median of its active player
connections, labeled with the number of fresh samples. This includes browser scheduling and remote
message handling; it is not ICE candidate-pair RTT, lobby discovery, PeerServer signaling, or an API
request. The opt-in sampler sends at most one small request per connection every 1.5 seconds and
discards samples older than five seconds. Disabling the setting stops polling and clears samples.
Peers answer these small requests even when their own overlay is disabled so another player can
measure the established connection.

## Private runtime configuration

| Variable                              | Meaning                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `TURN_PROVIDER`                       | `none`, `cloudflare` or `coturn`; if unset, legacy Cloudflare keys enable that adapter |
| `TURN_TTL_SECONDS`                    | 300–172800, default 3600; legacy `CF_TURN_TTL_SECONDS` is still recognized             |
| `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | Cloudflare TURN key id and private API token                                           |
| `TURN_URLS`, `TURN_SHARED_SECRET`     | coturn URLs and the private REST authentication secret                                 |
| `PAPERSHOOT_STUN_SERVERS`             | Public STUN URLs exposed by the optional runtime endpoint                              |
| `PORT`, `HOST`                        | Native listener, default `3000` / `127.0.0.1`; Docker sets `8080` / `0.0.0.0`          |
| `TRUST_PROXY`                         | Default `false`; honor a proxy IP header only behind a private trusted ingress         |
| `TRUST_PROXY_HEADER`                  | Default `x-real-ip`; the ingress must overwrite this header with a verified IP         |
| `ALLOWED_ORIGINS`                     | Optional comma-separated HTTPS frontend origins for cross-origin API reads             |

For Cloudflare, select `TURN_PROVIDER=cloudflare` and supply both Cloudflare variables. For coturn,
enable its REST authentication/shared secret mechanism, select `TURN_PROVIDER=coturn`, set matching
`TURN_SHARED_SECRET` and list its `turn:`/`turns:` endpoints in `TURN_URLS`. coturn-compatible HMAC-SHA1
credentials follow that protocol; they are not password hashes or a configurable general signing
algorithm. The signing secret never leaves the API. See [coturn documentation](https://github.com/coturn/coturn)
and [Cloudflare credential generation](https://developers.cloudflare.com/realtime/turn/generate-credentials/).

This is an anonymous game: the endpoint is not an authentication service. CORS is a browser read
policy, not access control. In-memory limits apply per process; scaled/serverless deployments need
an edge/distributed rate limit and provider usage limits. Keep the origin private before trusting
forwarded IPs. A Cloudflare Tunnel ingress can use `cf-connecting-ip` when that route guarantees the
header is overwritten; other proxies can use `x-real-ip` or another configured pure IP header.
