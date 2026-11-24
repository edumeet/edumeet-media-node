# ObserveRTC sample storage

When `--samplesStorePath` is set, the media node collects [observertc](https://github.com/ObserveRTC)
`ClientSample` payloads from the `observertc-samples` data channel, correlates them with mediasoup's
own router samples, and writes per-client JSONL files. When an upload destination is also configured,
it uploads those files and sends call summaries and router samples directly from memory.

| Output | When it is produced | Content type |
| --- | --- | --- |
| Local file `<callId>__<clientId>__<created-ms>.jsonl`; uploaded with filename `<clientId>.jsonl` | A client's sample sink closes | `application/x-ndjson` |
| Uploaded `call-summary-<sfuId>.json` (not stored locally) | A call closes on this node and an uploader is configured | `application/json` |
| Uploaded `mediasoup-router-<routerId>.json` (not stored locally) | A router is removed and an uploader is configured | `application/json` |

The media node collects samples only when `--samplesStorePath` is set. Uploading also requires
`--samplesUploadUri`.

### Options

| Option | Purpose |
| --- | --- |
| `--samplesStorePath <path>` | Local directory for the per-client JSONL files. |
| `--samplesUploadUri <uri>` | Upload destination for all artifacts. |

| `samplesStorePath` | `samplesUploadUri` | Behaviour |
| --- | --- | --- |
| unset | unset | Samples are not collected. |
| set | unset | JSONL files are written locally and kept. |
| unset | set | Upload target is ignored, with a warning. |
| set | set | JSONL files are staged locally and uploaded; call summaries and router samples are uploaded too. |

**`--samplesStorePath` is required for uploading.** The observer only creates a file sink when it
has somewhere to write, and the uploader sends that file, so without a directory there is nothing
per-client to upload. An upload URI given without a store path is discarded with a warning.

The node does not invent a temporary directory for you. It cannot know what the host or pod can
spare, and a read-only root filesystem or an ephemeral-storage limit would turn that guess into a
crash or an eviction.

### Retention

The media node does **not** implement retention. There is no age cap, no size cap, and no
background sweep.

- With an upload URI configured, `deleteAfterUpload` defaults to `true`, so the store path is a
  staging area: successfully uploaded per-client files are removed, while failed uploads remain
  for retry. There is no automatic cleanup for those failed files.
- Without an upload URI, files are written and left alone. Deciding what to keep is the storage
  layer's job — volume retention, a log-rotation sidecar, or bucket lifecycle rules. Point
  `--samplesStorePath` at a volume you are willing to let grow, and manage it there.

### deleteAfterUpload

Controls whether a staged local file is removed once it has been uploaded.

- **Defaults to `true`** whenever an upload URI is configured.
- Set `?deleteAfterUpload=false` to keep local copies as well.
- Deletion happens only after the upload **succeeds**, or when S3 reports an existing same-size
  object as already uploaded. A failed upload keeps the file.
- Kept files are eligible for another upload at each startup. S3 can skip an existing same-size
  object; HTTP posts the file again to the same key.
- Deletion applies to file-based artifacts, which today means the per-client JSONL sink files.
  Call summaries and router samples are generated in memory and never staged.
- Deletion errors are logged as warnings and never interrupt the node.

### samplesUploadUri formats

| Scheme | Target |
| --- | --- |
| `s3://`, or a bare bucket name | S3 or S3-compatible storage (MinIO, Ceph, ...). |
| `http://`, `https://` | HTTP collector, one POST per artifact. |

#### S3

```
s3://<bucket>[/<keyPrefix>][?<param>=<value>&...]
```

| Parameter | Default | Notes |
| --- | --- | --- |
| `endpoint` | AWS endpoint | Custom S3-compatible endpoint URL. Must be `http://` or `https://`, without embedded credentials. |
| `region` | `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1` when an endpoint is set | Region passed to the SDK. |
| `pathStyle` | `true` when `endpoint` is set, otherwise `false` | Path-style vs virtual-host-style addressing. MinIO needs path-style. |
| `credentialsEnv` | none | Reads `<PREFIX>_ACCESS_KEY_ID` and `<PREFIX>_SECRET_ACCESS_KEY`, plus optional `<PREFIX>_SESSION_TOKEN`. |
| `maxAttempts` | SDK default | Maximum total requests, including the first; integer >= 1. |
| `deleteAfterUpload` | `true` | Delete the staged JSONL file after a successful upload. |

#### HTTP

```
http[s]://<host>[:<port>][/<basePath>][?<param>=<value>&...]
```

| Parameter | Default | Notes |
| --- | --- | --- |
| `credentialsEnv` | none | Reads a bearer token from `<PREFIX>_TOKEN`. |
| `maxAttempts` | `3` | Maximum total requests, including the first; integer >= 1. |
| `deleteAfterUpload` | `true` | Delete the staged JSONL file after a successful upload. |

Unknown parameters are rejected per scheme, so a typo like `?regoin=eu-north-1` is reported rather
than silently ignored. A URI fragment is rejected for the same reason: a fragment is never sent in
an HTTP request, so a base like `https://collector.example.com/observertc#prod` would quietly POST
to `/observertc` instead of where it appears to point.

### Credentials

**Credentials are never read from the URI.** `s3://key:secret@bucket`,
`https://user:pass@host`, and custom S3 endpoints containing `user:pass@host` are rejected
outright — a URI ends up in `ps` output, pod specs, shell history and logs.

Use `?credentialsEnv=<PREFIX>` to name environment variables instead:

| Target | Variables |
| --- | --- |
| S3 | `<PREFIX>_ACCESS_KEY_ID`, `<PREFIX>_SECRET_ACCESS_KEY`, optional `<PREFIX>_SESSION_TOKEN` |
| HTTP | `<PREFIX>_TOKEN`, sent as `Authorization: Bearer ...` |

Without `credentialsEnv`, S3 falls back to the AWS SDK default credential chain: IRSA, instance
roles, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`. On a properly annotated
Kubernetes service account you usually need no credential configuration at all.

At debug log level the resolved configuration is logged with credentials shown as a reference
(`env:MINIO_*`), never as a value.

### Object keys

Keys are identical across S3 and HTTP targets:

```
<tenantFqdn>/<roomId>/<callId>/<clientId>.jsonl
<tenantFqdn>/<roomId>/<callId>/call-summary-<sfuId>.json
<tenantFqdn>/<roomId>/<callId>/mediasoup-router-<routerId>.json
```

For S3, a `keyPrefix` from the URI path is prepended. For HTTP, the key is appended to the base
path, one POST per artifact. Below the tenant folder the layout is the one the ObserveRTC stats
dashboard reads, so a dashboard pointed at `<tenantFqdn>/` shows that tenant.

- `<tenantFqdn>` and `<roomId>` come from the room server, with the router request, when its
  `clientMonitoring.roomInfo` setting is on: the host name the room's first participant joined on,
  the same value the room server resolves the tenant from, and the room name, or the room session
  id when the room server is set to keep room names to itself. They replace whatever a sample
  says, so a client cannot choose its folder. Every tenant's data sits under a folder of its own,
  so it can be listed, given a lifecycle rule, or deleted on its own. A room server that sends
  neither files a call under `unknown-tenant/<callId>/<callId>/`.
- `<callId>` is the room session id the room server issues, a random UUID per room instance.
  It is also the `roomId` of the router the samples channel was produced on, and a sample naming
  any other call is dropped, so a client can only write into its own call.
- Every node that carried part of a call writes its own `call-summary-<sfuId>.json`; the
  dashboard merges them. `sfuId` defaults to the host name plus a random suffix.
- A client that rejoins the same call can have more than one file for the same key. Over S3 the
  node checks first and stores a different-size file as
  `<clientId>~<created ms>.jsonl` next to it. An existing object with the same size is treated as
  already uploaded; the node does not compare contents, so different same-size files can be
  mistaken for duplicates. HTTP targets are not checked and may be overwritten at the same key.

`tenantFqdn` and `roomId` are still validated before use, because the room server has the first
from the URL a client connected with and the second from a name people choose: each must match
`[A-Za-z0-9._-]{1,128}` and may not be `.` or `..`. Anything else falls back to `unknown-tenant`
or `unknown-room` and logs a warning. This keeps a crafted host or room name from polluting the
key space or escaping the configured HTTP base path.

### Failure behaviour

- A malformed `--samplesUploadUri` **does not stop the node**. It logs a warning naming the
  problem and starts with uploads disabled.
- `--samplesStorePath` passed without a value, or with a blank one, is treated the same way:
  sample storage is disabled with a warning, and any upload URI alongside it is discarded.
- Upload failures are logged and calls are unaffected. A per-client file whose upload failed
  stays in the store and is retried at the next start with uploads configured; a call summary or
  router sample is lost.
- HTTP makes up to `maxAttempts` total requests (three by default), retrying network errors, `429`
  and `5xx` with exponential backoff. Each request has a 30-second timeout. Other `4xx` responses
  fail immediately, since retrying a rejected request will not help.
- S3 delegates retries to the AWS SDK.

### Examples

Local storage only, no upload:

```bash
yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples
```

AWS S3, credentials from the instance role or IRSA:

```bash
yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples \
  --samplesUploadUri "s3://edumeet-samples/prod?region=eu-north-1"
```

MinIO inside the cluster, credentials from environment variables:

```bash
export MINIO_ACCESS_KEY_ID=...
export MINIO_SECRET_ACCESS_KEY=...

yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples \
  --samplesUploadUri "s3://samples/dev?endpoint=http://minio.minio-ns.svc.cluster.local:9000&credentialsEnv=MINIO"
```

Any other S3-compatible provider, addressed by its own endpoint:

```bash
export STORAGE_ACCESS_KEY_ID=...
export STORAGE_SECRET_ACCESS_KEY=...

yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples \
  --samplesUploadUri "s3://edumeet-samples?endpoint=https://<region>.example-storage.com&region=<region>&pathStyle=false&credentialsEnv=STORAGE"
```

`pathStyle` is the part that is easy to miss. It defaults to `true` whenever an endpoint is set,
which is what MinIO and Ceph want. Providers that serve virtual-host-style addresses need
`pathStyle=false`, and the SDK then addresses the bucket as `https://<bucket>.<endpoint-host>` —
so keep dots out of the bucket name, or a wildcard certificate will not match it. Set `region` to
whatever the provider expects; many tie it to the endpoint's location.

If uploads fail with `Unsupported header 'x-amz-checksum-crc32'`, the store does not accept the
checksums recent AWS SDK versions send by default. Set `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`
in the environment; the SDK reads it directly, so nothing here changes.

HTTP collector with a bearer token, keeping local copies:

```bash
export COLLECTOR_TOKEN=...

yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples \
  --samplesUploadUri "https://collector.example.com/observertc?credentialsEnv=COLLECTOR&deleteAfterUpload=false"
```

When passing a URI through a shell or a Kubernetes manifest, quote it. An unquoted `&` between
query parameters is a shell control character and will truncate the value.
