# Security policy

This is an experimental AssemblyScript guest SDK, not a sandbox or a host
security policy. Only the 0.1.x preview line receives downstream maintenance;
there is no production support SLA or audited-security claim.

Report sensitive findings through this repository's GitHub private vulnerability
reporting facility when available. If it is unavailable, contact a Centillex
maintainer privately before sharing details; do not put credentials, request
contents or exploit material in a public maintenance issue.

- Use only reviewed, hash-pinned guests in the current Nautiq demo profile.
- Keep host-call permissions, routing/identity enforcement and execution/resource
  bounds in the host. This SDK does not implement those protections.
- Keep Wasmtime and ngx_wasm_module security maintenance separate from npm SDK
  dependency updates. A clean npm audit does not establish native-host safety.
- Inherited SDK debug logging can include configuration and callout data. Do not
  put secrets in debug output or enable verbose logs on sensitive traffic.
- Do not compile untrusted source in privileged or credential-bearing workflows.
  PR CI has read-only repository permissions and no publishing credentials.
- Keep compiler/dependency versions exact. Review changes and requalify native
  behavior before adopting compiler or runtime updates.

Weekly metadata monitoring reports public repository advisories for human review;
it is neither an exhaustive vulnerability feed nor an automatic determination
that a pinned build is affected. Configure immediate GitHub security/advisory
notifications for maintainers as well. Do not wait for the weekly job to triage a
known relevant advisory.
