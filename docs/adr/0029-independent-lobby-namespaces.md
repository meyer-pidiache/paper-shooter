# 0029: Independent lobby namespaces

Date: 2026-11-15. Status: accepted. Amends the namespace decision in ADR 0002.

## Context

Public Paper lobbies appeared in the upstream Doodle site. The old deployment and the refactor both
retained the `doodledistrict-` prefix. Both use PeerServer Cloud, whose manually selected peer ids
share a service-wide space rather than being separated by the frontend origin. Public discovery
probes predictable `PUB0` through `PUB15` ids and their host-migration suffixes. Consequently both
games queried the same rooms; a different website, STUN server or TURN provider cannot separate them.

## Decision

The first isolation change gave deployed Paper clients a product-wide prefix. Copies of Paper
still shared rooms with each other, so deployed clients now derive the default from the browser
hostname. Local hosts use `papershooter-dev-`. A fixed hostname keeps lobby identity stable
across builds. Hosts, browsing, Quick Play, manual joins and migration aliases use the same prefix.

Keep `VITE_LOBBY_NAMESPACE` as a public build-time override for operators who use several URLs
for the same game. GitHub Pages can provide a repository-specific override to separate project
sites sharing one hostname.

## Alternatives and consequences

- A new prefix fixes accidental cross-discovery without changing WebRTC, signaling providers or the
  gameplay protocol. It does not provide authentication or prevent a modified client from connecting
  to a known peer id.
- Self-hosting PeerServer provides independent signaling infrastructure and remains configurable.
  It is a separate operational choice; replacing the provider is unnecessary to fix discovery.
- Retaining the upstream prefix would preserve cross-game matching, contrary to this fork's intent.
- Existing clients and lobbies keep their old ids until users reload and create new lobbies.
  Rebuild the client or Docker image when changing `VITE_LOBBY_NAMESPACE`; restarting an old image
  does not rewrite its compiled JavaScript.

## Verification

Integration tests run the real transport and lobby discovery against one simulated signaling
service shared by Paper and Doodle clients. Before the fix, public slot allocation collided and a
Paper private-code join reached a Doodle host. The corrected defaults allow both games to claim
`PUB0` independently, list and quick-join only their own lobbies, and reuse private codes without
cross-joining. The suite also verifies two deployed Paper copies and explicit namespaces. Unit
tests cover stable hostname normalization, local hosts and custom signaling options.

## Evidence

- [PeerServer Cloud shared ids](https://peerjs.com/server/cloud)
- [Vite build-time environment variables](https://vite.dev/guide/env-and-mode.html)
