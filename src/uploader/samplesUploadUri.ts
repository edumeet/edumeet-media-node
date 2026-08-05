/**
 * Parser for the `--samplesUploadUri` value.
 *
 * The URI scheme picks the kind of upload target, and the parsed result is a
 * discriminated union so callers can switch on `type` rather than guess:
 * `s3://` for object storage, `http://` / `https://` to POST at a collector.
 *
 * The URI describes *where* samples go and *how* to reach the store. It never
 * carries credentials: identity is resolved separately, either by the AWS SDK
 * default credential chain (IRSA, instance profile, AWS_* env vars,
 * ~/.aws/credentials together with AWS_PROFILE) or, when `credentialsEnv` is
 * given, from a named set of prefixed environment variables.
 *
 * s3:// format:
 *   s3://<bucket>[/<keyPrefix>][?<param>=<value>&...]
 *
 * s3:// parameters:
 *   endpoint       Custom S3-compatible endpoint URL (MinIO, Ceph, ...).
 *   region         AWS region. Falls back to AWS_REGION / AWS_DEFAULT_REGION.
 *   pathStyle      Force path-style URLs. Defaults to true when an endpoint is
 *                  set, false otherwise.
 *   credentialsEnv Name prefix of the env vars holding static credentials, e.g.
 *                  `MINIO` reads MINIO_ACCESS_KEY_ID / MINIO_SECRET_ACCESS_KEY
 *                  and optionally MINIO_SESSION_TOKEN.
 *   maxAttempts    SDK retry attempts per request (>= 1).
 *   deleteAfterUpload Delete staged per-client JSONL files after successful upload.
 *
 * http(s):// format:
 *   http[s]://<host>[:<port>][/<basePath>][?<param>=<value>&...]
 *
 * Object keys are appended to the base path, so a key of
 * `room/call/client.jsonl` is POSTed to `<basePath>/room/call/client.jsonl`.
 *
 * http(s):// parameters:
 *   credentialsEnv Name prefix of the env var holding a bearer token, e.g.
 *                  `COLLECTOR` reads COLLECTOR_TOKEN.
 *   maxAttempts    Request attempts before giving up (>= 1, default 3).
 *   deleteAfterUpload Delete staged per-client JSONL files after successful upload.
 */

export type S3Credentials = {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
};

/** Target described by an `s3://` value. */
export type S3Config = {
	type: 's3';
	bucket: string;
	keyPrefix?: string;
	region?: string;
	endpoint?: string;
	forcePathStyle: boolean;
	credentials?: S3Credentials;
	credentialsEnv?: string;
	maxAttempts?: number;
	deleteAfterUpload?: boolean;
};

/** Target described by an `http://` or `https://` value. */
export type HttpConfig = {
	type: 'http';

	/** Base URL with the query string stripped and no trailing slash. */
	url: string;

	/** Bearer token resolved from `credentialsEnv`, if one was given. */
	token?: string;
	credentialsEnv?: string;
	maxAttempts?: number;
	deleteAfterUpload?: boolean;
};

/**
 * Every upload target a `--samplesUploadUri` value can describe, discriminated
 * by `type`.
 *
 * Adding one means adding it to this union, then handling it in
 * `describeSamplesUploadConfig()` and in `createUploader()`. The compiler flags
 * both of those. It cannot flag the scheme switch in `parseSamplesUploadUri()`,
 * which branches on the URI scheme rather than on this type, so that one is on
 * you.
 */
export type SamplesUploadConfig = S3Config | HttpConfig;

export class SamplesUploadUriError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'SamplesUploadUriError';
	}
}

const S3_PARAMS = [ 'endpoint', 'region', 'pathStyle', 'credentialsEnv', 'maxAttempts', 'deleteAfterUpload' ];
const HTTP_PARAMS = [ 'credentialsEnv', 'maxAttempts', 'deleteAfterUpload' ];

/** S3 (and MinIO) bucket naming rules, loosely enforced. */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

const CREDENTIALS_ENV_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

const TRUE_VALUES = [ 'true', '1', 'yes', 'on' ];
const FALSE_VALUES = [ 'false', '0', 'no', 'off' ];

const parseBooleanParam = (name: string, value: string): boolean => {
	const normalized = value.trim().toLowerCase();

	if (TRUE_VALUES.includes(normalized)) return true;
	if (FALSE_VALUES.includes(normalized)) return false;

	throw new SamplesUploadUriError(`--samplesUploadUri: "${name}" must be a boolean (true/false), got "${value}"`);
};

const parseEndpointParam = (value: string): string => {
	let endpoint: URL;

	try {
		endpoint = new URL(value);
	} catch {
		throw new SamplesUploadUriError(`--samplesUploadUri: "endpoint" is not a valid URL: "${value}"`);
	}

	if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
		throw new SamplesUploadUriError(`--samplesUploadUri: "endpoint" must be an http(s) URL, got "${value}"`);
	}

	return value;
};

const parseMaxAttemptsParam = (value: string): number => {
	const maxAttempts = Number.parseInt(value, 10);

	if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
		throw new SamplesUploadUriError(`--samplesUploadUri: "maxAttempts" must be an integer >= 1, got "${value}"`);
	}

	return maxAttempts;
};

/**
 * Resolve static credentials from a named env var prefix.
 *
 * This exists so a node can address a store the ambient AWS credential chain
 * does not point at (typically MinIO) without squatting on the global
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY variables.
 */
const resolveCredentialsFromEnv = (prefix: string, env: NodeJS.ProcessEnv): S3Credentials => {
	if (!CREDENTIALS_ENV_PATTERN.test(prefix)) {
		throw new SamplesUploadUriError(`--samplesUploadUri: "credentialsEnv" must be a valid env var name prefix, got "${prefix}"`);
	}

	const normalized = prefix.toUpperCase();
	const accessKeyIdVar = `${normalized}_ACCESS_KEY_ID`;
	const secretAccessKeyVar = `${normalized}_SECRET_ACCESS_KEY`;
	const sessionToken = env[`${normalized}_SESSION_TOKEN`];
	const accessKeyId = env[accessKeyIdVar];
	const secretAccessKey = env[secretAccessKeyVar];

	if (!accessKeyId || !secretAccessKey) {
		const missing = [
			...(accessKeyId ? [] : [ accessKeyIdVar ]),
			...(secretAccessKey ? [] : [ secretAccessKeyVar ]),
		];

		throw new SamplesUploadUriError(`--samplesUploadUri: credentialsEnv=${prefix} requires ${missing.join(' and ')} to be set`);
	}

	return {
		accessKeyId,
		secretAccessKey,
		...(sessionToken && { sessionToken }),
	};
};

/**
 * Resolve a bearer token from a named env var prefix, mirroring the S3 helper
 * above: the URI names the variable, never the value.
 */
const resolveTokenFromEnv = (prefix: string, env: NodeJS.ProcessEnv): string => {
	if (!CREDENTIALS_ENV_PATTERN.test(prefix)) {
		throw new SamplesUploadUriError(`--samplesUploadUri: "credentialsEnv" must be a valid env var name prefix, got "${prefix}"`);
	}

	const tokenVar = `${prefix.toUpperCase()}_TOKEN`;
	const token = env[tokenVar];

	if (!token) {
		throw new SamplesUploadUriError(`--samplesUploadUri: credentialsEnv=${prefix} requires ${tokenVar} to be set`);
	}

	return token;
};

const assertNoUserInfo = (url: URL): void => {
	if (!url.username && !url.password) return;

	throw new SamplesUploadUriError(
		'--samplesUploadUri: credentials must not be embedded in the URI (they leak through `ps`, pod specs and logs). ' +
		'Use the AWS credential chain, or "?credentialsEnv=<PREFIX>" to read them from ' +
		'<PREFIX>_ACCESS_KEY_ID / <PREFIX>_SECRET_ACCESS_KEY.'
	);
};

const assertKnownParams = (url: URL, allowed: string[]): void => {
	const unknown = [ ...url.searchParams.keys() ].filter((key) => !allowed.includes(key));

	if (unknown.length === 0) return;

	throw new SamplesUploadUriError(`--samplesUploadUri: unknown parameter(s) ${unknown.join(', ')}. Supported: ${allowed.join(', ')}`);
};

const normalizeS3Input = (value: string): string => {
	if (/^s3:\/\//i.test(value)) return value;

	// The former `bucket//endpoint` shorthand. Reject it loudly rather than
	// silently reinterpreting it as a bucket followed by an empty path segment.
	if (value.includes('//')) {
		const [ bucket, ...rest ] = value.split('//');

		throw new SamplesUploadUriError(
			'--samplesUploadUri: the "bucket//endpoint" form is no longer supported. ' +
			`Use "s3://${bucket}?endpoint=${rest.join('//')}" instead.`
		);
	}

	// Bare bucket shorthand, e.g. `--samplesUploadUri my-bucket`.
	return `s3://${value}`;
};

const parseS3Uri = (value: string, env: NodeJS.ProcessEnv): S3Config => {
	const normalized = normalizeS3Input(value);
	let url: URL;

	try {
		url = new URL(normalized);
	} catch {
		throw new SamplesUploadUriError(`--samplesUploadUri: not a valid URI: "${value}"`);
	}

	assertNoUserInfo(url);
	assertKnownParams(url, S3_PARAMS);

	const bucket = url.hostname;

	if (!BUCKET_PATTERN.test(bucket)) {
		throw new SamplesUploadUriError(
			`--samplesUploadUri: "${bucket}" is not a valid bucket name (3-63 characters, lowercase letters, digits, dots and hyphens)`
		);
	}

	const keyPrefix = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '') || undefined;
	const endpointParam = url.searchParams.get('endpoint');
	const pathStyleParam = url.searchParams.get('pathStyle');
	const regionParam = url.searchParams.get('region');
	const maxAttemptsParam = url.searchParams.get('maxAttempts');
	const credentialsEnv = url.searchParams.get('credentialsEnv') ?? undefined;
	const endpoint = endpointParam ? parseEndpointParam(endpointParam) : undefined;
	const deleteAfterUploadParam = url.searchParams.get('deleteAfterUpload');
	const deleteAfterUpload = deleteAfterUploadParam !== null
		? parseBooleanParam('deleteAfterUpload', deleteAfterUploadParam)
		: undefined;

	// Most S3-compatible stores need path-style addressing and AWS does not, but
	// some compatible stores do serve virtual-host style, so keep it overridable.
	const forcePathStyle = pathStyleParam !== null
		? parseBooleanParam('pathStyle', pathStyleParam)
		: Boolean(endpoint);

	// A custom endpoint usually ignores the region, but the SDK insists on one.
	const region = regionParam
		?? env.AWS_REGION
		?? env.AWS_DEFAULT_REGION
		?? (endpoint ? 'us-east-1' : undefined);

	return {
		type: 's3',
		bucket,
		...(keyPrefix && { keyPrefix }),
		...(region && { region }),
		...(endpoint && { endpoint }),
		forcePathStyle,
		...(credentialsEnv && {
			credentialsEnv,
			credentials: resolveCredentialsFromEnv(credentialsEnv, env),
		}),
		...(maxAttemptsParam && { maxAttempts: parseMaxAttemptsParam(maxAttemptsParam) }),
		...(deleteAfterUpload !== undefined && { deleteAfterUpload }),
	};
};

const parseHttpUri = (value: string, env: NodeJS.ProcessEnv): HttpConfig => {
	let url: URL;

	try {
		url = new URL(value);
	} catch {
		throw new SamplesUploadUriError(`--samplesUploadUri: not a valid URI: "${value}"`);
	}

	assertNoUserInfo(url);
	assertKnownParams(url, HTTP_PARAMS);

	const credentialsEnv = url.searchParams.get('credentialsEnv') ?? undefined;
	const maxAttemptsParam = url.searchParams.get('maxAttempts');
	const token = credentialsEnv ? resolveTokenFromEnv(credentialsEnv, env) : undefined;
	const deleteAfterUploadParam = url.searchParams.get('deleteAfterUpload');
	const deleteAfterUpload = deleteAfterUploadParam !== null
		? parseBooleanParam('deleteAfterUpload', deleteAfterUploadParam)
		: undefined;

	// Keys are appended to the base path, so the query string is not part of it.
	url.search = '';

	const base = url.toString().replace(/\/+$/, '');

	return {
		type: 'http',
		url: base,
		...(credentialsEnv && { credentialsEnv, token }),
		...(maxAttemptsParam && { maxAttempts: parseMaxAttemptsParam(maxAttemptsParam) }),
		...(deleteAfterUpload !== undefined && { deleteAfterUpload }),
	};
};

/** Scheme of a URI, or undefined for the bare bucket shorthand. */
const schemeOf = (value: string): string | undefined =>
	(/^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1])?.toLowerCase();

/**
 * Parse a `--samplesUploadUri` value into the config for its target kind.
 *
 * @throws SamplesUploadUriError when the value is malformed or names a scheme
 * that is not supported.
 */
export const parseSamplesUploadUri = (raw: string, env: NodeJS.ProcessEnv = process.env): SamplesUploadConfig => {
	const value = raw.trim();

	if (!value) throw new SamplesUploadUriError('--samplesUploadUri: value must not be empty');

	const scheme = schemeOf(value);

	switch (scheme) {
		// No scheme at all is the bare bucket shorthand, e.g. "my-bucket".
		case undefined:
		case 's3':
			return parseS3Uri(value, env);

		case 'http':
		case 'https':
			return parseHttpUri(value, env);

		default:
			throw new SamplesUploadUriError(`--samplesUploadUri: unsupported scheme "${scheme}://", got "${value}". Supported: s3://, http://, https://`);
	}
};

const describeS3Config = (config: S3Config): Record<string, unknown> => ({
	type: config.type,
	bucket: config.bucket,
	keyPrefix: config.keyPrefix ?? '<none>',
	endpoint: config.endpoint ?? 'AWS',
	region: config.region ?? '<sdk default>',
	forcePathStyle: config.forcePathStyle,
	credentials: config.credentialsEnv
		? `env:${config.credentialsEnv.toUpperCase()}_*`
		: 'sdk default chain',
	deleteAfterUpload: config.deleteAfterUpload ?? true,
	...(config.maxAttempts && { maxAttempts: config.maxAttempts }),
});

const describeHttpConfig = (config: HttpConfig): Record<string, unknown> => ({
	type: config.type,
	url: config.url,
	credentials: config.credentialsEnv
		? `env:${config.credentialsEnv.toUpperCase()}_TOKEN`
		: 'none',
	deleteAfterUpload: config.deleteAfterUpload ?? true,
	...(config.maxAttempts && { maxAttempts: config.maxAttempts }),
});

/**
 * A log-safe rendering of the resolved config. Safe by construction: the URI
 * holds credential *references* only, and resolved secret values are omitted.
 */
export const describeSamplesUploadConfig = (config: SamplesUploadConfig): Record<string, unknown> => {
	switch (config.type) {
		case 's3':
			return describeS3Config(config);

		case 'http':
			return describeHttpConfig(config);
	}
};
