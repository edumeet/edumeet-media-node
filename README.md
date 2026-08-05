# Edumeet media node

This is the media node service for the Edumeet project. 

![](img/edumeet-media-node.drawio.png)

It has a default port range of 250 ports, but can be configured to use more or less by passing arguments when building the container.

To calculate the needed number of ports, the following is used:
- N ports where N is the number of cores on the server for all the user transports
- 1 port pr pipe between any two routers. For an internal pipe that means 2 ports are used, for and external pipe that means 1 port is used.

Add up the number of cores, and the number of pipes between routers and you have the number of ports needed. This will naturally limit itself because the amount of piping between routers is naturally limited because of overall server load.

## Usage

### Running the service manually

```bash
$ corepack enable
$ yarn install --immutable
$ yarn start --ip <public-ip-of-host> --secret <secret-shared-with-room-server>
```

To run the service you need to have Node.js version 24 or higher installed. This project uses Yarn 4 via Corepack. Alternatively you can get some debug output by running it like this:

```bash
$ DEBUG=edumeet:* yarn start --ip <public-ip-of-host> --secret <secret-shared-with-room-server>
```
### Docker
https://github.com/edumeet/edumeet-docker/tree/4.x has guidelines for running the next generation Edumeet as docker containers.

## observertc sample storage

Clients send [observertc](https://github.com/ObserveRTC) `ClientSample` payloads over the
`observertc-samples` data channel. The media node feeds them into an observer that correlates
them with mediasoup's own router samples, and turns the result into three kinds of artifact:

| Artifact | When it is produced | Content type |
| --- | --- | --- |
| `<clientId>.jsonl` | an observed client leaves and its sink closes | `application/x-ndjson` |
| `call-summary.json` | a call closes | `application/json` |
| `mediasoup-router-<routerId>.json` | a router is removed | `application/json` |

Nothing is stored or uploaded unless you ask for it. With neither option set, samples are
accepted, processed, and dropped.

### Options

| Option | Purpose |
| --- | --- |
| `--samplesStorePath <path>` | Local directory for the per-client JSONL files. |
| `--samplesUploadUri <uri>` | Upload destination for all artifacts. |

| `samplesStorePath` | `samplesUploadUri` | Behaviour |
| --- | --- | --- |
| unset | unset | Samples are processed, then dropped. |
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
  staging area and does not accumulate files.
- Without an upload URI, files are written and left alone. Deciding what to keep is the storage
  layer's job — volume retention, a log-rotation sidecar, or bucket lifecycle rules. Point
  `--samplesStorePath` at a volume you are willing to let grow, and manage it there.

### deleteAfterUpload

Controls whether a staged local file is removed once it has been uploaded.

- **Defaults to `true`** whenever an upload URI is configured.
- Set `?deleteAfterUpload=false` to keep local copies as well.
- Deletion happens only after the upload **succeeds**. A failed upload keeps the file.
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
| `endpoint` | AWS endpoint | Custom S3-compatible endpoint URL. Must be `http://` or `https://`. |
| `region` | `AWS_REGION`, then `AWS_DEFAULT_REGION`, then `us-east-1` when an endpoint is set | Region passed to the SDK. |
| `pathStyle` | `true` when `endpoint` is set, otherwise `false` | Path-style vs virtual-host-style addressing. MinIO needs path-style. |
| `credentialsEnv` | none | Reads `<PREFIX>_ACCESS_KEY_ID` and `<PREFIX>_SECRET_ACCESS_KEY`, plus optional `<PREFIX>_SESSION_TOKEN`. |
| `maxAttempts` | SDK default | Retry attempts, integer >= 1. |
| `deleteAfterUpload` | `true` | Delete the staged JSONL file after a successful upload. |

#### HTTP

```
http[s]://<host>[:<port>][/<basePath>][?<param>=<value>&...]
```

| Parameter | Default | Notes |
| --- | --- | --- |
| `credentialsEnv` | none | Reads a bearer token from `<PREFIX>_TOKEN`. |
| `maxAttempts` | `3` | Retry attempts, integer >= 1. |
| `deleteAfterUpload` | `true` | Delete the staged JSONL file after a successful upload. |

Unknown parameters are rejected per scheme, so a typo like `?regoin=eu-north-1` is reported rather
than silently ignored.

### Credentials

**Credentials are never read from the URI.** `s3://key:secret@bucket` and
`https://user:pass@host` are rejected outright — a URI ends up in `ps` output, pod specs, shell
history and logs.

Use `?credentialsEnv=<PREFIX>` to name environment variables instead:

| Target | Variables |
| --- | --- |
| S3 | `<PREFIX>_ACCESS_KEY_ID`, `<PREFIX>_SECRET_ACCESS_KEY`, optional `<PREFIX>_SESSION_TOKEN` |
| HTTP | `<PREFIX>_TOKEN`, sent as `Authorization: Bearer ...` |

Without `credentialsEnv`, S3 falls back to the AWS SDK default credential chain: IRSA, instance
roles, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`. On a properly annotated
Kubernetes service account you usually need no credential configuration at all.

At startup the resolved configuration is logged with credentials shown as a reference
(`env:MINIO_*`), never as a value.

### Object keys

Keys are identical across S3 and HTTP targets:

```
<roomId>/<callId>/<clientId>.jsonl
<roomId>/<callId>/call-summary.json
<roomId>/<callId>/mediasoup-router-<routerId>.json
```

For S3, a `keyPrefix` from the URI path is prepended. For HTTP, the key is appended to the base
path, one POST per artifact.

`roomId` arrives in a client-supplied sample attachment, so it is validated before use: it must
match `[A-Za-z0-9._-]{1,128}` and may not be `.` or `..`. Anything else, including a room that was
never reported, falls back to `unknown-room` and logs a warning. This keeps a hostile client from
polluting the key space or escaping the configured HTTP base path.

### Failure behaviour

- A malformed `--samplesUploadUri` **does not stop the node**. It logs a warning naming the
  problem and starts with uploads disabled.
- Upload failures are logged. The artifact is lost, calls are unaffected. There is no queue, no
  spooling, and no replay after a restart.
- HTTP retries network errors, `429` and `5xx` with exponential backoff up to `maxAttempts`, with
  a 30 second per-request timeout. Other `4xx` responses fail immediately, since retrying a
  rejected request will not help.
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

HTTP collector with a bearer token, keeping local copies:

```bash
export COLLECTOR_TOKEN=...

yarn start --ip <public-ip> \
  --samplesStorePath /var/lib/edumeet/samples \
  --samplesUploadUri "https://collector.example.com/observertc?credentialsEnv=COLLECTOR&deleteAfterUpload=false"
```

When passing a URI through a shell or a Kubernetes manifest, quote it. An unquoted `&` between
query parameters is a shell control character and will truncate the value.
