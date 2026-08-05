import { describeSamplesUploadConfig, HttpConfig, parseSamplesUploadUri, S3Config, SamplesUploadUriError } from '../../../src/uploader/samplesUploadUri';

const EMPTY_ENV: NodeJS.ProcessEnv = {};

/** Narrow to the s3 member so the S3-specific assertions below stay readable. */
const parseS3 = (raw: string, env: NodeJS.ProcessEnv = EMPTY_ENV): S3Config => {
	const config = parseSamplesUploadUri(raw, env);

	if (config.type !== 's3') throw new Error(`expected an s3 config, got "${config.type}"`);

	return config;
};

describe('parseSamplesUploadUri - destination', () => {
	test('parses a bare bucket shorthand', () => {
		expect(parseS3('my-bucket')).toEqual({
			type: 's3',
			bucket: 'my-bucket',
			forcePathStyle: false,
		});
	});

	test('discriminates the target kind by scheme', () => {
		expect(parseSamplesUploadUri('s3://bucket', EMPTY_ENV).type).toBe('s3');
		expect(parseSamplesUploadUri('my-bucket', EMPTY_ENV).type).toBe('s3');
		expect(parseSamplesUploadUri('http://collector/samples', EMPTY_ENV).type).toBe('http');
		expect(parseSamplesUploadUri('https://collector/samples', EMPTY_ENV).type).toBe('http');
	});

	test('parses bucket and key prefix', () => {
		const config = parseS3('s3://edumeet-samples/prod/eu');

		expect(config.bucket).toBe('edumeet-samples');
		expect(config.keyPrefix).toBe('prod/eu');
	});

	test('normalises surrounding slashes in the key prefix', () => {
		expect(parseS3('s3://bucket///prod//').keyPrefix).toBe('prod');
	});

	test('leaves the key prefix undefined when absent', () => {
		expect(parseS3('s3://bucket').keyPrefix).toBeUndefined();
		expect(parseS3('s3://bucket/').keyPrefix).toBeUndefined();
	});

	test('decodes percent-encoded key prefixes', () => {
		expect(parseS3('s3://bucket/pro%20d').keyPrefix).toBe('pro d');
	});
});

describe('parseSamplesUploadUri - endpoint and path style', () => {
	test('enables path style by default when an endpoint is given', () => {
		const config = parseS3('s3://bucket?endpoint=http://minio.ns.svc:9000');

		expect(config.endpoint).toBe('http://minio.ns.svc:9000');
		expect(config.forcePathStyle).toBe(true);
	});

	test('leaves path style off for AWS', () => {
		expect(parseS3('s3://bucket').forcePathStyle).toBe(false);
	});

	test('allows path style to be overridden explicitly', () => {
		expect(parseS3('s3://bucket?endpoint=https://s3.example.com&pathStyle=false').forcePathStyle).toBe(false);
		expect(parseS3('s3://bucket?pathStyle=true').forcePathStyle).toBe(true);
	});

	test('rejects a non-http endpoint', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?endpoint=ftp://example.com', EMPTY_ENV)).toThrow(SamplesUploadUriError);
	});

	test('rejects a non-boolean pathStyle', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?pathStyle=maybe', EMPTY_ENV)).toThrow(/must be a boolean/);
	});
});

describe('parseSamplesUploadUri - region', () => {
	test('prefers the explicit region parameter', () => {
		expect(parseS3('s3://bucket?region=eu-north-1', { AWS_REGION: 'us-east-2' }).region).toBe('eu-north-1');
	});

	test('falls back to AWS_REGION, then AWS_DEFAULT_REGION', () => {
		expect(parseS3('s3://bucket', { AWS_REGION: 'eu-west-1' }).region).toBe('eu-west-1');
		expect(parseS3('s3://bucket', { AWS_DEFAULT_REGION: 'eu-west-2' }).region).toBe('eu-west-2');
	});

	test('leaves the region to the SDK for AWS, but defaults it for a custom endpoint', () => {
		expect(parseS3('s3://bucket').region).toBeUndefined();
		expect(parseS3('s3://bucket?endpoint=http://minio:9000').region).toBe('us-east-1');
	});
});

describe('parseSamplesUploadUri - credentials', () => {
	test('resolves static credentials from a named env prefix', () => {
		const config = parseS3('s3://bucket?credentialsEnv=minio', {
			MINIO_ACCESS_KEY_ID: 'key',
			MINIO_SECRET_ACCESS_KEY: 'secret',
		});

		expect(config.credentialsEnv).toBe('minio');
		expect(config.credentials).toEqual({ accessKeyId: 'key', secretAccessKey: 'secret' });
	});

	test('picks up an optional session token', () => {
		const config = parseS3('s3://bucket?credentialsEnv=MINIO', {
			MINIO_ACCESS_KEY_ID: 'key',
			MINIO_SECRET_ACCESS_KEY: 'secret',
			MINIO_SESSION_TOKEN: 'token',
		});

		expect(config.credentials?.sessionToken).toBe('token');
	});

	test('names the missing variables when they are not set', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?credentialsEnv=MINIO', EMPTY_ENV))
			.toThrow(/MINIO_ACCESS_KEY_ID and MINIO_SECRET_ACCESS_KEY/);
	});

	test('defers to the SDK chain when credentialsEnv is absent', () => {
		expect(parseS3('s3://bucket').credentials).toBeUndefined();
	});

	test('refuses credentials embedded in the URI', () => {
		expect(() => parseSamplesUploadUri('s3://key:secret@bucket', EMPTY_ENV)).toThrow(/must not be embedded/);
	});
});

describe('parseSamplesUploadUri - rejections', () => {
	test('rejects an empty value', () => {
		expect(() => parseSamplesUploadUri('   ', EMPTY_ENV)).toThrow(/must not be empty/);
	});

	test('rejects the legacy bucket//endpoint form with a migration hint', () => {
		expect(() => parseSamplesUploadUri('my-bucket//http://minio.ns.svc:9000', EMPTY_ENV))
			.toThrow('--samplesUploadUri: the "bucket//endpoint" form is no longer supported. Use "s3://my-bucket?endpoint=http://minio.ns.svc:9000" instead.');
	});

	test('rejects unsupported schemes by name', () => {
		expect(() => parseSamplesUploadUri('ftp://host/dir', EMPTY_ENV)).toThrow(/unsupported scheme "ftp:\/\/"/);
		expect(() => parseSamplesUploadUri('gs://bucket', EMPTY_ENV)).toThrow(/unsupported scheme "gs:\/\/"/);
	});

	test('rejects unknown parameters', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?regoin=eu-north-1', EMPTY_ENV)).toThrow(/unknown parameter\(s\) regoin/);
	});

	test('rejects invalid bucket names', () => {
		expect(() => parseSamplesUploadUri('s3://Bucket-Upper', EMPTY_ENV)).toThrow(/not a valid bucket name/);
		expect(() => parseSamplesUploadUri('s3://ab', EMPTY_ENV)).toThrow(/not a valid bucket name/);
	});

	test('rejects a non-positive maxAttempts', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?maxAttempts=0', EMPTY_ENV)).toThrow(/integer >= 1/);
		expect(() => parseSamplesUploadUri('s3://bucket?maxAttempts=lots', EMPTY_ENV)).toThrow(/integer >= 1/);
	});

	test('accepts a valid maxAttempts', () => {
		expect(parseS3('s3://bucket?maxAttempts=5').maxAttempts).toBe(5);
	});
});

describe('parseSamplesUploadUri - deleteAfterUpload', () => {
	test('is undefined unless asked for, so the uploader can pick the default', () => {
		expect(parseS3('s3://bucket').deleteAfterUpload).toBeUndefined();
		expect(parseSamplesUploadUri('https://collector/s', EMPTY_ENV).deleteAfterUpload).toBeUndefined();
	});

	test('parses on both schemes', () => {
		expect(parseS3('s3://bucket?deleteAfterUpload=true').deleteAfterUpload).toBe(true);
		expect(parseSamplesUploadUri('https://collector/s?deleteAfterUpload=true', EMPTY_ENV).deleteAfterUpload).toBe(true);
	});

	test('can be turned off explicitly', () => {
		expect(parseS3('s3://bucket?deleteAfterUpload=false').deleteAfterUpload).toBe(false);
		expect(parseSamplesUploadUri('https://collector/s?deleteAfterUpload=off', EMPTY_ENV).deleteAfterUpload).toBe(false);
	});

	test('rejects a non-boolean value', () => {
		expect(() => parseSamplesUploadUri('s3://bucket?deleteAfterUpload=sometimes', EMPTY_ENV))
			.toThrow(/"deleteAfterUpload" must be a boolean/);
	});

	test('is reported in the log-safe description', () => {
		expect(describeSamplesUploadConfig(parseS3('s3://bucket?deleteAfterUpload=true')).deleteAfterUpload).toBe(true);
		expect(describeSamplesUploadConfig(parseSamplesUploadUri('https://collector/s?deleteAfterUpload=true', EMPTY_ENV)).deleteAfterUpload).toBe(true);
	});
});

describe('parseSamplesUploadUri - http', () => {
	const parseHttp = (raw: string, env: NodeJS.ProcessEnv = EMPTY_ENV): HttpConfig => {
		const config = parseSamplesUploadUri(raw, env);

		if (config.type !== 'http') throw new Error(`expected an http config, got "${config.type}"`);

		return config;
	};

	test('keeps the base URL and strips the query string', () => {
		expect(parseHttp('http://collector.ns.svc:8080/samples?credentialsEnv=COLLECTOR', { COLLECTOR_TOKEN: 't0ken' }).url)
			.toBe('http://collector.ns.svc:8080/samples');
	});

	test('drops a trailing slash so keys append cleanly', () => {
		expect(parseHttp('https://collector/samples/').url).toBe('https://collector/samples');
	});

	test('preserves the scheme', () => {
		expect(parseHttp('https://collector/s').url).toBe('https://collector/s');
		expect(parseHttp('http://collector/s').url).toBe('http://collector/s');
	});

	test('resolves a bearer token from the named env prefix', () => {
		const config = parseHttp('https://collector/samples?credentialsEnv=collector', { COLLECTOR_TOKEN: 't0ken' });

		expect(config.credentialsEnv).toBe('collector');
		expect(config.token).toBe('t0ken');
	});

	test('names the missing token variable', () => {
		expect(() => parseSamplesUploadUri('https://collector/s?credentialsEnv=COLLECTOR', EMPTY_ENV))
			.toThrow(/requires COLLECTOR_TOKEN to be set/);
	});

	test('leaves the token undefined when credentialsEnv is absent', () => {
		expect(parseHttp('https://collector/s').token).toBeUndefined();
	});

	test('rejects s3-only parameters', () => {
		expect(() => parseSamplesUploadUri('https://collector/s?region=eu-north-1', EMPTY_ENV))
			.toThrow(/unknown parameter\(s\) region\. Supported: credentialsEnv, maxAttempts/);
	});

	test('refuses credentials embedded in the URI', () => {
		expect(() => parseSamplesUploadUri('https://user:pass@collector/s', EMPTY_ENV)).toThrow(/must not be embedded/);
	});

	test('accepts maxAttempts', () => {
		expect(parseHttp('https://collector/s?maxAttempts=5').maxAttempts).toBe(5);
	});
});

describe('describeSamplesUploadConfig', () => {
	test('renders a reference instead of the resolved secret', () => {
		const config = parseSamplesUploadUri('s3://bucket/prod?endpoint=http://minio:9000&credentialsEnv=minio', {
			MINIO_ACCESS_KEY_ID: 'AKIAEXAMPLE',
			MINIO_SECRET_ACCESS_KEY: 'super-secret',
		});
		const described = JSON.stringify(describeSamplesUploadConfig(config));

		expect(described).not.toContain('super-secret');
		expect(described).not.toContain('AKIAEXAMPLE');
		expect(describeSamplesUploadConfig(config).credentials).toBe('env:MINIO_*');
	});

	test('renders an http target without leaking the token', () => {
		const config = parseSamplesUploadUri('https://collector/samples?credentialsEnv=collector', {
			COLLECTOR_TOKEN: 'super-secret',
		});
		const described = describeSamplesUploadConfig(config);

		expect(JSON.stringify(described)).not.toContain('super-secret');
		expect(described).toEqual({
			type: 'http',
			url: 'https://collector/samples',
			credentials: 'env:COLLECTOR_TOKEN',
			deleteAfterUpload: true,
		});
	});

	test('reports the default chain when no credentials are configured', () => {
		expect(describeSamplesUploadConfig(parseSamplesUploadUri('s3://bucket', EMPTY_ENV))).toEqual({
			type: 's3',
			bucket: 'bucket',
			keyPrefix: '<none>',
			endpoint: 'AWS',
			region: '<sdk default>',
			forcePathStyle: false,
			credentials: 'sdk default chain',
			deleteAfterUpload: true,
		});
	});
});
