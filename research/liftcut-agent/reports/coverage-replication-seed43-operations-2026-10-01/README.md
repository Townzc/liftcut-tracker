# Seed43 operational observations

This directory is separate from the exact81-file model-evidence publication.
`events.jsonl` is the local monitor log with CRLF normalized to LF to match repository
attributes; all parsed records are unchanged, including the local-only monitor
restart and terminal SFTP exception. `observations.json` records both original and
published event hashes, links actual local restore evidence and records subsequent
read-only connection checks.

The full local restoration passed before the genuine receipt upload was attempted.
The SFTP connection dropped before the client confirmed that upload. Remote receipt
acceptance, shutdown return and platform billing stop remain unknown. An ACK may
have been accepted before the upload confirmation response; that is a possible
explanation, not an observed fact. The separate SSH observer captured no final
server receipt. No ACK or server shutdown receipt was reconstructed by hand.

Elapsed-time cost proxies use the supplied CNY2.18/hour price and recorded boot
proxy. They are not an invoice, final power-off timestamp or verified spending cap;
storage is separate and unknown. Platform confirmation has been requested from the
user. Do not reopen the GPU to fill this evidence gap.
